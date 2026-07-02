import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clip from 'expo-clipboard';
import { ArrowLeft, ClipboardText, Copy, LinkSimple, PaperPlaneRight } from 'phosphor-react-native';
import { Card, Row, T } from '../ui';
import { Bounce, RefreshBtn } from '../anim';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export default function ClipboardScreen() {
  const { send, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [outbox, setOutbox] = useState('');
  const [sync, setSync] = useState(false);
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const lastClip = useRef('');
  const touched = useRef(false); // once the user flips the switch, don't let a late statjson clobber it
  const pull = () => { setBusy(true); send('clip'); setTimeout(() => setBusy(false), 800); };

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'clip' && typeof m.Text === 'string' && m.Text.length) {
          lastClip.current = m.Text; // a copy from the PC — don't echo it back
          setItems((prev) => (prev[0]?.text === m.Text ? prev : [{ id: ++seq.current, text: m.Text! }, ...prev].slice(0, 50)));
        } else if (m.Action === 'statjson' && m.Text) {
          try { const s = JSON.parse(m.Text); if (!touched.current && typeof s.clip === 'boolean') setSync(s.clip); } catch {}
        }
      }),
    [subscribe]
  );

  // rehydrate the sync toggle from the agent's actual state (so it doesn't reset on reopen)
  useFocusEffect(useCallback(() => { touched.current = false; if (status === 'connected') send('statjson'); }, [status, send]));

  // 2-way auto-sync: while sync is on + this screen is open, push new phone copies to the PC.
  // Android only allows reading the clipboard while the app is foreground, so this is the
  // "while open" half of two-way sync (PC→phone is always-on via the agent's watcher).
  useFocusEffect(useCallback(() => {
    if (!sync) return;
    const id = setInterval(async () => {
      try {
        const t = await Clip.getStringAsync();
        if (t && t !== lastClip.current) { lastClip.current = t; send('setclip', t); }
      } catch {}
    }, 1500);
    return () => clearInterval(id);
  }, [sync, send]));

  const canAct = status === 'connected';
  const copy = (t: string) => Clip.setStringAsync(t);
  const sendText = () => {
    if (outbox.trim()) {
      send('setclip', outbox);
      setOutbox('');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}>
              <ArrowLeft size={22} color={C.ink} weight="bold" />
            </Bounce>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Clipboard</Text>
              <Text style={T.muted}>Copy text & links both ways</Text>
            </View>
          </Row>
          <RefreshBtn busy={busy} onPress={pull} style={{ padding: 2 }} />
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* sync toggle */}
        <Card style={{ marginBottom: 14 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12, flex: 1, paddingRight: 10 }}>
              <View style={[styles.ic, { backgroundColor: tint(C.emerald, 0.13) }]}>
                <ClipboardText size={20} color={C.emerald} weight="duotone" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.h}>Live sync</Text>
                <Text style={T.muted}>Everything you copy on the laptop appears below</Text>
              </View>
            </Row>
            <Switch
              value={sync}
              onValueChange={(v) => {
                touched.current = true;
                setSync(v);
                send(v ? 'clip_on' : 'clip_off');
              }}
              trackColor={{ true: C.emerald, false: '#CBD5E1' }}
              thumbColor="#fff"
            />
          </Row>
        </Card>

        {items.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ClipboardText size={36} color={C.slate} weight="duotone" />
            <Text style={{ color: C.muted, marginTop: 10, fontWeight: '600' }}>
              {sync ? 'Copy something on the laptop…' : 'Pull the clipboard, or turn on Live sync'}
            </Text>
          </Card>
        ) : (
          items.map((it) => (
            <Card key={it.id} style={{ marginBottom: 10 }}>
              <Text style={{ color: C.ink, fontSize: 13.5, lineHeight: 19 }} numberOfLines={4}>
                {it.text}
              </Text>
              <Row style={{ gap: 8, marginTop: 12 }}>
                <Bounce onPress={() => copy(it.text)} style={styles.chip}>
                  <Copy size={15} color={C.blue} weight="bold" />
                  <Text style={styles.chipT}>Copy</Text>
                </Bounce>
                {isUrl(it.text) ? (
                  <Bounce onPress={() => Linking.openURL(it.text.trim())} style={styles.chip}>
                    <LinkSimple size={15} color={C.violet} weight="bold" />
                    <Text style={styles.chipT}>Open</Text>
                  </Bounce>
                ) : null}
              </Row>
            </Card>
          ))
        )}
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.inputBar}>
          <TextInput
            value={outbox}
            onChangeText={setOutbox}
            onSubmitEditing={sendText}
            placeholder="Type or paste text → laptop"
            placeholderTextColor="#AEB8C4"
            style={styles.input}
            returnKeyType="send"
          />
          <Bounce onPress={sendText} disabled={!canAct || !outbox.trim()} style={[styles.send, (!canAct || !outbox.trim()) && { opacity: 0.4 }]}>
            <PaperPlaneRight size={19} color="#fff" weight="fill" />
          </Bounce>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 15, fontWeight: '800', color: C.ink },
  input: { flex: 1, height: 48, backgroundColor: C.card2, borderRadius: 12, paddingHorizontal: 14, fontSize: 14.5, color: C.ink },
  send: { width: 48, height: 48, borderRadius: 12, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  inputBar: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, backgroundColor: C.canvas, borderTopWidth: 1, borderTopColor: C.line },
  ic: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card2, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999 },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.ink },
});
