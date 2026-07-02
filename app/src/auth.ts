import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

// Biometric confirmation for sensitive actions — fingerprint / face, no typed codes.
// Authenticates once, then holds a session window so you're not prompted every time.

let sessionUntil = 0; // ms epoch; within this, actions skip the prompt
let graceMs = 5 * 60 * 1000; // default 5-minute window
let enabled = true; // user can turn the biometric gate off in Settings

export function setBiometricEnabled(on: boolean) {
  enabled = on;
}
export function setBiometricGraceMinutes(min: number) {
  graceMs = Math.max(0, min) * 60 * 1000;
}

export async function biometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

// ensureAuth returns true if the user is authenticated for a sensitive action.
// It prompts biometrics only when the session window has lapsed.
export async function ensureAuth(reason = 'Confirm it’s you'): Promise<boolean> {
  if (!enabled) return true;
  if (Platform.OS === 'web') return true; // preview: no biometric hardware
  if (Date.now() < sessionUntil) return true; // still inside the window — no prompt
  if (!(await biometricAvailable())) return true; // no enrolled biometrics -> don't lock the user out
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use device PIN',
      cancelLabel: 'Cancel',
    });
    if (res.success) {
      sessionUntil = Date.now() + graceMs;
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

// clearSession forces the next sensitive action to re-authenticate (e.g. on app background).
export function clearAuthSession() {
  sessionUntil = 0;
}
