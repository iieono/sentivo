import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Toggle } from '../anim';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BellSlash, CaretRight, Camera, Lightning, MapPin, Megaphone, Microphone, PaperPlaneRight, ShieldCheck, Siren } from 'phosphor-react-native';
import { Card, Row, Screen as Wrap, T } from '../ui';
import { Sheet, SheetHeader } from '../Sheet';
import { Bounce } from '../anim';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';
import { ensureAuth } from '../auth';

export default function Guard() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [armed, setArmed] = useState(false);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [msgSheet, setMsgSheet] = useState(false);
  const [alarmSheet, setAlarmSheet] = useState(false);
  const [msg, setMsg] = useState('');
  const touched = useRef(false); // after you flip a switch, don't let the focus status flip it back

  useEffect(
    () =>
      subscribe((m: Msg) => {
        const t = m.Text || '';
        if (t.includes('maps.google.com')) {
          const url = t.match(/https:\/\/maps\.google\.com\/\S+/)?.[0];
          Alert.alert('Laptop location', t.replace(/\s*https:\/\/\S+\s*$/, ''), [
            { text: 'Open in Maps', onPress: () => url && Linking.openURL(url) },
            { text: 'Close', style: 'cancel' },
          ]);
          return;
        }
        // drive the switches from the authoritative status booleans, never from loose text
        // (which flipped them on every passing message). touched = user just acted; don't clobber.
        if (m.Action === 'statjson' && t && !touched.current) {
          try {
            const s = JSON.parse(t);
            if (typeof s.armed === 'boolean') setArmed(s.armed);
            if (typeof s.mic === 'boolean') setMic(s.mic);
            if (typeof s.cam === 'boolean') setCam(s.cam);
          } catch {}
        }
      }),
    [subscribe]
  );

  useFocusEffect(
    useCallback(() => {
      touched.current = false; // re-sync from the laptop's real state on each visit
      if (status === 'connected') send('statjson');
    }, [status, send])
  );

  return (
    <Wrap title="Guard" subtitle="Anti-theft & security posture">
      <Card style={{ marginBottom: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <View style={[styles.ic, { backgroundColor: tint(armed ? C.emerald : C.slate, 0.14) }]}>
              <ShieldCheck size={24} color={armed ? C.emerald : C.slate} weight="fill" />
            </View>
            <View>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>
                {armed ? 'Armed' : 'Disarmed'}
              </Text>
              <Text style={T.muted}>{armed ? 'Sensors will alert you' : 'Alerts are off'}</Text>
            </View>
          </Row>
          <Toggle
            value={armed}
            onValueChange={(v) => {
              touched.current = true;
              setArmed(v);
              send(v ? 'arm' : 'disarm');
            }}
            color={C.emerald}
          />
        </Row>
      </Card>

      <Text style={styles.section}>Sensors</Text>
      <Card>
        <SensorRow icon={Microphone} color={C.blue} label="Microphone" hint="Sound detection" value={mic} onToggle={() => { touched.current = true; setMic(!mic); send('mic'); }} />
        <Sep />
        <SensorRow icon={Camera} color={C.violet} label="Camera" hint="Motion detection" value={cam} onToggle={() => { touched.current = true; setCam(!cam); send('cam'); }} />
      </Card>
      <Text style={[T.muted, { marginTop: 12, marginLeft: 2 }]}>Sensors only fire while armed.</Text>

      <Text style={[styles.section, { marginTop: 18 }]}>Anti-theft</Text>
      <Card>
        <ActionRow
          icon={MapPin}
          color={C.blue}
          label="Locate device"
          hint="Approximate location from its IP, with a map link"
          onPress={async () => {
            if (await ensureAuth('Locate this device')) send('locate');
          }}
        />
        <Sep />
        <ActionRow
          icon={Siren}
          color={C.red}
          label="Alarm"
          hint="Blare the laptop to find or deter it — or silence it"
          onPress={() => setAlarmSheet(true)}
        />
        <Sep />
        <ActionRow
          icon={Megaphone}
          color={C.amber}
          label="Message on screen"
          hint="Flash a message on the laptop — a thief sees it"
          onPress={() => setMsgSheet(true)}
        />
      </Card>
      <Text style={[T.muted, { marginTop: 12, marginLeft: 2 }]}>
        Confirmed with your fingerprint or face — no codes.
      </Text>

      <Text style={[styles.section, { marginTop: 18 }]}>Automations</Text>
      <Card>
        <ActionRow
          icon={Lightning}
          color={C.amber}
          label="Automations"
          hint="If this happens, do that — runs on the laptop even when the app is closed"
          onPress={() => nav.navigate('Rules')}
        />
      </Card>

      <Sheet visible={alarmSheet} onClose={() => setAlarmSheet(false)}>
        <SheetHeader title="Alarm" subtitle="Blare the laptop to find or deter — or silence it" />
        <Bounce
          onPress={async () => { setAlarmSheet(false); if (await ensureAuth('Sound the alarm')) send('alarm'); }}
          style={[styles.alarmBtn, { backgroundColor: C.red }]}
        >
          <Siren size={19} color="#fff" weight="fill" />
          <Text style={styles.alarmBtnT}>Sound alarm</Text>
        </Bounce>
        <Bounce
          onPress={() => { setAlarmSheet(false); send('stopalarm'); }}
          style={[styles.alarmBtn, { backgroundColor: C.card2, marginTop: 10 }]}
        >
          <BellSlash size={19} color={C.ink} weight="bold" />
          <Text style={[styles.alarmBtnT, { color: C.ink }]}>Stop alarm</Text>
        </Bounce>
      </Sheet>

      <Sheet visible={msgSheet} onClose={() => setMsgSheet(false)}>
        <SheetHeader title="Message on screen" subtitle="Appears on the laptop instantly" />
        <TextInput
          value={msg}
          onChangeText={setMsg}
          placeholder="e.g. This laptop is stolen — call +1 555 0100"
          placeholderTextColor={C.muted}
          multiline
          style={styles.msgInput}
        />
        <Bounce
          onPress={() => {
            if (msg.trim()) {
              send('screenmsg', msg.trim());
              setMsg('');
              setMsgSheet(false);
            }
          }}
          style={styles.msgSend}
        >
          <PaperPlaneRight size={18} color="#fff" weight="fill" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14.5 }}>Show on laptop</Text>
        </Bounce>
      </Sheet>
    </Wrap>
  );
}

function ActionRow({ icon: Icon, color, label, hint, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
      <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
        <Row style={{ gap: 12, flex: 1, paddingRight: 10 }}>
          <View style={[styles.sic, { backgroundColor: tint(color, 0.13) }]}>
            <Icon size={20} color={color} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>{label}</Text>
            <Text style={T.muted}>{hint}</Text>
          </View>
        </Row>
        <CaretRight size={18} color={C.muted} weight="bold" />
      </Row>
    </Pressable>
  );
}

function SensorRow({ icon: Icon, color, label, hint, value, onToggle }: any) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Row style={{ gap: 12 }}>
        <View style={[styles.sic, { backgroundColor: tint(color, 0.13) }]}>
          <Icon size={20} color={color} weight="duotone" />
        </View>
        <View>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>{label}</Text>
          <Text style={T.muted}>{hint}</Text>
        </View>
      </Row>
      <Toggle value={value} onValueChange={onToggle} color={color} />
    </Row>
  );
}

const Sep = () => <View style={{ height: 1, backgroundColor: C.line, marginVertical: 10 }} />;

const styles = StyleSheet.create({
  ic: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sic: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 10, marginLeft: 2 },
  msgInput: { minHeight: 92, borderRadius: 14, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, padding: 14, fontSize: 15, color: C.ink, textAlignVertical: 'top', marginBottom: 14 },
  msgSend: { height: 50, borderRadius: 14, backgroundColor: C.dark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  alarmBtn: { height: 54, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  alarmBtnT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
