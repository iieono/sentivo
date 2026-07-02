import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ClipAPI from 'expo-clipboard';
import { Bell, Broadcast, Copy, PlugsConnected, ShieldCheck, TrashSimple, WarningCircle } from 'phosphor-react-native';
import { Card, Row, Screen as Wrap } from '../ui';
import { Bounce, Pop, springLayout } from '../anim';
import { Sheet, SheetHeader } from '../Sheet';
import { C, tint } from '../theme';
import { clearEvents, Ev as Item, getEvents, subscribeEvents } from '../events';

function classify(text: string) {
  const t = text.toLowerCase();
  if (/offline|motion|alarm|tamper|dead|⚠/.test(t)) return { icon: WarningCircle, color: C.red, tag: 'Alert' };
  if (text.trim().startsWith('🔔')) return { icon: Bell, color: C.amber, tag: 'Notification' };
  if (/online|connected/.test(t)) return { icon: PlugsConnected, color: C.emerald, tag: 'System' };
  if (/\barmed\b|disarmed/.test(t)) return { icon: ShieldCheck, color: C.emerald, tag: 'Guard' };
  return { icon: Broadcast, color: C.blue, tag: 'Info' };
}

const clock = (t: number) => {
  const d = new Date(t);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${m < 10 ? '0' + m : m} ${h < 12 ? 'AM' : 'PM'}`;
};

export default function Activity() {
  const [items, setItems] = useState<Item[]>(getEvents());
  const [detail, setDetail] = useState<Item | null>(null);

  // read from the always-on global log (captured even when this tab wasn't open yet)
  useEffect(() => subscribeEvents(() => { springLayout(); setItems([...getEvents()]); }), []);

  const clear = () => {
    springLayout();
    clearEvents();
  };

  return (
    <Wrap title="Activity" subtitle="Alerts & events">
      {items.length > 0 ? (
        <Pressable onPress={clear} style={styles.clear}>
          <TrashSimple size={15} color={C.muted} weight="bold" />
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.muted }}>Clear</Text>
        </Pressable>
      ) : null}

      {items.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 46 }}>
          <Bell size={38} color={C.slate} weight="duotone" />
          <Text style={{ color: C.muted, marginTop: 10, fontWeight: '600' }}>Nothing logged yet</Text>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Alerts and events appear here</Text>
        </Card>
      ) : (
        items.map((it) => {
          const c = classify(it.text);
          const first = it.text.split('\n')[0];
          return (
            <Pop key={it.id} style={{ marginBottom: 10 }}>
              <Bounce onPress={() => setDetail(it)} scaleTo={0.98}>
                <Card>
                  <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                    <View style={[styles.ic, { backgroundColor: tint(c.color, 0.13) }]}>
                      <c.icon size={19} color={c.color} weight="fill" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Row style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: c.color, letterSpacing: 0.4 }}>{c.tag.toUpperCase()}</Text>
                        <Text style={{ fontSize: 11, color: C.muted, fontWeight: '600' }}>{clock(it.t)}</Text>
                      </Row>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }} numberOfLines={1}>
                        {first}
                      </Text>
                    </View>
                  </Row>
                </Card>
              </Bounce>
            </Pop>
          );
        })
      )}

      <Sheet visible={!!detail} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <SheetHeader title={classify(detail.text).tag} subtitle={clock(detail.t)} />
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={{ fontSize: 14.5, color: C.ink, lineHeight: 21 }} selectable>
                {detail.text}
              </Text>
            </ScrollView>
            <Bounce onPress={() => ClipAPI.setStringAsync(detail.text)} style={styles.copyBtn}>
              <Copy size={17} color="#fff" weight="bold" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Copy</Text>
            </Bounce>
          </>
        ) : null}
      </Sheet>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 10, marginBottom: 8, marginTop: -4 },
  ic: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copyBtn: { marginTop: 16, height: 50, borderRadius: 14, backgroundColor: C.dark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
