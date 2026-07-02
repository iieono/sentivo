import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PlugsConnected, QrCode, X } from 'phosphor-react-native';
import { C } from '../theme';
import { useConn } from '../conn';

// parse sentivo://pair?url=<relay>&token=<token>
function parsePairing(data: string): { url: string; token: string } | null {
  const q = data.split('?')[1];
  if (!q) return null;
  const p: Record<string, string> = {};
  q.split('&').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  return p.url && p.token ? { url: p.url, token: p.token } : null;
}

export default function Connect() {
  const { connect, status } = useConn();
  const [url, setUrl] = useState('wss://sentivo.relayt.uz');
  const [token, setToken] = useState('');
  const [manual, setManual] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const connecting = status === 'connecting';
  const disabled = connecting || !token.trim();

  const openScan = async () => {
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r?.granted) return;
    }
    setScanning(true);
  };
  const onScan = ({ data }: { data: string }) => {
    const p = parsePairing(data);
    if (p) {
      setScanning(false);
      connect(p.url, p.token);
    }
  };

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <SafeAreaView style={styles.scanOverlay}>
          <View style={styles.reticle} />
          <Text style={styles.scanHint}>Point at the QR on your laptop</Text>
          <Pressable onPress={() => setScanning(false)} style={styles.scanCancel}>
            <X size={18} color="#fff" weight="bold" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, padding: 22, justifyContent: 'center' }}
      >
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.h1}>Connect to your laptop</Text>
          <Text style={styles.sub}>
            Pair this phone with your Windows agent through your self-hosted relay. No account, no cloud.
          </Text>
        </View>

        {Platform.OS !== 'web' ? (
          <Pressable
            onPress={openScan}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          >
            <QrCode size={21} color="#fff" weight="bold" />
            <Text style={styles.btnText}>Scan QR from laptop</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => setManual((m) => !m)} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={styles.link}>{manual ? 'Hide manual entry' : 'or enter details manually'}</Text>
        </Pressable>

        {manual || Platform.OS === 'web' ? (
          <>
            <Field label="Relay URL" value={url} onChangeText={setUrl} placeholder="wss://host:port" />
            <Field label="Device token" value={token} onChangeText={setToken} placeholder="paste token" secureTextEntry />
            <Pressable
              onPress={() => !disabled && connect(url, token)}
              disabled={disabled}
              style={({ pressed }) => [styles.btn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
            >
              <PlugsConnected size={20} color="#fff" weight="bold" />
              <Text style={styles.btnText}>{connecting ? 'Connecting…' : 'Connect'}</Text>
            </Pressable>
          </>
        ) : null}

        {status === 'error' ? <Text style={styles.err}>Couldn't connect — check the URL and token.</Text> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, ...p }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...p} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#AEB8C4" style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { width: 104, height: 104 },
  h1: { fontSize: 27, fontWeight: '800', color: C.ink, marginTop: 18, letterSpacing: -0.6 },
  sub: { fontSize: 14, color: C.muted, fontWeight: '500', marginTop: 8, textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginBottom: 6, marginLeft: 4 },
  input: { height: 52, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 16, fontSize: 15, color: C.ink, borderWidth: 1, borderColor: C.line },
  btn: { height: 56, backgroundColor: C.dark, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: C.muted, fontSize: 14, fontWeight: '600' },
  err: { color: C.red, textAlign: 'center', marginTop: 14, fontWeight: '600' },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 230, height: 230, borderRadius: 28, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  scanHint: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 22 },
  scanCancel: { position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
});
