package main

import (
	"net/http"
	"time"
)

// castViewerHandler: a laptop browser viewing the phone's screen cast. Frames arrive from
// the phone app (via appHandler → broadcastCast) and are pushed here as base64 JPEG text.
func castViewerHandler(w http.ResponseWriter, r *http.Request) {
	acc := accountForViewerToken(r.URL.Query().Get("v"))
	if acc == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	acc.addCastViewer(c)
	c.SetReadDeadline(time.Now().Add(pongWait)) // reap a silently-dead cast browser
	c.SetPongHandler(func(string) error { c.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	done := make(chan struct{})
	go pinger(c, done)
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			break
		}
	}
	close(done)
	acc.removeCastViewer(c)
	c.Close()
}

func castPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(castHTML))
}

const castHTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sentivo — phone screen</title>
<body style="margin:0;background:#0b0b0d;display:flex;align-items:center;justify-content:center;height:100vh">
<img id=s style="max-width:100%;max-height:100vh;display:block">
<div id=w style="position:fixed;color:#7c8794;font:15px system-ui">Waiting for the phone…</div>
<script>
const t=new URLSearchParams(location.search).get('v');
const p=location.protocol=='https:'?'wss':'ws';
const img=document.getElementById('s'),wait=document.getElementById('w');
let ws;
function conn(){
 ws=new WebSocket(p+'://'+location.host+'/castviewer?v='+encodeURIComponent(t));
 ws.binaryType='blob';
 ws.onmessage=e=>{const u=URL.createObjectURL(e.data);img.onload=()=>URL.revokeObjectURL(u);img.src=u;wait.style.display='none';};
 ws.onclose=()=>setTimeout(conn,1000);
}
conn();
</script>`
