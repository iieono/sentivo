// A process-wide event log, populated from the connection layer so events are captured even when
// the Activity tab isn't mounted yet (React Navigation lazy-mounts tabs). Activity reads from here.
export type Ev = { id: number; text: string; t: number };

let seq = 0;
let log: Ev[] = [];
const listeners = new Set<() => void>();
const HIDE = new Set(['statjson', 'pslist', 'clip', 'presence', 'hb', 'lanaddr']);

export function recordEvent(m: { Kind?: string; Action?: string; Text?: string }) {
  if (m.Kind !== 'event' || !m.Text) return;
  if (m.Action && HIDE.has(m.Action)) return;
  log = [{ id: ++seq, text: m.Text, t: Date.now() }, ...log].slice(0, 200);
  listeners.forEach((fn) => fn());
}

export function getEvents(): Ev[] { return log; }
export function clearEvents() { log = []; listeners.forEach((fn) => fn()); }
export function subscribeEvents(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
