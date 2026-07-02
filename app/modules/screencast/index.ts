import { requireNativeModule, EventSubscription } from 'expo-modules-core';

// Native screen-capture module (Android MediaProjection). Emits JPEG frames as base64.
const Native = requireNativeModule('Screencast');

// start() shows the system "start capturing?" dialog; resolves true if the user allowed it.
export function startCast(fps: number, quality: number): Promise<boolean> {
  return Native.start(fps, quality);
}

export function stopCast(): void {
  Native.stop();
}

// onFrame fires for every captured JPEG frame (base64, no data-URI prefix).
export function onFrame(cb: (b64: string) => void): EventSubscription {
  return Native.addListener('frame', (e: { data: string }) => cb(e.data));
}
