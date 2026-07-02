package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"sentivo/proto"
)

// lanPort is the fixed port the agent listens on for same-network app connections.
const lanPort = 8766

var lanUpgrader = websocket.Upgrader{
	CheckOrigin:     func(*http.Request) bool { return true },
	ReadBufferSize:  1 << 12,
	WriteBufferSize: 1 << 16,
}

// startLAN runs a direct WebSocket listener on the LAN so a same-network app can bypass the
// relay for near-zero latency. Auth = the shared token (only the paired app holds it); the
// link rides the laptop's own WiFi/WPA encryption. Additive: the relay session is untouched,
// so if the direct path fails the app simply falls back to the relay.
func startLAN() {
	tok := tokenFromURL(relayURL)
	if tok == "" {
		return // no token in the relay URL → can't authenticate direct clients; stay relay-only
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/direct", func(w http.ResponseWriter, r *http.Request) {
		if !lanAuthOK(r, tok) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		c, err := lanUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		serveDirect(c)
	})
	srv := &http.Server{Addr: fmt.Sprintf(":%d", lanPort), Handler: mux}
	go func() {
		for {
			if err := srv.ListenAndServe(); err != nil {
				log.Printf("lan listener: %v; retry in 10s", err)
				time.Sleep(10 * time.Second)
			}
		}
	}()
}

func lanAuthOK(r *http.Request, tok string) bool {
	if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") == tok {
		return true
	}
	return r.URL.Query().Get("token") == tok // fallback for clients that can't set headers
}

func tokenFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Query().Get("token")
}

// serveDirect handles one direct app connection: the same command / stream / input dispatch as
// the relay session, minus the watchers (async events keep arriving over the relay path, which
// the app also stays connected to).
func serveDirect(c *websocket.Conn) {
	defer c.Close()
	c.SetReadLimit(maxMsg)
	log.Print("direct (LAN) app connected")

	var wmu sync.Mutex
	send := func(m proto.Msg) {
		wmu.Lock()
		c.SetWriteDeadline(time.Now().Add(writeWait))
		c.WriteJSON(m)
		wmu.Unlock()
	}

	var streamOn atomic.Bool
	startStream := func() {
		if !streamOn.Swap(true) {
			go streamLoop(&streamOn, send)
		}
	}
	stopStream := func() { streamOn.Store(false) }
	defer stopStream()

	send(proto.Msg{Kind: "event", Action: "direct", Text: "on"}) // tell the app it's on the fast path

	for {
		var m proto.Msg
		if err := c.ReadJSON(&m); err != nil {
			log.Print("direct (LAN) app disconnected")
			return
		}
		if m.Kind == "input" && m.Input != nil {
			injectInput(m.Input)
			continue
		}
		if m.Kind != "cmd" {
			continue
		}
		switch m.Action {
		case "stream-start":
			startStream()
		case "stream-stop":
			stopStream()
		default:
			go handle(m, send)
		}
	}
}

// lanAddrJSON reports this laptop's private-LAN IPv4s + port so the relay can hand them to the
// app, which then tries a direct connection.
func lanAddrJSON() string {
	ips := []string{}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() {
			if ip4 := ipn.IP.To4(); ip4 != nil && ip4.IsPrivate() {
				ips = append(ips, ip4.String())
			}
		}
	}
	b, _ := json.Marshal(struct {
		IPs  []string `json:"ips"`
		Port int      `json:"port"`
	}{ips, lanPort})
	return string(b)
}
