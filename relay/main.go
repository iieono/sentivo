// Command relay is the always-on brain. The laptop agent connects out to it; the phone
// app drives it. Single-user: one account is bootstrapped from AUTH_TOKEN.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"sentivo/proto"

	"github.com/gorilla/websocket"
)

var (
	authToken = os.Getenv("AUTH_TOKEN")
	addrCfg   = os.Getenv("ADDR")
	publicURL = os.Getenv("PUBLIC_URL")
	noTLS     = os.Getenv("NO_TLS") == "1" // serve plain HTTP; a proxy (Dokploy/Traefik) terminates TLS
)

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
var httpClient = &http.Client{Timeout: 60 * time.Second}

const (
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	writeWait      = 10 * time.Second
	frameWait      = 2 * time.Second // frame fan-out: drop a slow consumer fast, don't stall the agent loop
	maxMsg         = 48 << 20 // screenshots are small; a /get file transfer can be ~27MB base64
	viewerTokenTTL = 10 * time.Minute
)

func main() {
	loadConfig()
	if authToken == "" {
		log.Fatal("relay needs AUTH_TOKEN (env or config.json)")
	}
	bootstrapAccount(authToken) // single-user: one account for the configured token
	addr := addrCfg
	if addr == "" {
		addr = ":8443"
	}
	http.HandleFunc("/agent", agentHandler)
	http.HandleFunc("/app", appHandler)
	http.HandleFunc("/viewer", viewerHandler)
	http.HandleFunc("/view", viewPage)
	http.HandleFunc("/cast", castPage)
	http.HandleFunc("/castviewer", castViewerHandler)
	if noTLS {
		log.Printf("relay on %s — plain HTTP, TLS terminated upstream", addr)
		log.Fatal(http.ListenAndServe(addr, nil))
	}
	log.Printf("relay on %s — self-signed TLS", addr)
	log.Fatal(serveTLS(addr, nil)) // serveTLS (tls.go) generates/loads a self-signed cert
}

func loadConfig() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "config.json"))
	if err != nil {
		return
	}
	var c struct {
		AuthToken string `json:"auth_token"`
		Addr      string `json:"addr"`
		PublicURL string `json:"public_url"`
		NoTLS     bool   `json:"no_tls"`
	}
	if json.Unmarshal(b, &c) != nil {
		return
	}
	setIfEmpty(&authToken, c.AuthToken)
	setIfEmpty(&addrCfg, c.Addr)
	setIfEmpty(&publicURL, c.PublicURL)
	if c.NoTLS {
		noTLS = true
	}
}

func setIfEmpty(p *string, v string) {
	if *p == "" {
		*p = v
	}
}

// agentHandler attaches an agent to its account. The token must match the account
// bootstrapped from AUTH_TOKEN, so a random token can't attach.
func agentHandler(w http.ResponseWriter, r *http.Request) {
	acc := accountByToken(r.URL.Query().Get("token"))
	if acc == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c.SetReadLimit(maxMsg)
	c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPongHandler(func(string) error { c.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	acc.setAgent(c)
	log.Printf("agent online: %s", r.RemoteAddr)
	acc.sendApp(proto.Msg{Kind: "event", Action: "presence", Text: "online"})

	done := make(chan struct{})
	go pinger(c, done)

	for {
		var m proto.Msg
		if err := c.ReadJSON(&m); err != nil {
			break
		}
		if m.Kind == "frame" {
			acc.broadcast(m.Data)     // browser viewers (binary)
			acc.sendAppBinary(m.Data) // app: raw binary frames (no base64 bloat)
			continue
		}
		if m.Action == "lanaddr" {
			acc.setLanAddr(m.Text) // cache for late-joining apps
			acc.sendApp(m)         // forward to connected apps; not a push-worthy event
			continue
		}
		acc.sendApp(m) // everything to the app as JSON
		if m.Kind == "event" && m.Text != "" {
			if m.Action == "clip" {
				// clipboard copies show as an in-app snackbar when the app is open; when it's
				// closed, deliver them as a push so that "snackbar" still reaches you.
				if !acc.appOnline() {
					acc.push("📋 Copied on your laptop", m.Text)
				}
			} else if !acc.appOnline() {
				// app closed → push it; if the app is open it shows the alert itself, so pushing
				// too would double-notify. (motion / mic / tamper / activity / forwarded toast)
				acc.push("Sentivo", m.Text)
			}
		}
	}

	close(done)
	if acc.clearAgent(c) { // only the genuinely-current agent dropping is an "offline" — not a reconnect
		log.Print("agent offline")
		acc.sendApp(proto.Msg{Kind: "event", Action: "presence", Text: "offline"})
		if !acc.appOnline() { // app open → the presence event already shows it; don't double-notify
			acc.push("Sentivo", "🔴 Your laptop went offline") // dead-man alert reaches the closed app
		}
	}
}

// appHandler is the phone app's channel: authenticate with the device token, send
// commands up (JSON proto.Msg), receive replies/events/frames down.
func appHandler(w http.ResponseWriter, r *http.Request) {
	acc := accountByToken(r.URL.Query().Get("token"))
	if acc == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c.SetReadLimit(maxMsg)
	c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPongHandler(func(string) error { c.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	presence := "offline"
	if acc.agentOnline() {
		presence = "online"
	}
	c.WriteJSON(proto.Msg{Kind: "event", Action: "presence", Text: presence}) // before addApp: no write race
	acc.addApp(c)
	if la := acc.getLanAddr(); la != "" { // hand a late-joining app the agent's LAN address
		acc.writeApp(c, proto.Msg{Kind: "event", Action: "lanaddr", Text: la})
	}
	log.Printf("app online: %s", r.RemoteAddr)

	done := make(chan struct{})
	go pinger(c, done)
	for {
		var m proto.Msg
		if err := c.ReadJSON(&m); err != nil {
			break
		}
		if m.Action == "hb" {
			acc.writeApp(c, proto.Msg{Kind: "reply", Action: "hb"}) // heartbeat echo → app detects a dead link
			continue
		}
		if m.Action == "pushtoken" {
			acc.addPushToken(m.Text) // register this device for push; don't forward to the agent
			continue
		}
		if m.Action == "castframe" {
			acc.broadcastCast(m.Data) // phone screen frame → laptop cast viewers, not the agent
			continue
		}
		if m.Action == "cast-start" {
			tok := acc.mintViewerToken()
			acc.sendAgent(proto.Msg{Kind: "cmd", Action: "launch", Text: publicURL + "/cast?v=" + tok}) // laptop opens the viewer
			acc.writeApp(c, proto.Msg{Kind: "reply", Text: "🖥️ opening the cast on your laptop…"})
			continue
		}
		if m.Kind != "input" {
			m.Kind = "cmd" // the app sends commands and remote-control input; force the rest to cmd
		}
		acc.sendAgent(m)
	}
	close(done)
	acc.removeApp(c)
	// if the app dropped mid-stream (force-killed, network drop) and nothing else is watching,
	// tell the agent to stop capturing — otherwise it streams to nobody, burning CPU/battery.
	if !acc.appOnline() && acc.viewerCount() == 0 {
		acc.sendAgent(proto.Msg{Kind: "cmd", Action: "stream-stop"})
	}
	log.Print("app offline")
}

// pinger keeps the connection alive so a silent network drop is detected within
// pongWait (the read loop errors → dead-man alert). WriteControl is concurrency-safe.
func pinger(c *websocket.Conn, done chan struct{}) {
	t := time.NewTicker(pingPeriod)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
			if c.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)) != nil {
				return
			}
		}
	}
}
