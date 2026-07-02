import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ArrowLeft, ArrowRight, Lightning, Plus, TrashSimple } from 'phosphor-react-native';
import { Bounce, Pop, Toggle, springLayout } from '../anim';
import { Card, Row } from '../ui';
import { ensureAuth } from '../auth';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type Rule = { on: string; do: string; enabled: boolean };

const TRIGGERS = [
  { v: 'unplugged', l: 'Power unplugged' },
  { v: 'plugged', l: 'Power connected' },
  { v: 'usb', l: 'USB inserted' },
  { v: 'activity', l: 'Activity after idle' },
  { v: 'lock', l: 'Screen locked' },
  { v: 'unlock', l: 'Screen unlocked' },
  { v: 'lowbat', l: 'Battery low' },
];
const ACTIONS = [
  { v: 'alarm', l: 'Sound alarm' },
  { v: 'photo', l: 'Webcam photo' },
  { v: 'screenshot', l: 'Screenshot' },
  { v: 'lock', l: 'Lock screen' },
];
const lbl = (arr: { v: string; l: string }[], v: string) => arr.find((x) => x.v === v)?.l || v;

export default function Rules() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [rules, setRules] = useState<Rule[]>([]);
  const [on, setOn] = useState('unplugged');
  const [act, setAct] = useState('alarm');

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'rules' && m.Text) {
          try {
            springLayout();
            setRules(JSON.parse(m.Text) || []);
          } catch {}
        }
      }),
    [subscribe]
  );
  useFocusEffect(useCallback(() => { if (status === 'connected') send('getrules'); }, [status, send]));

  const save = (next: Rule[]) => {
    setRules(next);
    send('setrules', JSON.stringify(next));
  };
  const add = async () => {
    if (!(await ensureAuth('Create an automation'))) return;
    if (rules.some((r) => r.on === on && r.do === act)) return;
    springLayout();
    save([...rules, { on, do: act, enabled: true }]);
  };
  const toggle = (i: number) => save(rules.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)));
  const remove = (i: number) => { springLayout(); save(rules.filter((_, j) => j !== i)); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ gap: 12 }}>
          <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Bounce>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Automations</Text>
            <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500' }}>When this happens, do that</Text>
          </View>
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Card style={{ marginBottom: 18 }}>
          <Text style={styles.mini}>WHEN</Text>
          <Row style={{ flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            {TRIGGERS.map((t) => (
              <Bounce key={t.v} onPress={() => setOn(t.v)} style={[styles.chip, on === t.v && styles.chipOn]}>
                <Text style={[styles.chipT, on === t.v && { color: '#fff' }]}>{t.l}</Text>
              </Bounce>
            ))}
          </Row>
          <Text style={styles.mini}>DO</Text>
          <Row style={{ flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
            {ACTIONS.map((a) => (
              <Bounce key={a.v} onPress={() => setAct(a.v)} style={[styles.chip, act === a.v && styles.chipOn]}>
                <Text style={[styles.chipT, act === a.v && { color: '#fff' }]}>{a.l}</Text>
              </Bounce>
            ))}
          </Row>
          <Bounce onPress={add} style={styles.add}>
            <Plus size={18} color="#fff" weight="bold" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14.5 }}>Add automation</Text>
          </Bounce>
        </Card>

        {rules.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 34 }}>
            <Lightning size={34} color={C.slate} weight="duotone" />
            <Text style={{ color: C.muted, marginTop: 10, fontWeight: '600' }}>No automations yet</Text>
          </Card>
        ) : (
          rules.map((r, i) => (
            <Pop key={r.on + r.do} style={{ marginBottom: 10 }}>
              <Card>
                <Row style={{ gap: 10 }}>
                  <View style={[styles.ic, { backgroundColor: tint(C.amber, 0.13) }]}>
                    <Lightning size={18} color={C.amber} weight="fill" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.rt}>{lbl(TRIGGERS, r.on)}</Text>
                      <ArrowRight size={14} color={C.muted} weight="bold" />
                      <Text style={[styles.rt, { color: C.blue }]}>{lbl(ACTIONS, r.do)}</Text>
                    </Row>
                  </View>
                  <Toggle value={r.enabled} onValueChange={() => toggle(i)} color={C.emerald} />
                  <Bounce onPress={() => remove(i)} style={styles.del}><TrashSimple size={15} color={C.red} weight="bold" /></Bounce>
                </Row>
              </Card>
            </Pop>
          ))
        )}
        <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 18 }}>
          Automations run on the laptop itself — even when the app is closed.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mini: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 0.5, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.dark, borderColor: C.dark },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.ink },
  add: { height: 48, borderRadius: 14, backgroundColor: C.dark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rt: { fontSize: 14, fontWeight: '700', color: C.ink },
  del: { width: 32, height: 32, borderRadius: 10, backgroundColor: tint(C.red, 0.1), alignItems: 'center', justifyContent: 'center' },
});
