package main

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"

	"sentivo/proto"

	"github.com/gorilla/websocket"
)

// account is one user's device: the agent connection plus its app/viewer connections.
type account struct {
	token string

	amu   sync.Mutex
	agent *websocket.Conn

	vmu     sync.Mutex
	viewers map[*websocket.Conn]bool

	pmu  sync.Mutex
	apps map[*websocket.Conn]bool // phone-app connections (JSON commands up, events down)

	tmu        sync.Mutex
	pushTokens map[string]bool // Expo push tokens for closed-app notifications

	cvmu        sync.Mutex
	castViewers map[*websocket.Conn]bool // laptop browsers viewing the phone's cast

	lmu     sync.Mutex
	lanAddr string // agent's latest LAN address JSON, handed to apps for a direct connection
}

func (a *account) setLanAddr(s string) { a.lmu.Lock(); a.lanAddr = s; a.lmu.Unlock() }
func (a *account) getLanAddr() string  { a.lmu.Lock(); defer a.lmu.Unlock(); return a.lanAddr }

func (a *account) addCastViewer(c *websocket.Conn) {
	a.cvmu.Lock()
	if a.castViewers == nil {
		a.castViewers = map[*websocket.Conn]bool{}
	}
	a.castViewers[c] = true
	a.cvmu.Unlock()
}

func (a *account) removeCastViewer(c *websocket.Conn) {
	a.cvmu.Lock()
	delete(a.castViewers, c)
	a.cvmu.Unlock()
}

// broadcastCast pushes a raw JPEG frame (binary) to every laptop viewing the phone cast.
func (a *account) broadcastCast(data []byte) {
	a.cvmu.Lock()
	defer a.cvmu.Unlock()
	for c := range a.castViewers {
		c.SetWriteDeadline(time.Now().Add(frameWait))
		if c.WriteMessage(websocket.BinaryMessage, data) != nil {
			c.Close()
			delete(a.castViewers, c)
		}
	}
}

func (a *account) addPushToken(t string) {
	if t == "" {
		return
	}
	a.tmu.Lock()
	if a.pushTokens == nil {
		a.pushTokens = map[string]bool{}
	}
	a.pushTokens[t] = true
	a.tmu.Unlock()
}

func (a *account) pushTokenList() []string {
	a.tmu.Lock()
	defer a.tmu.Unlock()
	out := make([]string, 0, len(a.pushTokens))
	for t := range a.pushTokens {
		out = append(out, t)
	}
	return out
}

var (
	accMu   sync.RWMutex
	byToken = map[string]*account{}
)

func newAccount(token string) *account {
	return &account{token: token, viewers: map[*websocket.Conn]bool{}, apps: map[*websocket.Conn]bool{}}
}

func accountByToken(token string) *account {
	if token == "" {
		return nil
	}
	accMu.RLock()
	defer accMu.RUnlock()
	return byToken[token]
}

// bootstrapAccount creates the single-user account for the configured token.
func bootstrapAccount(token string) *account {
	accMu.Lock()
	defer accMu.Unlock()
	a := byToken[token]
	if a == nil {
		a = newAccount(token)
		byToken[token] = a
	}
	return a
}

// --- agent connection ---

func (a *account) setAgent(c *websocket.Conn) {
	a.amu.Lock()
	old := a.agent
	a.agent = c
	a.amu.Unlock()
	if old != nil && old != c {
		old.Close() // kick the stale connection so its read loop exits now, not after pongWait (60s)
	}
}

// clearAgent nils the agent only if c is still the current one, and reports whether it did.
// On a reconnect overlap (new conn already installed), the old loop's close returns false so
// it doesn't fire a bogus dead-man alert / sticky-offline presence for a laptop that's live.
func (a *account) clearAgent(c *websocket.Conn) bool {
	a.amu.Lock()
	defer a.amu.Unlock()
	if a.agent == c {
		a.agent = nil
		return true
	}
	return false
}

func (a *account) sendAgent(m proto.Msg) bool {
	a.amu.Lock()
	defer a.amu.Unlock()
	if a.agent == nil {
		return false
	}
	a.agent.SetWriteDeadline(time.Now().Add(writeWait))
	return a.agent.WriteJSON(m) == nil
}

func (a *account) agentOnline() bool {
	a.amu.Lock()
	defer a.amu.Unlock()
	return a.agent != nil
}

// --- app connections (JSON: commands up, replies/events/frames down) ---

func (a *account) addApp(c *websocket.Conn) {
	a.pmu.Lock()
	a.apps[c] = true
	a.pmu.Unlock()
}

func (a *account) removeApp(c *websocket.Conn) {
	a.pmu.Lock()
	delete(a.apps, c)
	a.pmu.Unlock()
}

// appOnline reports whether any phone app is connected (can show an in-app snackbar).
func (a *account) appOnline() bool {
	a.pmu.Lock()
	defer a.pmu.Unlock()
	return len(a.apps) > 0
}

// writeApp writes one message to a single app connection, serialized with sendApp via pmu so
// heartbeat/presence replies (written from the app read-loop) don't race the agent's fan-out.
func (a *account) writeApp(c *websocket.Conn, m proto.Msg) {
	a.pmu.Lock()
	c.SetWriteDeadline(time.Now().Add(writeWait))
	c.WriteJSON(m)
	a.pmu.Unlock()
}

// sendApp fans a message out to every connected app (serialized by pmu, so the
// single agent read-loop never races writes to the same socket).
func (a *account) sendApp(m proto.Msg) {
	a.pmu.Lock()
	defer a.pmu.Unlock()
	for c := range a.apps {
		c.SetWriteDeadline(time.Now().Add(writeWait))
		if c.WriteJSON(m) != nil {
			c.Close()
			delete(a.apps, c)
		}
	}
}

// sendAppBinary fans a raw binary payload (a jpeg frame) to every app — no base64
// bloat, so live streaming stays lean. The app treats any binary message as a frame.
func (a *account) sendAppBinary(data []byte) {
	a.pmu.Lock()
	defer a.pmu.Unlock()
	for c := range a.apps {
		c.SetWriteDeadline(time.Now().Add(frameWait))
		if c.WriteMessage(websocket.BinaryMessage, data) != nil {
			c.Close()
			delete(a.apps, c)
		}
	}
}

// --- viewers (separate lock so frame fan-out never blocks command sends) ---

func (a *account) addViewer(c *websocket.Conn) bool {
	a.vmu.Lock()
	defer a.vmu.Unlock()
	first := len(a.viewers) == 0
	a.viewers[c] = true
	return first
}

func (a *account) removeViewer(c *websocket.Conn) bool {
	a.vmu.Lock()
	defer a.vmu.Unlock()
	delete(a.viewers, c)
	return len(a.viewers) == 0
}

func (a *account) viewerCount() int {
	a.vmu.Lock()
	defer a.vmu.Unlock()
	return len(a.viewers)
}

func (a *account) broadcast(data []byte) {
	a.vmu.Lock()
	defer a.vmu.Unlock()
	for c := range a.viewers {
		c.SetWriteDeadline(time.Now().Add(frameWait))
		if c.WriteMessage(websocket.BinaryMessage, data) != nil {
			c.Close()
			delete(a.viewers, c)
		}
	}
}

// --- ephemeral, account-scoped viewer tokens (keep AUTH_TOKEN out of URLs) ---

type vtok struct {
	acc *account
	exp time.Time
}

var (
	vtokMu sync.Mutex
	vtoks  = map[string]vtok{}
)

func (a *account) mintViewerToken() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "" // never mint a low-entropy token from a partially-filled buffer
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	vtokMu.Lock()
	now := time.Now()
	for k, v := range vtoks {
		if now.After(v.exp) {
			delete(vtoks, k) // opportunistic prune
		}
	}
	vtoks[tok] = vtok{acc: a, exp: now.Add(viewerTokenTTL)}
	vtokMu.Unlock()
	return tok
}

func accountForViewerToken(tok string) *account {
	if tok == "" {
		return nil
	}
	vtokMu.Lock()
	defer vtokMu.Unlock()
	v, ok := vtoks[tok]
	if !ok || time.Now().After(v.exp) {
		delete(vtoks, tok)
		return nil
	}
	return v.acc
}

