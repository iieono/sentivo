import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle, WarningCircle } from 'phosphor-react-native';
import { C, tint } from './theme';
import { useConn } from './conn';

// Data-bearing replies are rendered by their own screens; the toast is only for short
// action feedback ("power mode: high", "focused Chrome", "couldn't switch…").
const DATA_ACTIONS = new Set(['ls', 'applist', 'net', 'statjson', 'getrules', 'gettune', 'exec', 'clip', 'sentivo', 'media', 'get', 'put']);
const isErr = (s: string) => /fail|can'?t|cannot|error|not (found|running|granted|saved|open)|unknown|denied|no /i.test(s);

// Global feedback toast: slides down from the top with the agent's reply for any action,
// so every command shows a clear success/error. Auto-dismisses.
export default function Toast() {
  const { subscribe } = useConn();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const y = useRef(new Animated.Value(-140)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dismiss = () => {
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(y, { toValue: -140, duration: 220, useNativeDriver: true }).start(() => setMsg(null));
    };
    return subscribe((m) => {
      if (m.Kind !== 'reply' || !m.Text || m.Data) return;
      if (DATA_ACTIONS.has(m.Action || '')) return;
      const t = m.Text.trim();
      if (!t || t.startsWith('{') || t.startsWith('[') || t.length > 160) return;
      setMsg(t);
      setErr(isErr(t));
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(dismiss, 2800);
    });
  }, [subscribe, y]);

  if (!msg) return null;
  const col = err ? C.red : C.emerald;
  const Icon = err ? WarningCircle : CheckCircle;
  return (
    <SafeAreaView edges={['top']} style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.toast, { transform: [{ translateY: y }] }]}>
        <View style={[styles.ic, { backgroundColor: tint(col, 0.14) }]}>
          <Icon size={18} color={col} weight="fill" />
        </View>
        <Text style={styles.text} numberOfLines={2}>{msg}</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  toast: {
    marginTop: 6,
    maxWidth: '92%',
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: '#0F1720',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  ic: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: C.ink },
});
