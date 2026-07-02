import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, { Polyline } from 'react-native-svg';
import { ArrowDown, ArrowLeft, ArrowUp, Globe, PlugsConnected } from 'phosphor-react-native';
import { Bounce } from '../anim';
import { Card, Row } from '../ui';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type Net = { down: number; up: number; conns: number; top: { addr: string; n: number }[] };

const fmtSpeed = (b: number) => {
  if (!b || b < 0) return '0 B/s';
  if (b < 1024) return `${b} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1048576).toFixed(2)} MB/s`;
};

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 150, h = 40;
  if (data.length < 2) return <View style={{ height: h }} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export default function Network() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [net, setNet] = useState<Net | null>(null);
  const [downH, setDownH] = useState<number[]>([]);
  const [upH, setUpH] = useState<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useFocusEffect(
    useCallback(() => {
      const unsub = subscribe((m: Msg) => {
        if (m.Action === 'net' && m.Text) {
          try {
            const n: Net = JSON.parse(m.Text);
            setNet(n);
            setDownH((h) => [...h, n.down].slice(-40));
            setUpH((h) => [...h, n.up].slice(-40));
          } catch {}
        }
      });
      const poll = () => status === 'connected' && send('net');
      poll();
      timer.current = setInterval(poll, 2500);
      return () => {
        unsub();
        if (timer.current) clearInterval(timer.current);
      };
    }, [subscribe, send, status])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ gap: 12 }}>
          <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Bounce>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Network</Text>
            <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500' }}>Live throughput & connections</Text>
          </View>
        </Row>
      </View>

      <View style={{ paddingHorizontal: 18 }}>
        <Row style={{ gap: 12, marginBottom: 12 }}>
          <Card style={{ flex: 1 }}>
            <Row style={{ gap: 7, marginBottom: 2 }}>
              <ArrowDown size={16} color={C.blue} weight="bold" />
              <Text style={styles.lbl}>Download</Text>
            </Row>
            <Text style={[styles.val, { color: C.blue }]}>{net ? fmtSpeed(net.down) : 'measuring…'}</Text>
            <Spark data={downH} color={C.blue} />
          </Card>
          <Card style={{ flex: 1 }}>
            <Row style={{ gap: 7, marginBottom: 2 }}>
              <ArrowUp size={16} color={C.violet} weight="bold" />
              <Text style={styles.lbl}>Upload</Text>
            </Row>
            <Text style={[styles.val, { color: C.violet }]}>{net ? fmtSpeed(net.up) : 'measuring…'}</Text>
            <Spark data={upH} color={C.violet} />
          </Card>
        </Row>

        <Card style={{ marginBottom: 14 }}>
          <Row style={{ gap: 10 }}>
            <View style={[styles.ic, { backgroundColor: tint(C.emerald, 0.13) }]}>
              <PlugsConnected size={19} color={C.emerald} weight="bold" />
            </View>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: C.ink }}>Active connections</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>{net?.conns ?? '—'}</Text>
          </Row>
        </Card>

        <Text style={styles.section}>TOP REMOTES</Text>
        <Card>
          {net?.top?.length ? (
            net.top.map((t, i) => (
              <Row key={t.addr + i} style={{ paddingVertical: 7, gap: 10 }}>
                <Globe size={16} color={C.slate} weight="duotone" />
                <Text style={{ flex: 1, fontSize: 13.5, color: C.ink, fontFamily: 'monospace' }} numberOfLines={1}>{t.addr}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.muted }}>×{t.n}</Text>
              </Row>
            ))
          ) : (
            <Text style={{ color: C.muted, textAlign: 'center', paddingVertical: 8 }}>—</Text>
          )}
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  lbl: { fontSize: 12, fontWeight: '700', color: C.muted },
  val: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 0.4, marginBottom: 10, marginLeft: 2 },
});
