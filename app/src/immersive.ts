import { useSyncExternalStore } from 'react';

// Tiny global flag: when true, the app is in immersive mode (hide the tab bar).
let value = false;
const listeners = new Set<() => void>();

export function setImmersive(v: boolean) {
  if (value === v) return;
  value = v;
  listeners.forEach((l) => l());
}

export function useImmersive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
    () => value
  );
}
