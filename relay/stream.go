package main

import (
	"encoding/json"
	"net/http"
	"time"

	"sentivo/proto"
)

// viewerHandler serves a stream viewer for one account. The first viewer starts
// the agent's capture; the last one stops it. Input events flow back to the agent.
func viewerHandler(w http.ResponseWriter, r *http.Request) {
	acc := accountForViewerToken(r.URL.Query().Get("v"))
	if acc == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	if acc.addViewer(c) {
		acc.sendAgent(proto.Msg{Kind: "cmd", Action: "stream-start"})
	}

	c.SetReadLimit(1 << 20)
	// keepalive: without a read deadline + pinger a silently-dead viewer (sleep, network drop)
	// blocks ReadMessage forever, stays in the map, and keeps the agent capturing to nobody.
	c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPongHandler(func(string) error { c.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	done := make(chan struct{})
	go pinger(c, done)
	for {
		_, data, err := c.ReadMessage()
		if err != nil {
			break
		}
		var m proto.Msg
		if json.Unmarshal(data, &m) == nil && m.Kind == "input" && m.Input != nil {
			acc.sendAgent(m)
		}
	}
	close(done)

	if acc.removeViewer(c) {
		acc.sendAgent(proto.Msg{Kind: "cmd", Action: "stream-stop"})
	}
	c.Close()
}

func viewPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(viewHTML))
}

const viewHTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sentivo</title><body style="margin:0;background:#111">
<img id=s style="width:100%;height:auto;display:block;touch-action:none">
<script>
const t=new URLSearchParams(location.search).get('v');
const p=location.protocol=='https:'?'wss':'ws';
const img=document.getElementById('s');
let ws;
function conn(){
 ws=new WebSocket(p+'://'+location.host+'/viewer?v='+encodeURIComponent(t));
 ws.binaryType='blob';
 ws.onmessage=e=>{const u=URL.createObjectURL(e.data);img.onload=()=>URL.revokeObjectURL(u);img.src=u;};
 ws.onclose=()=>setTimeout(conn,1000);
}
function snd(o){if(ws&&ws.readyState==1)ws.send(JSON.stringify({kind:'input',input:o}));}
function pos(e){const r=img.getBoundingClientRect();return[Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
function btn(b){return b==2?'right':b==1?'middle':'left';}
img.addEventListener('pointerdown',e=>{e.preventDefault();const q=pos(e);snd({t:'down',x:q[0],y:q[1],b:btn(e.button)});});
img.addEventListener('pointerup',e=>{e.preventDefault();const q=pos(e);snd({t:'up',x:q[0],y:q[1],b:btn(e.button)});});
let lm=0;img.addEventListener('pointermove',e=>{const n=Date.now();if(n-lm<50)return;lm=n;const q=pos(e);snd({t:'move',x:q[0],y:q[1]});});
img.addEventListener('contextmenu',e=>e.preventDefault());
img.addEventListener('wheel',e=>{e.preventDefault();snd({t:'scroll',dy:e.deltaY<0?1:-1});},{passive:false});
addEventListener('keydown',e=>{e.preventDefault();snd({t:'key',k:e.key,d:true});});
addEventListener('keyup',e=>{e.preventDefault();snd({t:'key',k:e.key,d:false});});
conn();
</script>`
