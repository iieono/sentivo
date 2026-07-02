import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { ArrowLeft, Bell, BellRinging, Broadcast, Lightning, WifiHigh } from 'phosphor-react-native';
import { Card, Row, T } from '../ui';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

export default function Diagnostics() {
  const { send, subscribe, status, presence, onLan } = useConn();
  const nav = useNavigation<any>();
  const [ping, setPing] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);
  const pingStart = useRef(0);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'pong') { setPing(Date.now() - pingStart.current); setPinging(false); }
      }),
    [subscribe]
  );

  const doPing = () => {
    if (status !== 'connected') return;
    pingStart.current = Date.now();
    setPing(null);
    setPinging(true);
    send('ping');
    setTimeout(() => setPinging(false), 3000);
  };

  const testPush = () => send('test'); // agent fires a real pushable alert → verifies notifications end-to-end
  const testLocal = useCallback(() => {
    Notifications.scheduleNotificationAsync({
      content: { title: 'Sentivo', body: '✅ Local test alert — your phone can show notifications' },
      trigger: null,
    }).catch(() => {});
  }, []);

  const connLabel = status !== 'connected' ? 'Offline' : onLan ? '⚡ Same network (direct)' : 'Connected via relay';
  const connColor = status !== 'connected' ? C.slate : onLan ? C.emerald : C.blue;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ gap: 12 }}>
          <Pressable onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Pressable>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Diagnostics</Text>
            <Text style={T.muted}>Test connection & alerts</Text>
          </View>
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 40 }}>
        {/* connection */}
        <Card style={{ marginBottom: 14 }}>
          <Row style={{ gap: 12 }}>
            <View style={[styles.ic, { backgroundColor: tint(connColor, 0.14) }]}><WifiHigh size={22} color={connColor} weight="fill" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.h}>{connLabel}</Text>
              <Text style={T.muted}>Laptop {presence === 'online' ? 'online' : 'offline'}{ping != null ? ` · ${ping} ms round-trip` : ''}</Text>
            </View>
          </Row>
          <Pressable onPress={doPing} style={[styles.btn, { marginTop: 12 }]} disabled={status !== 'connected'}>
            <Lightning size={17} color={C.ink} weight="bold" />
            <Text style={styles.btnT}>{pinging ? 'Pinging…' : 'Ping laptop (measure latency)'}</Text>
          </Pressable>
        </Card>

        <Text style={styles.section}>Notifications</Text>
        <Card>
          <TestRow icon={BellRinging} color={C.violet} label="Send test notification" hint="Laptop fires a real alert → verifies push end-to-end (works even when the app is closed)" onPress={testPush} />
          <Sep />
          <TestRow icon={Bell} color={C.blue} label="Test alert on this phone" hint="Fires a local notification — checks this phone can display them" onPress={testLocal} />
        </Card>

        <Text style={[styles.section, { marginTop: 18 }]}>Live</Text>
        <Card>
          <TestRow icon={Broadcast} color={C.emerald} label="Screenshot the laptop" hint="Grab one frame to confirm capture works" onPress={() => { send('screenshot'); nav.navigate('Tabs', { screen: 'Screen' }); }} />
        </Card>

        <Text style={[T.muted, { marginTop: 16, marginLeft: 2, fontSize: 12 }]}>
          If “Send test notification” doesn’t arrive but the local test does, the FCM key needs uploading to Expo (eas credentials).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TestRow({ icon: Icon, color, label, hint, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
      <Row style={{ gap: 12, paddingVertical: 4 }}>
        <View style={[styles.sic, { backgroundColor: tint(color, 0.13) }]}><Icon size={20} color={color} weight="duotone" /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: C.ink }}>{label}</Text>
          <Text style={T.muted}>{hint}</Text>
        </View>
      </Row>
    </Pressable>
  );
}

const Sep = () => <View style={{ height: 1, backgroundColor: C.line, marginVertical: 10 }} />;

const styles = StyleSheet.create({
  h: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  ic: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sic: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 10, marginLeft: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 12, backgroundColor: C.card2 },
  btnT: { fontSize: 14, fontWeight: '700', color: C.ink },
});
