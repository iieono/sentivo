import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore on device (hardware-backed); localStorage on web (dev/preview only).
export async function storeGet(k: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
  }
  return SecureStore.getItemAsync(k);
}

export async function storeSet(k: string, v: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    return;
  }
  await SecureStore.setItemAsync(k, v);
}

export async function storeDel(k: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    return;
  }
  await SecureStore.deleteItemAsync(k);
}
