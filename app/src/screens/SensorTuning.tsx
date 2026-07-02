import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, Camera, Clock, Microphone } from 'phosphor-react-native';
import { Bounce } from '../anim';
import { Card, Row, T } from '../ui';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type Tune = { motion: number; idle: number; mic: number };

const MOTION = [
  { v: 0.03, l: 'High' },
  { v: 0.06, l: 'Medium' },
  { v: 0.1, l: 'Low' },
];
const IDLE = [
  { v: 60, l: '1 min' },
  { v: 120, l: '2 min' },
  { v: 300, l: '5 min' },
  { v: 600, l: '10 min' },
];
const MIC = [
  { v: 0.04, l: 'High' },
  { v: 0.08, l: 'Medium' },
  { v: 0.15, l: 'Low' },
];

export default function SensorTuning() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [tune, setTune] = useState<Tune>({ motion: 0.06, idle: 300, mic: 0.08 });

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'tune' && m.Text) {
          try {
            setTune(JSON.parse(m.Text));
          } catch {}
        }
      }),
    [subscribe]
  );
  useFocusEffect(useCallback(() => { if (status === 'connected') send('gettune'); }, [status, send]));

  const apply = (next: Tune) => {
    setTune(next);
    send('settune', JSON.stringify(next));
  };

  const Section = ({ icon: Icon, color, title, hint, opts, sel, onPick }: any) => (
    <Card style={{ marginBottom: 14 }}>
      <Row style={{ gap: 12, marginBottom: 12 }}>
        <View style={[styles.ic, { backgroundColor: tint(color, 0.13) }]}>
          <Icon size={19} color={color} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={T.muted}>{hint}</Text>
        </View>
      </Row>
      <Row style={{ gap: 7, flexWrap: 'wrap' }}>
        {opts.map((o: any) => {
          const on = Math.abs(o.v - sel) < 1e-6;
          return (
            <Bounce key={o.v} onPress={() => onPick(o.v)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipT, on && { color: '#fff' }]}>{o.l}</Text>
            </Bounce>
          );
        })}
      </Row>
    </Card>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ gap: 12 }}>
          <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Bounce>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Sensor tuning</Text>
            <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500' }}>Dial in how sensitive alerts are</Text>
          </View>
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Section icon={Camera} color={C.violet} title="Motion sensitivity" hint="How much the camera must change to trip" opts={MOTION} sel={tune.motion} onPick={(v: number) => apply({ ...tune, motion: v })} />
        <Section icon={Microphone} color={C.blue} title="Mic sensitivity" hint="How loud a sound must be to trip" opts={MIC} sel={tune.mic} onPick={(v: number) => apply({ ...tune, mic: v })} />
        <Section icon={Clock} color={C.amber} title="Away timeout" hint="After this long untouched while armed, keyboard/mouse use raises a tamper alert" opts={IDLE} sel={tune.idle} onPick={(v: number) => apply({ ...tune, idle: v })} />
        <Text style={[T.muted, { textAlign: 'center', marginTop: 4 }]}>Applied on the laptop instantly · saved across restarts.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.dark, borderColor: C.dark },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.ink },
});
