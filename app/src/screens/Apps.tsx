import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppWindow, ArrowClockwise, ArrowLeft, Rocket, X } from 'phosphor-react-native';
import { Bounce, Pop, RefreshBtn, springLayout } from '../anim';
import { Row } from '../ui';
import { ensureAuth } from '../auth';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type App = { name: string; pid: number; title: string };
const QUICK = ['notepad', 'chrome', 'explorer', 'calc', 'spotify', 'cmd'];

export default function Apps() {
  const { send, subscribe, status, presence } = useConn();
  const nav = useNavigation<any>();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [flash, setFlash] = useState('');
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => send('applist'), [send]);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'applist' && m.Text) {
          try {
            springLayout();
            setApps(JSON.parse(m.Text));
          } catch {}
          setLoading(false);
        } else if (m.Action === 'launch' && m.Text) {
          setFlash(m.Text);
          if (flashT.current) clearTimeout(flashT.current);
          flashT.current = setTimeout(() => setFlash(''), 2600);
          setTimeout(refresh, 900);
        }
      }),
    [subscribe, refresh]
  );

  useFocusEffect(
    useCallback(() => {
      if (status === 'connected') {
        setLoading(true);
        refresh();
      }
    }, [status, refresh])
  );

  const canAct = status === 'connected' && presence === 'online';
  const launch = async (n?: string) => {
    const app = (n || name).trim();
    if (!app || !canAct) return;
    if (!(await ensureAuth('Launch ' + app))) return;
    send('launch', app);
    setName('');
  };
  const kill = async (a: App) => {
    if (!(await ensureAuth('Close ' + a.name))) return;
    send('kill', String(a.pid));
    springLayout();
    setApps((xs) => xs.filter((x) => x.pid !== a.pid));
    setTimeout(refresh, 800);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Bounce>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Apps</Text>
              <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500' }}>Launch & switch</Text>
            </View>
          </Row>
          <RefreshBtn busy={loading} onPress={() => { setLoading(true); refresh(); }} style={styles.iconBtn} />
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* launch bar */}
        <Row style={{ gap: 10, marginBottom: 12 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => launch()}
            placeholder={canAct ? 'App name…' : 'Device offline'}
            placeholderTextColor={C.muted}
            editable={canAct}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Bounce onPress={() => launch()} style={[styles.launch, (!canAct || !name.trim()) && { opacity: 0.4 }]}>
            <Rocket size={19} color="#fff" weight="fill" />
          </Bounce>
        </Row>
        {flash ? <Text style={{ color: C.muted, fontSize: 13, marginBottom: 10, marginLeft: 2 }}>{flash}</Text> : null}

        <Row style={{ flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {QUICK.map((q) => (
            <Bounce key={q} onPress={() => launch(q)} style={styles.chip}>
              <Text style={styles.chipT}>{q}</Text>
            </Bounce>
          ))}
        </Row>

        <Text style={styles.section}>RUNNING</Text>
        {loading ? (
          <ActivityIndicator color={C.slate} style={{ marginTop: 24 }} />
        ) : apps.length === 0 ? (
          <Text style={{ color: C.muted, textAlign: 'center', marginTop: 24 }}>No windowed apps</Text>
        ) : (
          apps.map((a) => (
            <Pop key={a.pid} style={{ marginBottom: 9 }}>
              <Row style={styles.row}>
                <Bounce onPress={() => send('focus', String(a.pid))} style={styles.focusRow}>
                  <View style={styles.ic}><AppWindow size={19} color={C.blue} weight="duotone" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ fontSize: 12, color: C.muted }} numberOfLines={1}>{a.title}</Text>
                  </View>
                </Bounce>
                <Bounce onPress={() => kill(a)} style={styles.kill}><X size={16} color={C.red} weight="bold" /></Bounce>
              </Row>
            </Pop>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: 48, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, paddingHorizontal: 15, fontSize: 15, color: C.ink },
  launch: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  chipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  section: { fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 0.4, marginBottom: 10, marginLeft: 2 },
  row: { gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 12 },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  ic: { width: 40, height: 40, borderRadius: 12, backgroundColor: tint(C.blue, 0.13), alignItems: 'center', justifyContent: 'center' },
  kill: { width: 34, height: 34, borderRadius: 11, backgroundColor: tint(C.red, 0.1), alignItems: 'center', justifyContent: 'center' },
});
