import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { storeDel, storeGet, storeSet } from './storage';
import { recordEvent } from './events';

export type Msg = { Kind?: string; Action?: string; Text?: string; Data?: string; Input?: string };
type Status = 'idle' | 'connecting' | 'connected' | 'error';
type Presence = 'online' | 'offline' | 'unknown';

type Ctx = {
  status: Status;
  presence: Presence;
  onLan: boolean; // connected to the laptop directly over the same network (fast path)
  paired: boolean;
  booting: boolean; // still checking stored creds — show a splash, not the login page
  relayUrl: string;
  connect: (url: string, token: string) => void;
  forget: () => Promise<void>;
  send: (action: string, text?: string) => void;
  sendInput: (input: object) => void;
  sendFile: (name: string, dataB64: string) => void;
  sendCast: (dataB64: string) => void;
  setKeepAlive: (v: boolean) => void;
  subscribe: (fn: (m: Msg) => void) => () => void;
};

const ConnCtx = createContext<Ctx>(null as any);
export const useConn = () => useContext(ConnCtx);

// live frames arrive as raw binary; Image needs base64, so encode (chunked to avoid
// a stack overflow on String.fromCharCode with a large frame).
function abToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return typeof btoa !== 'undefined' ? btoa(bin) : (globalThis as any).Buffer.from(bin, 'binary').toString('base64');
}

export function ConnProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [presence, setPresence] = useState<Presence>('unknown');
  const [paired, setPaired] = useState(false);
  const [booting, setBooting] = useState(true);
  const [relayUrl, setRelayUrl] = useState('');

  const ws = useRef<WebSocket | null>(null);
  const creds = useRef<{ url: string; token: string } | null>(null);
  const everConnected = useRef(false);
  const subs = useRef(new Set<(m: Msg) => void>());
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantOpen = useRef(false); // only stay connected while app is foreground
  const keepAlive = useRef(false); // …unless casting: keep the socket open in the background
  const latestFrame = useRef<ArrayBuffer | null>(null);
  const frameRaf = useRef<number | null>(null);
  const lastRx = useRef(Date.now()); // last time ANY message arrived — for the dead-link watchdog

  // Deliver only the newest live frame, at most once per animation frame. Dropping stale frames
  // keeps a slow JS thread from building a backlog — no growing lag, no out-of-order "old frame"
  // flashes. Converting only the frame we actually render also avoids base64-ing dropped ones.
  const pumpFrame = useCallback(() => {
    frameRaf.current = null;
    const buf = latestFrame.current;
    if (!buf) return;
    latestFrame.current = null;
    const data = abToBase64(buf);
    subs.current.forEach((fn) => fn({ Kind: 'frame', Data: data }));
  }, []);

  // --- same-network direct path -------------------------------------------------
  // When the agent and phone are on the same LAN, connect straight to the laptop for ~2ms
  // latency instead of round-tripping the VPS. The relay stays connected for discovery,
  // async events, and fallback; if the direct link drops we transparently use the relay.
  const lanWs = useRef<WebSocket | null>(null);
  const [onLan, setOnLan] = useState(false);
  const msgRef = useRef<(ev: any) => void>(() => {});

  // race-connect to the agent's advertised LAN IPs; first to open wins, others close
  const tryLan = useCallback((ips: string[], port: number) => {
    if (lanWs.current || !creds.current) return;
    const token = creds.current.token;
    ips.forEach((ip) => {
      let s: WebSocket;
      try {
        // token in the header AND the query — RN can drop custom WS headers on some devices, and on
        // the local cleartext LAN the query is no more exposed than the header. Agent accepts either.
        s = new (WebSocket as any)(`ws://${ip}:${port}/direct?token=${encodeURIComponent(token)}`, undefined, { headers: { Authorization: 'Bearer ' + token } });
      } catch {
        return;
      }
      s.binaryType = 'arraybuffer';
      const to = setTimeout(() => { try { s.close(); } catch {} }, 1500); // give up fast if unreachable
      s.onopen = () => {
        clearTimeout(to);
        if (lanWs.current) { try { s.close(); } catch {} return; } // another IP already won
        lanWs.current = s;
        setOnLan(true);
      };
      s.onmessage = (ev) => msgRef.current(ev);
      s.onclose = () => { clearTimeout(to); if (lanWs.current === s) { lanWs.current = null; setOnLan(false); } };
      s.onerror = () => { try { s.close(); } catch {} };
    });
  }, []);

  // single message handler for BOTH sockets (relay + LAN)
  const handleData = useCallback((ev: any) => {
    lastRx.current = Date.now(); // any traffic (frame, event, hb echo) proves the link is alive
    if (typeof ev.data !== 'string') {
      latestFrame.current = ev.data as ArrayBuffer; // newest frame; pump renders it
      if (frameRaf.current == null) frameRaf.current = requestAnimationFrame(pumpFrame);
      return;
    }
    let p: any;
    try { p = JSON.parse(ev.data as string); } catch { return; }
    const m: Msg = { Kind: p.Kind ?? p.kind, Action: p.Action ?? p.action, Text: p.Text ?? p.text, Data: p.Data ?? p.data, Input: p.Input ?? p.input };
    if (m.Action === 'hb') return; // heartbeat echo — already refreshed lastRx above
    recordEvent(m); // capture into the global Activity log regardless of which screen is mounted
    if (m.Action === 'presence') setPresence(m.Text === 'online' ? 'online' : 'offline');
    if (m.Action === 'lanaddr' && m.Text) {
      try { const la = JSON.parse(m.Text); if (Array.isArray(la.ips) && la.port) tryLan(la.ips, la.port); } catch {}
      return;
    }
    subs.current.forEach((fn) => fn(m));
  }, [pumpFrame, tryLan]);
  msgRef.current = handleData;

  // the active socket for outbound: prefer the direct LAN link, fall back to the relay
  const active = () => {
    const l = lanWs.current;
    return l && l.readyState === 1 ? l : ws.current;
  };

  const open = useCallback(() => {
    const c = creds.current;
    if (!c || !wantOpen.current) return;
    if (ws.current && ws.current.readyState <= 1) return; // already connecting/open
    setStatus('connecting');
    const url = c.url.replace(/\/+$/, '') + '/app?token=' + encodeURIComponent(c.token);
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      setStatus('error');
      return;
    }
    ws.current = sock;
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      lastRx.current = Date.now(); // fresh link — reset the watchdog clock
      everConnected.current = true;
      setStatus('connected');
      setPaired(true);
      const cc = creds.current;
      if (cc) {
        storeSet('relayUrl', cc.url);
        storeSet('token', cc.token);
      }
    };
    sock.onmessage = (ev) => msgRef.current(ev);
    sock.onerror = () => setStatus((s) => (s === 'connected' ? s : 'error'));
    sock.onclose = () => {
      ws.current = null;
      setPresence('unknown');
      // if we never actually connected (bad token / unreachable) while trying, surface 'error' so
      // pairing shows "Couldn't connect" instead of silently flashing back to the login screen.
      // If we closed on purpose (forget/close → wantOpen false), just go idle.
      setStatus((s) => (!wantOpen.current ? 'idle' : s === 'error' || !everConnected.current ? 'error' : 'idle'));
      // reconnect only if we're meant to be open and previously succeeded (avoid hammering a bad token)
      if (wantOpen.current && creds.current && everConnected.current) {
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(open, 3000);
      }
    };
  }, []);

  const close = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    ws.current?.close();
    ws.current = null;
    lanWs.current?.close();
    lanWs.current = null;
    setOnLan(false);
  }, []);

  const connect = useCallback(
    (url: string, token: string) => {
      creds.current = { url: url.trim(), token: token.trim() };
      setRelayUrl(creds.current.url);
      wantOpen.current = true;
      open();
    },
    [open]
  );

  const forget = useCallback(async () => {
    wantOpen.current = false;
    creds.current = null;
    everConnected.current = false;
    close();
    setPaired(false);
    setRelayUrl('');
    setStatus('idle');
    await storeDel('relayUrl');
    await storeDel('token');
  }, [close]);

  // these are handled by the RELAY, not the agent — must go on the relay socket even when the
  // fast LAN socket is active (the agent silently drops them otherwise → e.g. push never registers)
  const relayOnly = new Set(['pushtoken', 'cast-start']);
  const send = useCallback((action: string, text?: string) => {
    const s = relayOnly.has(action) ? ws.current : active();
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify({ Kind: 'cmd', Action: action, Text: text ?? '' }));
  }, []);

  // remote-control input: {t:move|down|up|scroll|key, x,y (0..1), b, k, d, dy} — LAN-direct when possible
  const sendInput = useCallback((input: object) => {
    const s = active();
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify({ kind: 'input', input }));
  }, []);

  // upload a file to the laptop (base64 payload, agent saves it)
  const sendFile = useCallback((name: string, dataB64: string) => {
    const s = active();
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify({ Kind: 'cmd', Action: 'put', Text: name, Data: dataB64 }));
  }, []);

  // stream a phone-screen frame to the laptop cast viewer — relay only (browser viewer lives there)
  const sendCast = useCallback((dataB64: string) => {
    const s = ws.current;
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify({ Kind: 'cmd', Action: 'castframe', Data: dataB64 }));
  }, []);

  // while casting, keep the socket open even when the app is backgrounded (a foreground
  // service keeps the process alive) so frames keep flowing to the laptop.
  const setKeepAlive = useCallback((v: boolean) => { keepAlive.current = v; }, []);

  const subscribe = useCallback((fn: (m: Msg) => void) => {
    subs.current.add(fn);
    return () => {
      subs.current.delete(fn);
    };
  }, []);

  // dead-link watchdog: heartbeat the relay every 12s; if nothing comes back for 30s the socket is a
  // zombie (network dropped with no close event → app wrongly shows "connected"). Force it closed so
  // it reconnects and the status flips honestly.
  useEffect(() => {
    const id = setInterval(() => {
      const s = ws.current;
      if (!s || s.readyState !== 1) return;
      if (Date.now() - lastRx.current > 30000) {
        try { s.close(); } catch {}
        return;
      }
      try { s.send(JSON.stringify({ Kind: 'cmd', Action: 'hb' })); } catch {}
    }, 12000);
    return () => clearInterval(id);
  }, []);

  // load stored creds once; trust them (they were saved only after a successful connect)
  useEffect(() => {
    (async () => {
      const url = await storeGet('relayUrl');
      const token = await storeGet('token');
      if (url && token) {
        creds.current = { url, token };
        everConnected.current = true;
        setRelayUrl(url);
        setPaired(true);
        wantOpen.current = AppState.currentState === 'active';
        if (wantOpen.current) open();
      }
      setBooting(false);
    })();
  }, [open]);

  // resource discipline: hold the socket open only while the app is foreground.
  // When closed/backgrounded, alerts still arrive via push (the relay POSTs to FCM) — no
  // socket, no background service, no battery cost.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && creds.current) {
        wantOpen.current = true;
        open();
      } else if (!keepAlive.current) {
        wantOpen.current = false;
        close();
      }
    });
    return () => sub.remove();
  }, [open, close]);

  return (
    <ConnCtx.Provider value={{ status, presence, onLan, paired, booting, relayUrl, connect, forget, send, sendInput, sendFile, sendCast, setKeepAlive, subscribe }}>
      {children}
    </ConnCtx.Provider>
  );
}
