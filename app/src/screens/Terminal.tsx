import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, PaperPlaneRight, TrashSimple } from 'phosphor-react-native';
import { Bounce } from '../anim';
import { Row } from '../ui';
import { ensureAuth } from '../auth';
import { C } from '../theme';
import { Msg, useConn } from '../conn';

type Line = { id: number; cmd: string; out?: string; running: boolean };
let seq = 0;

export default function Terminal() {
  const { send, subscribe, status, presence } = useConn();
  const nav = useNavigation<any>();
  const [cmd, setCmd] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const scroll = useRef<ScrollView>(null);
  const pending = useRef(false);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action !== 'exec') return;
        pending.current = false;
        setLines((ls) => {
          const c = [...ls];
          for (let i = c.length - 1; i >= 0; i--) {
            if (c[i].running) {
              c[i] = { ...c[i], out: m.Text || '(no output)', running: false };
              break;
            }
          }
          return c;
        });
        setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
      }),
    [subscribe]
  );

  const run = async () => {
    const c = cmd.trim();
    if (!c || pending.current) return;
    if (!(await ensureAuth('Run a command on your laptop'))) return;
    pending.current = true;
    setLines((ls) => [...ls, { id: ++seq, cmd: c, running: true }]);
    setCmd('');
    send('exec', c);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  };

  const canRun = status === 'connected' && presence === 'online';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}>
              <ArrowLeft size={22} color={C.ink} weight="bold" />
            </Bounce>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Terminal</Text>
              <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500' }}>PowerShell on your laptop</Text>
            </View>
          </Row>
          {lines.length > 0 ? (
            <Bounce onPress={() => setLines([])} style={styles.clear}>
              <TrashSimple size={17} color={C.muted} weight="bold" />
            </Bounce>
          ) : null}
        </Row>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={8}>
        <View style={styles.console}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
          {lines.length === 0 ? (
            <Text style={styles.hint}>Run a command — e.g. <Text style={styles.cmd}>Get-Process | Sort CPU -desc | Select -First 5</Text></Text>
          ) : (
            lines.map((l) => (
              <View key={l.id} style={{ marginBottom: 12 }}>
                <Row style={{ gap: 7, alignItems: 'flex-start' }}>
                  <Text style={styles.prompt}>❯</Text>
                  <Text style={styles.cmd}>{l.cmd}</Text>
                </Row>
                {l.running ? (
                  <ActivityIndicator size="small" color="#6EE7B7" style={{ alignSelf: 'flex-start', marginTop: 6, marginLeft: 4 }} />
                ) : (
                  <Text style={styles.out} selectable>{l.out}</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      </View>

        <View style={styles.inputBar}>
          <TextInput
            value={cmd}
            onChangeText={setCmd}
            onSubmitEditing={run}
            placeholder={canRun ? 'Type a command…' : 'Device offline'}
            placeholderTextColor="#6B7683"
            editable={canRun}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            style={styles.input}
          />
          <Bounce onPress={run} style={[styles.send, (!canRun || !cmd.trim()) && { opacity: 0.4 }]}>
            <PaperPlaneRight size={19} color="#fff" weight="fill" />
          </Bounce>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  clear: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  console: { flex: 1, marginHorizontal: 16, borderRadius: 18, backgroundColor: '#0C1017', overflow: 'hidden' },
  hint: { color: '#7C8794', fontSize: 13, lineHeight: 20 },
  prompt: { color: '#6EE7B7', fontFamily: 'monospace', fontSize: 13, fontWeight: '700' },
  cmd: { color: '#E5EAF0', fontFamily: 'monospace', fontSize: 13, flex: 1 },
  out: { color: '#9AA7B4', fontFamily: 'monospace', fontSize: 12.5, lineHeight: 18, marginTop: 5, marginLeft: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingBottom: 20 },
  input: { flex: 1, height: 48, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, paddingHorizontal: 15, fontFamily: 'monospace', fontSize: 14, color: C.ink },
  send: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
});
