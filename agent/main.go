// Command agent runs on the laptop. It connects OUT to the relay over pinned
// TLS (no open ports), executes commands, and pushes watcher events. Windows-only.
package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"image/jpeg"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"sentivo/proto"

	"github.com/gorilla/websocket"
	"github.com/kbinani/screenshot"
)

var (
	relayURL = os.Getenv("RELAY_URL") // wss://your.vps:8443/agent?token=SECRET
	relayFP  = os.Getenv("RELAY_FP")  // pinned relay cert SHA-256 (hex)

	ffmpegPath     = os.Getenv("FFMPEG_PATH") // "ffmpeg" if empty (see ffmpegBin)
	camDevice      = os.Getenv("CAM_DEVICE")  // dshow video device name; auto-detected if empty
	totpSecret     = os.Getenv("TOTP_SECRET") // base32; when set, gated commands need a 2FA code
	downloadDirCfg = os.Getenv("DOWNLOAD_DIR") // where incoming files are saved
	visibleMode    = os.Getenv("VISIBLE") == "1"      // show the system-tray visible mode
	requireTOTP    = os.Getenv("REQUIRE_TOTP") == "1" // opt-in typed-code gate (default off; app uses biometric)
)

// gated commands require a valid TOTP code when totpSecret is set, so a
// compromised relay can't run them. Overridable via config totp_gated.
var gated = map[string]bool{
	"shutdown": true, "restart": true, "logoff": true, "disconnect": true,
	"alarm": true, "locate": true, "bt_on": true, "bt_off": true,
	"kill": true, "sleepin": true, "exec": true, "launch": true,
}

// JPEG quality (0-100) and stream frame rate, overridable via config/commands.
var (
	shotQuality   = 85
	streamQuality atomic.Int32 // JPEG quality 0-100; atomic — stream goroutine reads while setq writes
	streamFPS     atomic.Int32 // target fps; paced per frame
)

// After a valid 2FA code, gated commands skip the code for graceMinutes (0 = off).
var (
	graceMinutes int
	graceUntil   time.Time
	graceMu      sync.Mutex
)

func inGrace() bool {
	if graceMinutes <= 0 {
		return false
	}
	graceMu.Lock()
	defer graceMu.Unlock()
	return time.Now().Before(graceUntil)
}

func openGrace() {
	if graceMinutes <= 0 {
		return
	}
	graceMu.Lock()
	graceUntil = time.Now().Add(time.Duration(graceMinutes) * time.Minute)
	graceMu.Unlock()
}

// globalSend lets the tray (visible mode) push messages to the app over the
// live connection. Set by run() while connected, cleared on disconnect.
var (
	globalSendMu sync.Mutex
	globalSend   func(proto.Msg)
)

func setGlobalSend(f func(proto.Msg)) {
	globalSendMu.Lock()
	globalSend = f
	globalSendMu.Unlock()
}

func trayEmit(m proto.Msg) {
	globalSendMu.Lock()
	f := globalSend
	globalSendMu.Unlock()
	if f != nil {
		f(m)
	}
}

// emitEvent delivers a watcher event to the app over the current relay connection and fires any
// matching rules. Watchers call this so they run once for the process (started in main), instead
// of being respawned — and leaked — on every relay reconnect.
func emitEvent(m proto.Msg) {
	trayEmit(m)
	if strings.HasPrefix(m.Action, "ev_") {
		go runRules(strings.TrimPrefix(m.Action, "ev_"))
	}
}

// startWatchers launches every sensor/watcher exactly once for the process lifetime.
func startWatchers() {
	go watchLock(emitEvent)
	go watchPower(emitEvent)
	go watchActivity(emitEvent)
	go watchDrives(emitEvent)
	go watchMic(emitEvent)
	go watchCamera(emitEvent)
	go watchClipboard(trayEmit)
	go watchNotifications(emitEvent)
}

// recent plain-text messages you sent the bot, shown in the tray "Recent" submenu.
var (
	chatMu   sync.Mutex
	chatMsgs []string
)

func addChatMsg(s string) {
	if s = strings.TrimSpace(s); s == "" {
		return
	}
	chatMu.Lock()
	chatMsgs = append(chatMsgs, s)
	if len(chatMsgs) > 8 {
		chatMsgs = chatMsgs[len(chatMsgs)-8:]
	}
	chatMu.Unlock()
}

func recentChat() []string {
	chatMu.Lock()
	defer chatMu.Unlock()
	out := make([]string, len(chatMsgs))
	for i := range chatMsgs {
		out[len(chatMsgs)-1-i] = chatMsgs[i] // most recent first
	}
	return out
}

const (
	pongWait  = 60 * time.Second // reconnect if no ping from relay within this
	writeWait = 10 * time.Second
	maxMsg    = 48 << 20 // commands are tiny; a /put file transfer can be up to ~27MB base64
)

// armed gates "nearby-mode" alerts (activity, USB). Critical alerts
// (power unplugged, dead-man) ignore it. Default armed.
var armed atomic.Bool

// micOn / camOn are the opt-in sensors; off by default (privacy + resource).
var (
	micOn     atomic.Bool
	camOn     atomic.Bool
	micMuted  atomic.Bool
	clipOn    atomic.Bool
	connected atomic.Bool // true while the relay connection is live
)

func main() {
	loadConfig()
	if relayURL == "" {
		log.Fatal("missing relay_url (config.json beside the exe, or RELAY_URL env)")
	}
	if streamFPS.Load() == 0 {
		streamFPS.Store(15) // default target frame rate
	}
	if streamQuality.Load() == 0 {
		streamQuality.Store(65) // default JPEG quality
	}
	startGPUSampler()
	loadRules()
	loadTune()
	startLAN()       // direct same-network fast path (falls back to the relay when off-network)
	startWatchers()  // sensors run once for the process, delivering via the current relay link
	// disarmed by default — you arm it when you step away
	if visibleMode {
		go agentLoop()
		runTray() // "visible mode": tray icon + menu; blocks (systray needs the main thread)
		return
	}
	agentLoop()
}

func agentLoop() {
	for {
		if err := run(); err != nil {
			log.Printf("disconnected: %v; retry in 5s", err)
		}
		time.Sleep(5 * time.Second) // survives network switch / brief offline, no re-pairing
	}
}

func run() error {
	var d websocket.Dialer
	if relayFP != "" {
		d.TLSClientConfig = pinnedTLS(relayFP) // pin a self-signed relay cert
	}
	// else: verify against the system CA store (a real cert via a domain/reverse proxy)
	c, _, err := d.Dial(relayURL, nil)
	if err != nil {
		return err
	}
	defer c.Close()
	log.Print("connected to relay")
	connected.Store(true)
	defer connected.Store(false)

	// Keepalive: the relay pings every 30s. Reset the read deadline on each ping
	// (and pong back). If the relay dies silently, no pings arrive, the deadline
	// expires, ReadJSON errors, and main() reconnects.
	c.SetReadLimit(maxMsg)
	c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPingHandler(func(appData string) error {
		c.SetReadDeadline(time.Now().Add(pongWait))
		err := c.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(writeWait))
		if err == websocket.ErrCloseSent {
			return nil
		}
		return err
	})

	var wmu sync.Mutex
	send := func(m proto.Msg) {
		wmu.Lock()
		c.SetWriteDeadline(time.Now().Add(writeWait))
		c.WriteJSON(m)
		wmu.Unlock()
	}
	setGlobalSend(send) // let the tray push to the app

	// advertise our LAN address so a same-network app can connect directly (relay forwards it)
	send(proto.Msg{Kind: "event", Action: "lanaddr", Text: lanAddrJSON()})
	defer setGlobalSend(nil)

	// Streaming: capture only while a viewer is connected (relay sends
	// stream-start/stop). Tied to this connection — defer stop cleans it up on drop.
	var streamOn atomic.Bool
	startStream := func() {
		if streamOn.Swap(true) {
			return
		}
		go streamLoop(&streamOn, send)
	}
	stopStream := func() { streamOn.Store(false) }
	defer stopStream()
	defer resetMods() // release any held Ctrl/Alt/Meta if the viewer drops mid-combo
	// watchers run once for the process (started in main), delivering via the current relay
	// connection (trayEmit → globalSend). This avoids leaking a fresh watcher set per reconnect.

	for {
		var m proto.Msg
		if err := c.ReadJSON(&m); err != nil {
			return err
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

func handle(m proto.Msg, send func(proto.Msg)) {
	// 2FA: gated commands need a valid TOTP code (verified here, on the device —
	// the relay never holds the secret, so it can't forge these).
	// App-only model: the device token + pinned TLS + app-side biometric are the auth,
	// so typed codes are off by default. Set require_totp for the old code-per-action gate.
	if requireTOTP && totpSecret != "" && gated[m.Action] && !inGrace() {
		if !verifyCode(totpSecret, lastArg(m.Text)) {
			send(proto.Msg{Kind: "reply", Text: "🔐 2FA code required — e.g.  /" + m.Action + " 123456"})
			return
		}
		openGrace() // start a no-code window if totp_grace_min is configured
	}
	switch m.Action {
	case "status":
		send(proto.Msg{Kind: "reply", Text: statusText()})
	case "sentivo":
		send(proto.Msg{Kind: "reply", Text: sentivoStatus()})
	case "arm":
		armed.Store(true)
		send(proto.Msg{Kind: "reply", Text: "🛡️ armed"})
	case "disarm":
		armed.Store(false)
		send(proto.Msg{Kind: "reply", Text: "😴 disarmed (nearby mode)"})
	case "mic":
		on := !micOn.Load()
		micOn.Store(on)
		send(proto.Msg{Kind: "reply", Text: onOff(on, "🎤 mic sensor ON — fires while armed", "🎤 mic sensor off")})
	case "micmute":
		mute := !micMuted.Load()
		micMuted.Store(mute)
		send(proto.Msg{Kind: "reply", Text: setMicMute(mute)})
	case "cam":
		on := !camOn.Load()
		camOn.Store(on)
		send(proto.Msg{Kind: "reply", Text: onOff(on, "📷 camera sensor ON — fires while armed", "📷 camera sensor off")})
		if on && !ffmpegReady() {
			// motion detection needs ffmpeg to grab webcam frames; fetch it once so the
			// camera actually turns on (previously it stayed dark if ffmpeg was missing).
			send(proto.Msg{Kind: "reply", Text: "⚙️ camera needs ffmpeg — downloading once (~1 min)…"})
			go func() {
				if err := ensureFFmpeg(); err != nil {
					send(proto.Msg{Kind: "event", Text: "📷 camera setup failed — " + err.Error()})
				} else {
					send(proto.Msg{Kind: "event", Text: "📷 camera ready — motion detection active while armed"})
				}
			}()
		}
	case "test":
		// a REAL laptop notification (Windows toast) + deliver it to the phone (via the relay → push)
		showToast("Sentivo", "Test notification from your laptop — this should reach your phone")
		emitEvent(proto.Msg{Kind: "event", Text: "🔔 A notification fired on your laptop — it should reach your phone"})
		send(proto.Msg{Kind: "reply", Text: "🔔 fired a notification on the laptop + sent it to your phone"})
	case "ping":
		send(proto.Msg{Kind: "reply", Action: "pong", Text: m.Text}) // echo back for a latency measurement
	case "photo":
		if !ffmpegReady() {
			send(proto.Msg{Kind: "reply", Text: "⚙️ one-time setup: downloading ffmpeg (~1 min)..."})
		}
		data, err := snapCam()
		if err != nil {
			send(proto.Msg{Kind: "reply", Text: err.Error()})
			return
		}
		send(proto.Msg{Kind: "reply", Text: "📷", Data: data})
	case "alarm":
		send(proto.Msg{Kind: "reply", Text: "🚨 sounding alarm"})
		alarm()
	case "stopalarm":
		stopAlarm()
		send(proto.Msg{Kind: "reply", Text: "🔇 alarm off"})
	case "ls":
		send(proto.Msg{Kind: "reply", Action: "ls", Text: listDir(m.Text)})
	case "exec":
		send(proto.Msg{Kind: "reply", Action: "exec", Text: runShell(m.Text)})
	case "media":
		mediaKey(m.Text) // playpause/next/prev/stop/volup/voldown/mute — fire-and-forget
	case "mediastate":
		send(proto.Msg{Kind: "reply", Action: "mediastate", Text: mediaState()})
	case "screenmsg":
		screenMsg(m.Text)
		send(proto.Msg{Kind: "reply", Text: "📢 message shown on the laptop screen"})
	case "applist":
		send(proto.Msg{Kind: "reply", Action: "applist", Text: appListJSON()})
	case "launch":
		send(proto.Msg{Kind: "reply", Action: "launch", Text: launchApp(m.Text)})
	case "focus":
		send(proto.Msg{Kind: "reply", Action: "focus", Text: focusApp(m.Text)})
	case "perf":
		send(proto.Msg{Kind: "reply", Text: setPerf(m.Text)})
	case "brightness":
		send(proto.Msg{Kind: "reply", Text: setBrightness(m.Text)})
	case "net":
		send(proto.Msg{Kind: "reply", Action: "net", Text: netJSON()})
	case "getrules":
		send(proto.Msg{Kind: "reply", Action: "rules", Text: rulesJSON()})
	case "setrules":
		setRules(m.Text)
		send(proto.Msg{Kind: "reply", Action: "rules", Text: rulesJSON()})
	case "gettune":
		send(proto.Msg{Kind: "reply", Action: "tune", Text: tuneJSON()})
	case "settune":
		setTune(m.Text)
		send(proto.Msg{Kind: "reply", Action: "tune", Text: tuneJSON()})
	case "get":
		data, name, err := readFileFor(m.Text)
		if err != nil {
			send(proto.Msg{Kind: "reply", Text: "get failed: " + err.Error()})
			return
		}
		send(proto.Msg{Kind: "file", Text: name, Data: data})
	case "put":
		p, err := saveIncoming(m.Text, m.Data)
		if err != nil {
			send(proto.Msg{Kind: "reply", Text: "save failed: " + err.Error()})
			return
		}
		send(proto.Msg{Kind: "reply", Text: "📥 saved to " + p})
	case "chatmsg":
		addChatMsg(m.Text) // plain text you sent -> tray "Recent" list
	case "notify_on":
		notifyOn.Store(true)
		notifPrimed.Store(false)
		send(proto.Msg{Kind: "reply", Text: "🔔 notifications ON — I'll forward Windows toasts (grant PowerShell notification access if prompted)"})
	case "notify_off":
		notifyOn.Store(false)
		send(proto.Msg{Kind: "reply", Text: "🔔 notifications off"})
	case "clip":
		send(proto.Msg{Kind: "reply", Action: "clip", Text: clipText()})
	case "clip_on":
		clipOn.Store(true)
		send(proto.Msg{Kind: "reply", Text: "📋 clipboard sync on — copies come to the app"})
	case "clip_off":
		clipOn.Store(false)
		send(proto.Msg{Kind: "reply", Text: "📋 clipboard sync off"})
	case "setclip":
		send(proto.Msg{Kind: "reply", Text: clipWrite(m.Text)})
	case "paste":
		// instant phone→laptop: set the clipboard, then Ctrl+V at the focused control
		if m.Text != "" {
			clipWrite(m.Text)
		}
		pasteKeystroke()
		send(proto.Msg{Kind: "reply", Text: "📋 pasted to the laptop"})
	case "ps":
		send(proto.Msg{Kind: "reply", Text: processList()})
	case "pslist":
		send(proto.Msg{Kind: "reply", Action: "pslist", Text: processListJSON()})
	case "statjson":
		send(proto.Msg{Kind: "reply", Action: "statjson", Text: statJSON()})
	case "setfps":
		if n, err := strconv.Atoi(firstArg(m.Text)); err == nil && n >= 1 && n <= 60 {
			streamFPS.Store(int32(n))
			send(proto.Msg{Kind: "reply", Text: fmt.Sprintf("🎞️ stream now %d fps", n)})
		}
	case "setq":
		if n, err := strconv.Atoi(firstArg(m.Text)); err == nil && n >= 20 && n <= 95 {
			streamQuality.Store(int32(n))
			send(proto.Msg{Kind: "reply", Text: fmt.Sprintf("🎨 stream quality %d", n)})
		}
	case "kill":
		send(proto.Msg{Kind: "reply", Text: killPID(firstArg(m.Text))})
	case "sleepin":
		n, err := strconv.Atoi(firstArg(m.Text))
		if err != nil || n <= 0 {
			send(proto.Msg{Kind: "reply", Text: "usage:  /sleepin <minutes> <2FA-code>"})
			return
		}
		send(proto.Msg{Kind: "reply", Text: fmt.Sprintf("😴 sleeping in %d min", n)})
		time.AfterFunc(time.Duration(n)*time.Minute, func() {
			noWin(exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0")).Run()
		})
	case "locate":
		send(proto.Msg{Kind: "reply", Text: locate()})
	case "bt":
		send(proto.Msg{Kind: "reply", Text: btScan()})
	case "bt_on":
		send(proto.Msg{Kind: "reply", Text: btRadio("On")})
	case "bt_off":
		send(proto.Msg{Kind: "reply", Text: btRadio("Off")})
	case "lock":
		noWin(exec.Command("rundll32.exe", "user32.dll,LockWorkStation")).Run()
		send(proto.Msg{Kind: "reply", Text: "🔒 locked"})
	case "sleep":
		send(proto.Msg{Kind: "reply", Text: "😴 sleeping"})
		noWin(exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0")).Run()
	case "shutdown":
		send(proto.Msg{Kind: "reply", Text: "⏻ shutting down"})
		noWin(exec.Command("shutdown", "/s", "/t", "0")).Run()
	case "restart":
		send(proto.Msg{Kind: "reply", Text: "🔄 restarting"})
		noWin(exec.Command("shutdown", "/r", "/t", "0")).Run()
	case "logoff":
		send(proto.Msg{Kind: "reply", Text: "👋 logging off"})
		noWin(exec.Command("shutdown", "/l")).Run()
	case "cancel":
		if noWin(exec.Command("shutdown", "/a")).Run() != nil {
			send(proto.Msg{Kind: "reply", Text: "nothing to cancel"})
		} else {
			send(proto.Msg{Kind: "reply", Text: "✋ cancelled pending shutdown/restart"})
		}
	case "disconnect":
		// manual kill switch from the bot: stop now, come back at next sign-in
		// (the scheduled task's logon trigger). The relay's dead-man alert fires too.
		send(proto.Msg{Kind: "reply", Text: "🔌 Disconnecting — back at next sign-in (or run start-agent.ps1)."})
		time.Sleep(500 * time.Millisecond) // let the reply flush
		os.Exit(0)
	case "wake":
		wakeScreen()
		send(proto.Msg{Kind: "reply", Text: "☀️ woke the display"})
	case "screenshot":
		data, err := grab()
		if err != nil {
			send(proto.Msg{Kind: "reply", Text: "screenshot failed: " + err.Error()})
			return
		}
		send(proto.Msg{Kind: "reply", Text: "📸", Data: data})
	}
}

// streamLoop captures + ships frames while `on` is true. Shared by the relay session and any
// direct-LAN session. Cheap capture (BitBlt) every tick; the expensive JPEG-encode + send is
// skipped when the screen is unchanged, with a 2s keyframe so a new viewer / dropped frame recovers.
func streamLoop(on *atomic.Bool, send func(proto.Msg)) {
	var lastHash uint64
	var lastSent time.Time
	for on.Load() {
		start := time.Now()
		if img, err := screenshot.CaptureDisplay(0); err == nil {
			h := fnv.New64a()
			h.Write(img.Pix)
			cx, cy, _ := cursorPos()
			sum := h.Sum64() ^ (uint64(uint32(cx))<<20 | uint64(uint32(cy))) // fold cursor pos: moving it counts as a change
			if sum != lastHash || time.Since(lastSent) > 2*time.Second {
				drawCursor(img) // the grab omits the pointer; paint it on so remote control isn't blind
				var b bytes.Buffer
				if jpeg.Encode(&b, img, &jpeg.Options{Quality: int(streamQuality.Load())}) == nil {
					send(proto.Msg{Kind: "frame", Data: b.Bytes()})
					lastHash = sum
					lastSent = time.Now()
				}
			}
		}
		fps := streamFPS.Load()
		if fps < 1 {
			fps = 1
		}
		if d := time.Second/time.Duration(fps) - time.Since(start); d > 0 {
			time.Sleep(d)
		}
	}
}

func grab() ([]byte, error) { return grabQ(shotQuality) }

func grabQ(q int) ([]byte, error) {
	img, err := screenshot.CaptureDisplay(0)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: q}); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// watchLock polls the lock state and reports transitions. 3s poll,
// swap to WTSRegisterSessionNotification if you need instant + reason codes.
func watchLock(send func(proto.Msg)) {
	last := isLocked()
	for {
		time.Sleep(3 * time.Second)
		if now := isLocked(); now != last {
			last = now
			if now {
				send(proto.Msg{Kind: "event", Action: "ev_lock", Text: "🔒 Your laptop was locked"})
			} else {
				send(proto.Msg{Kind: "event", Action: "ev_unlock", Text: "🔓 Your laptop was unlocked — someone signed in"})
			}
		}
	}
}

// loadConfig fills relayURL/relayFP from config.json next to the exe when the
// env vars aren't set. env wins so you can override for debugging.
func loadConfig() {
	if relayURL != "" && relayFP != "" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "config.json"))
	if err != nil {
		return
	}
	var c struct {
		RelayURL   string   `json:"relay_url"`
		RelayFP    string   `json:"relay_fp"`
		CamDevice  string   `json:"cam_device"`
		FfmpegPath string   `json:"ffmpeg_path"`
		TOTPSecret    string   `json:"totp_secret"`
		TOTPGated     []string `json:"totp_gated"`
		ShotQuality   int      `json:"screenshot_quality"`
		StreamQuality int      `json:"stream_quality"`
		StreamFPS     int      `json:"stream_fps"`
		DownloadDir   string   `json:"download_dir"`
		TOTPGraceMin  int      `json:"totp_grace_min"`
		Visible       bool     `json:"visible"`
		RequireTOTP   bool     `json:"require_totp"`
	}
	if json.Unmarshal(b, &c) == nil {
		if relayURL == "" {
			relayURL = c.RelayURL
		}
		if relayFP == "" {
			relayFP = c.RelayFP
		}
		if camDevice == "" {
			camDevice = c.CamDevice
		}
		if ffmpegPath == "" {
			ffmpegPath = c.FfmpegPath
		}
		if totpSecret == "" {
			totpSecret = c.TOTPSecret
		}
		if len(c.TOTPGated) > 0 { // custom gated set overrides the default
			gated = map[string]bool{}
			for _, a := range c.TOTPGated {
				gated[a] = true
			}
		}
		if c.ShotQuality > 0 {
			shotQuality = c.ShotQuality
		}
		if c.StreamFPS > 0 {
			streamFPS.Store(int32(c.StreamFPS))
		}
		if c.StreamQuality > 0 {
			streamQuality.Store(int32(c.StreamQuality))
		}
		if downloadDirCfg == "" {
			downloadDirCfg = c.DownloadDir
		}
		if c.TOTPGraceMin > 0 {
			graceMinutes = c.TOTPGraceMin
		}
		if c.Visible {
			visibleMode = true
		}
		if c.RequireTOTP {
			requireTOTP = true
		}
	}
}

// watchPower alerts on AC plug/unplug (a strong theft signal) and low battery.
func watchPower(send func(proto.Msg)) {
	lastAC, _, ok := getPowerStatus()
	lowSent := false
	for {
		time.Sleep(10 * time.Second)
		ac, pct, valid := getPowerStatus()
		if !valid {
			continue
		}
		if ok && ac != lastAC {
			if ac == 1 {
				send(proto.Msg{Kind: "event", Action: "ev_plugged", Text: "🔌 power connected"})
			} else {
				send(proto.Msg{Kind: "event", Action: "ev_unplugged", Text: "⚡ power UNPLUGGED"})
			}
		}
		switch {
		case pct <= 15 && !lowSent:
			send(proto.Msg{Kind: "event", Action: "ev_lowbat", Text: "🪫 battery low: " + strconv.Itoa(int(pct)) + "%"})
			lowSent = true
		case pct > 20:
			lowSent = false
		}
		lastAC, ok = ac, true
	}
}

// watchActivity alerts while armed: "someone started using your laptop" on the first key/mouse
// input after you arm or after it's gone quiet (~30s), then a periodic "still being used"
// reminder every 2 min while it stays in use. Not per-keystroke.
func watchActivity(send func(proto.Msg)) {
	active := true // don't fire the instant you arm while you're still at the machine
	wasArmed := false
	var lastAlert time.Time
	for {
		time.Sleep(3 * time.Second)
		armedNow := armed.Load()
		if armedNow && !wasArmed {
			active = false // just armed: you're leaving, so the next input is someone else
		}
		wasArmed = armedNow
		idle := idleSeconds()
		if int(idle) >= getTune().Idle { // quiet past the tunable idle window → re-arm the detector
			active = false
			continue
		}
		if idle >= 4 { // no fresh input this tick
			continue
		}
		if !active { // first input after idle / after arming — someone STARTED
			active = true
			if armedNow {
				lastAlert = time.Now()
				send(proto.Msg{Kind: "event", Action: "ev_activity", Text: "👀 Someone started using your laptop"})
				if data, err := snapCam(); err == nil { // best-effort: show who
					send(proto.Msg{Kind: "event", Text: "📷 tamper snapshot", Data: data})
				}
			}
		} else if armedNow && time.Since(lastAlert) >= 2*time.Minute { // still in use → remind
			lastAlert = time.Now()
			send(proto.Msg{Kind: "event", Action: "ev_activity", Text: "👀 Your laptop is still being used"})
		}
	}
}

// watchDrives alerts when a removable drive appears while armed.
// Note: catches USB sticks (DRIVE_REMOVABLE); non-storage USB (HID) needs a
// WM_DEVICECHANGE message loop — add that when tamper coverage must be total.
func watchDrives(send func(proto.Msg)) {
	prev := removableDrives()
	for {
		time.Sleep(5 * time.Second)
		now := removableDrives()
		for d := range now {
			if !prev[d] && armed.Load() {
				send(proto.Msg{Kind: "event", Action: "ev_usb", Text: "🔌 USB drive inserted: " + d})
			}
		}
		prev = now
	}
}

func pinnedTLS(fp string) *tls.Config {
	return &tls.Config{
		InsecureSkipVerify: true, // verification is done by fingerprint pin below
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 {
				return errors.New("relay presented no certificate") // else raw[0] panics
			}
			sum := sha256.Sum256(raw[0])
			if hex.EncodeToString(sum[:]) != fp {
				return errors.New("relay cert fingerprint mismatch")
			}
			return nil
		},
	}
}

func yn(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

func onOff(b bool, yes, no string) string {
	if b {
		return yes
	}
	return no
}

func firstArg(s string) string {
	if f := strings.Fields(s); len(f) > 0 {
		return f[0]
	}
	return ""
}

func lastArg(s string) string {
	if f := strings.Fields(s); len(f) > 0 {
		return f[len(f)-1]
	}
	return ""
}

func fmtDur(d time.Duration) string {
	d = d.Round(time.Minute)
	days := d / (24 * time.Hour)
	d -= days * 24 * time.Hour
	h := d / time.Hour
	m := (d - h*time.Hour) / time.Minute
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, h, m)
	}
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}

var startTime = time.Now()

// sentivoStatus reports Sentivo's own state (mode, sensors, 2FA) — vs statusText
// which reports the device (CPU/RAM/disk).
func sentivoStatus() string {
	return "🔰 Sentivo\n" +
		"mode: " + onOff(visibleMode, "visible (tray)", "hidden") + "\n" +
		"🛡 " + onOff(armed.Load(), "armed", "disarmed") + "\n" +
		"🎤 mic " + onOff(micOn.Load(), "on", "off") +
		"   📷 cam " + onOff(camOn.Load(), "on", "off") +
		"   📋 clip " + onOff(clipOn.Load(), "on", "off") + "\n" +
		"🔔 notifications " + onOff(notifyOn.Load(), "on", "off") + "\n" +
		"🔐 2FA: " + onOff(totpSecret != "", "on", "off") + "\n" +
		"⏱️ agent up " + fmtDur(time.Since(startTime))
}

func statusText() string {
	h, _ := os.Hostname()
	ru, rt, rp := memInfo()
	du, dt := diskInfo()
	return fmt.Sprintf(
		"🖥️ %s\n"+
			"⏱️ up %s    🧠 CPU %d%%\n"+
			"🧮 RAM %.1f/%.1f GB (%d%%)\n"+
			"🗄️ disk used %.0f / %.0f GB\n"+
			"🔒 locked %s    🛡️ armed %s\n"+
			"🎤 mic %s   📷 cam %s   📋 clip %s   😴 idle %ds",
		h, fmtDur(uptime()), cpuPercent(),
		ru, rt, rp, du, dt,
		yn(isLocked()), yn(armed.Load()), yn(micOn.Load()), yn(camOn.Load()), yn(clipOn.Load()), int(idleSeconds()))
}
