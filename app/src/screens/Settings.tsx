import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Bounce, Toggle } from '../anim';
import {
  Bell,
  BellRinging,
  CaretRight,
  Fingerprint,
  GithubLogo,
  LockKey,
  PlugsConnected,
  Pulse,
  SignOut,
  SlidersHorizontal,
  VideoCamera,
} from 'phosphor-react-native';
import { Card, Row, Screen as Wrap, T } from '../ui';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';
import { setBiometricEnabled } from '../auth';
import { storeGet, storeSet } from '../storage';
import { alertsAreMuted, setAlertsMuted } from '../notify';

const FPS_OPTS = [5, 10, 15, 24, 30];
const Q_OPTS = [
  { v: 45, l: 'Low' },
  { v: 65, l: 'Balanced' },
  { v: 80, l: 'High' },
  { v: 95, l: 'Max' },
];

export default function Settings() {
  const { relayUrl, presence, status, forget, send, subscribe } = useConn();
  const nav = useNavigation<any>();
  const [biometric, setBiometric] = useState(true);
  const [appLock, setAppLock] = useState(false);
  const [alerts, setAlerts] = useState(true);
  const [winNotif, setWinNotif] = useState(true);
  const [fps, setFps] = useState(15);
  const [quality, setQuality] = useState(65);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'statjson' && m.Text) {
          try {
            const s = JSON.parse(m.Text);
            if (s.fps) setFps(s.fps);
            if (s.quality) setQuality(s.quality);
            if (typeof s.notify === 'boolean') setWinNotif(s.notify);
          } catch {}
        }
      }),
    [subscribe]
  );
  useFocusEffect(useCallback(() => { if (status === 'connected') send('statjson'); }, [status, send]));
  useEffect(() => { alertsAreMuted().then((m) => setAlerts(!m)); }, []);
  useEffect(() => { storeGet('appLock').then((v) => setAppLock(v === '1')); }, []);

  const pickFps = (n: number) => { setFps(n); send('setfps', String(n)); };
  const pickQ = (n: number) => { setQuality(n); send('setq', String(n)); };

  const connColor = status === 'connected' ? C.emerald : C.amber;

  return (
    <Wrap title="Settings" subtitle="Configuration & security">
      {/* connection */}
      <Card style={{ marginBottom: 14 }}>
        <Row style={{ gap: 12, marginBottom: 12 }}>
          <View style={[styles.ic, { backgroundColor: tint(connColor, 0.14) }]}>
            <PlugsConnected size={21} color={connColor} weight="bold" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Connection</Text>
            <Text style={T.muted} numberOfLines={1}>
              {relayUrl || 'not paired'}
            </Text>
          </View>
        </Row>
        <Info label="Link" value={status} />
        <Info label="Device" value={presence} />
      </Card>

      {/* security */}
      <Text style={styles.section}>Security</Text>
      <Card style={{ marginBottom: 14 }}>
        <SettingRow
          icon={Fingerprint}
          color={C.violet}
          label="Biometric lock"
          hint="Fingerprint / face to confirm sensitive actions — asked once, then held for a few minutes"
          value={biometric}
          onToggle={(v: boolean) => {
            setBiometric(v);
            setBiometricEnabled(v);
          }}
        />
        <Sep />
        <SettingRow
          icon={LockKey}
          color={C.blue}
          label="Require unlock on open"
          hint="Ask for fingerprint / face each time you open Sentivo or return to it"
          value={appLock}
          onToggle={(v: boolean) => {
            setAppLock(v);
            storeSet('appLock', v ? '1' : '');
          }}
        />
      </Card>

      {/* notifications */}
      <Text style={styles.section}>Notifications</Text>
      <Card style={{ marginBottom: 14 }}>
        <SettingRow
          icon={Bell}
          color={C.red}
          label="Alerts"
          hint="Show dead-man, motion & tamper alerts on your phone"
          value={alerts}
          onToggle={(v: boolean) => {
            setAlerts(v);
            setAlertsMuted(!v);
          }}
        />
        <Sep />
        <SettingRow
          icon={Bell}
          color={C.slate}
          label="Windows notifications"
          hint="Forward laptop toasts to your phone"
          value={winNotif}
          onToggle={(v: boolean) => {
            setWinNotif(v);
            send(v ? 'notify_on' : 'notify_off');
          }}
        />
        <Sep />
        <Row style={{ gap: 12 }}>
          <View style={[styles.sic, { backgroundColor: tint(C.emerald, 0.13) }]}>
            <BellRinging size={19} color={C.emerald} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Alerts reach you anytime</Text>
            <Text style={T.muted}>Your relay pushes alerts to this phone even when Sentivo is fully closed — no background app, no battery cost.</Text>
          </View>
        </Row>
      </Card>

      {/* streaming */}
      <Text style={styles.section}>Live stream</Text>
      <Card style={{ marginBottom: 14 }}>
        <Row style={{ gap: 12, marginBottom: 12 }}>
          <View style={[styles.sic, { backgroundColor: tint(C.blue, 0.13) }]}>
            <VideoCamera size={19} color={C.blue} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Frame rate</Text>
            <Text style={T.muted}>Higher = smoother, uses more data</Text>
          </View>
        </Row>
        <Row style={{ gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
          {FPS_OPTS.map((n) => (
            <Bounce key={n} onPress={() => pickFps(n)} style={[styles.chip, fps === n && styles.chipOn]}>
              <Text style={[styles.chipT, fps === n && { color: '#fff' }]}>{n} fps</Text>
            </Bounce>
          ))}
        </Row>
        <Text style={[styles.rowLabel, { marginBottom: 8 }]}>Quality</Text>
        <Row style={{ gap: 7, flexWrap: 'wrap' }}>
          {Q_OPTS.map((q) => (
            <Bounce key={q.v} onPress={() => pickQ(q.v)} style={[styles.chip, quality === q.v && styles.chipOn]}>
              <Text style={[styles.chipT, quality === q.v && { color: '#fff' }]}>{q.l}</Text>
            </Bounce>
          ))}
        </Row>
      </Card>

      {/* config + about */}
      <Text style={styles.section}>More</Text>
      <Card style={{ marginBottom: 16 }}>
        <LinkRow icon={Pulse} color={C.emerald} label="Diagnostics" hint="Test notifications, connection & latency" onPress={() => nav.navigate('Diagnostics')} />
        <Sep />
        <LinkRow icon={SlidersHorizontal} color={C.blue} label="Sensor tuning" hint="Motion sensitivity, mic threshold, idle timeout" onPress={() => nav.navigate('SensorTuning')} />
        <Sep />
        <LinkRow icon={GithubLogo} color={C.ink} label="About Sentivo" hint="Source, docs & install guide on GitHub" onPress={() => Linking.openURL('https://github.com/iieono/sentivo')} />
      </Card>

      <Pressable onPress={() => forget()} style={({ pressed }) => [styles.danger, pressed && { opacity: 0.85 }]}>
        <SignOut size={19} color={C.red} weight="bold" />
        <Text style={{ color: C.red, fontWeight: '700', fontSize: 15 }}>Disconnect this device</Text>
      </Pressable>
    </Wrap>
  );
}

function SettingRow({ icon: Icon, color, label, hint, value, onToggle }: any) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Row style={{ gap: 12, flex: 1, paddingRight: 10 }}>
        <View style={[styles.sic, { backgroundColor: tint(color, 0.13) }]}>
          <Icon size={19} color={color} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={T.muted}>{hint}</Text>
        </View>
      </Row>
      <Toggle value={value} onValueChange={onToggle} color={color} />
    </Row>
  );
}

function LinkRow({ icon: Icon, color, label, hint, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Row style={{ gap: 12, flex: 1 }}>
        <View style={[styles.sic, { backgroundColor: tint(color, 0.13) }]}>
          <Icon size={19} color={color} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={T.muted}>{hint}</Text>
        </View>
      </Row>
      <CaretRight size={18} color={C.muted} weight="bold" />
    </Row>
    </Pressable>
  );
}

function Info({ label, value }: any) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={T.muted}>{label}</Text>
      <Text style={{ color: C.ink, fontWeight: '600', fontSize: 13, maxWidth: '70%' }} numberOfLines={1}>
        {value}
      </Text>
    </Row>
  );
}

const Sep = () => <View style={{ height: 1, backgroundColor: C.line, marginVertical: 10 }} />;

const styles = StyleSheet.create({
  ic: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sic: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  rowLabel: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 10, marginLeft: 2 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 11, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.dark, borderColor: C.dark },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.ink },
  danger: {
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: tint(C.red, 0.1),
    borderWidth: 1,
    borderColor: tint(C.red, 0.25),
  },
});
