import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useConn } from './conn';
import { storeGet, storeSet } from './storage';

// client-side alert mute (Settings ▸ Alerts). Loaded once, toggled from Settings.
let alertsMuted = false;
(async () => {
  alertsMuted = (await storeGet('alertsMuted')) === '1';
})();
export function setAlertsMuted(v: boolean) {
  alertsMuted = v;
  storeSet('alertsMuted', v ? '1' : '');
}
export async function alertsAreMuted() {
  return (await storeGet('alertsMuted')) === '1';
}

// Local notifications need no push token / FCM — they display instantly from the app.
// The same display path shows a real FCM push once the app is built with EAS.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const HIDE = new Set(['statjson', 'pslist', 'clip', 'presence']);

// registerForPush gets the Expo push token (backed by FCM) and hands it to the relay,
// which sends pushes to it. No-ops on web or before an EAS build (no projectId yet).
async function registerForPush(sendToken: (t: string) => void) {
  try {
    if (Platform.OS === 'web') return;
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return; // populated by `eas init`
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (token) sendToken(token);
  } catch {}
}

// Notifier raises a system notification for real events while Sentivo isn't in focus,
// and registers this device for push once connected.
export default function Notifier() {
  const { subscribe, send, status } = useConn();
  const asked = useRef(false);
  const registered = useRef(false);
  const fgAt = useRef(Date.now()); // last time the app was foregrounded (open)

  useEffect(() => {
    if (!asked.current) {
      asked.current = true;
      Notifications.requestPermissionsAsync().catch(() => {});
    }
    return subscribe((m) => {
      if (alertsMuted) return; // Settings ▸ Alerts turned off
      if (m.Kind !== 'event' || !m.Text) return;
      if (m.Action && HIDE.has(m.Action)) return;
      // just opened / returned to the app: skip the burst of rehydration events so we don't
      // notify on every open. Real alerts that fire while you're using the app still show.
      if (Date.now() - fgAt.current < 3500) return;
      // full text in the body (not a truncated title) so Android shows it expandable, not cut off.
      // single-line events use a fixed title so title≠body (which looked duplicated before).
      const lines = m.Text.split('\n');
      const multi = lines.length > 1;
      const title = multi ? lines[0].slice(0, 100) : 'Sentivo';
      const body = (multi ? lines.slice(1).join('\n') : m.Text).slice(0, 600);
      Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {});
    });
  }, [subscribe]);

  // track when the app last came to the foreground, to suppress the on-open notification burst
  useEffect(() => {
    fgAt.current = Date.now();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') fgAt.current = Date.now(); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (status === 'connected' && !registered.current) {
      registered.current = true;
      registerForPush((t) => send('pushtoken', t));
    }
  }, [status, send]);

  return null;
}
