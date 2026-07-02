import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowClockwise, ArrowLeft, Cpu, X } from 'phosphor-react-native';
import { RefreshBtn } from '../anim';
import { Card, Row, T } from '../ui';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';
import { ensureAuth } from '../auth';

type Proc = { name: string; pid: number; mem: number };

export default function Processes() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [procs, setProcs] = useState<Proc[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'pslist' && m.Text) {
          try {
            setProcs(JSON.parse(m.Text));
          } catch {}
          setBusy(false);
        }
      }),
    [subscribe]
  );

  const refresh = useCallback(() => {
    if (status === 'connected') { setBusy(true); send('pslist'); }
  }, [status, send]);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const kill = async (p: Proc) => {
    if (await ensureAuth(`End “${p.name}”?`)) {
      send('kill', String(p.pid));
      setProcs((prev) => prev.filter((x) => x.pid !== p.pid));
    }
  };

  const max = Math.max(1, ...procs.map((p) => p.mem));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <Pressable onPress={() => nav.goBack()} hitSlop={12}>
              <ArrowLeft size={22} color={C.ink} weight="bold" />
            </Pressable>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Processes</Text>
              <Text style={T.muted}>What’s running, by memory</Text>
            </View>
          </Row>
          <RefreshBtn busy={busy} onPress={refresh} style={styles.refresh} />
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        {procs.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 44 }}>
            <Cpu size={36} color={C.slate} weight="duotone" />
            <Text style={{ color: C.muted, marginTop: 10, fontWeight: '600' }}>Loading…</Text>
          </Card>
        ) : (
          procs.map((p) => {
            const frac = p.mem / max;
            const col = frac > 0.66 ? C.red : frac > 0.4 ? C.amber : C.blue;
            return (
              <View key={p.pid} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, flex: 1, paddingRight: 8 }} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.muted }}>{p.mem} MB</Text>
                  </Row>
                  <View style={styles.track}>
                    <View style={[styles.bar, { width: `${Math.max(4, frac * 100)}%`, backgroundColor: col }]} />
                  </View>
                </View>
                <Pressable onPress={() => kill(p)} hitSlop={8} style={styles.kill}>
                  <X size={16} color={C.red} weight="bold" />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 12,
    marginBottom: 8,
  },
  refresh: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  track: { height: 7, backgroundColor: C.card2, borderRadius: 999, overflow: 'hidden' },
  bar: { height: 7, borderRadius: 999 },
  kill: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.red, 0.1) },
});
