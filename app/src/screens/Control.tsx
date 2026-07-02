import React, { useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, CursorClick } from 'phosphor-react-native';
import { C } from '../theme';
import { useConn } from '../conn';

// display label -> key name the agent understands (win.go: sendKey / vkFor)
const SHIFT_MAP: Record<string, string> = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*',
  '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"',
  ',': '<', '.': '>', '/': '?',
};
const FN = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const NUM = ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const R1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'];
const R2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"];
const R3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'];

type ModName = 'Control' | 'Alt' | 'Meta' | 'Shift';

export default function Control() {
  const { sendInput, onLan, status } = useConn();
  const nav = useNavigation<any>();
  const [mods, setMods] = useState({ Control: false, Alt: false, Meta: false, Shift: false });
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const last = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const startT = useRef(0);

  const key = (k: string, d: boolean) => sendInput({ t: 'key', k, d });
  const tap = (k: string) => { key(k, true); key(k, false); };

  // release the one-shot modifiers (Ctrl/Alt/Win/Shift) after a key so combos like Ctrl+C are easy
  const releaseSticky = () => {
    const m = modsRef.current;
    (['Control', 'Alt', 'Meta'] as const).forEach((n) => { if (m[n]) key(n, false); });
    setMods({ Control: false, Alt: false, Meta: false, Shift: false });
  };

  // printable char: apply sticky Shift app-side (agent types printables via Unicode, ignoring Shift VK)
  const pressChar = (ch: string) => {
    tap(modsRef.current.Shift ? (SHIFT_MAP[ch] ?? ch.toUpperCase()) : ch);
    releaseSticky();
  };
  const pressKey = (k: string) => { tap(k); releaseSticky(); };

  const toggleMod = (m: ModName) => {
    const on = !modsRef.current[m];
    if (m !== 'Shift') key(m, on); // Shift is applied app-side for printables
    setMods((p) => ({ ...p, [m]: on }));
  };

  const pad = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        last.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        moved.current = false;
        startT.current = Date.now();
      },
      onPanResponderMove: (e, g) => {
        if (e.nativeEvent.touches.length >= 2) { sendInput({ t: 'scroll', dy: g.vy < 0 ? 1 : -1 }); return; }
        const dx = e.nativeEvent.pageX - last.current.x;
        const dy = e.nativeEvent.pageY - last.current.y;
        last.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          moved.current = true;
          sendInput({ t: 'rmove', dx: Math.round(dx * 1.8), dy: Math.round(dy * 1.8) });
        }
      },
      onPanResponderRelease: () => {
        if (!moved.current && Date.now() - startT.current < 250) sendInput({ t: 'click', b: 'left' });
      },
    })
  ).current;

  const Key = ({ label, onPress, w = 1, active, wide }: any) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.key, { flex: w }, wide && styles.wide, active && styles.keyActive, pressed && styles.keyPressed]}
    >
      <Text style={[styles.keyT, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => nav.goBack()} style={{ padding: 4 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Keyboard & mouse</Text>
          <Text style={styles.sub}>{status === 'connected' ? (onLan ? '⚡ Same network · instant' : 'No video — pure control') : 'Offline'}</Text>
        </View>
      </View>

      {/* trackpad */}
      <View style={styles.pad} {...pad.panHandlers}>
        <CursorClick size={30} color={C.slate} weight="duotone" />
        <Text style={styles.padHint}>Drag to move · tap to click · two fingers to scroll</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable onPress={() => sendInput({ t: 'click', b: 'left' })} style={styles.mbtn}><Text style={styles.mbtnT}>Left click</Text></Pressable>
          <Pressable onPress={() => sendInput({ t: 'click', b: 'right' })} style={styles.mbtn}><Text style={styles.mbtnT}>Right click</Text></Pressable>
        </View>
      </View>

      {/* keyboard */}
      <ScrollView style={{ maxHeight: '52%' }} contentContainerStyle={{ padding: 6 }}>
        <View style={styles.row}>
          <Key label="Esc" onPress={() => pressKey('Escape')} w={1.4} />
          {FN.map((f) => <Key key={f} label={f} onPress={() => pressKey(f)} />)}
        </View>
        <View style={styles.row}>
          {NUM.map((n) => <Key key={n} label={mods.Shift ? SHIFT_MAP[n] ?? n : n} onPress={() => pressChar(n)} />)}
          <Key label="⌫" onPress={() => pressKey('Backspace')} w={1.4} />
        </View>
        <View style={styles.row}>
          <Key label="Tab" onPress={() => pressKey('Tab')} w={1.4} />
          {R1.map((k) => <Key key={k} label={mods.Shift ? (SHIFT_MAP[k] ?? k.toUpperCase()) : k} onPress={() => pressChar(k)} />)}
        </View>
        <View style={styles.row}>
          <Key label="Caps" onPress={() => pressKey('CapsLock')} w={1.6} />
          {R2.map((k) => <Key key={k} label={mods.Shift ? (SHIFT_MAP[k] ?? k.toUpperCase()) : k} onPress={() => pressChar(k)} />)}
          <Key label="Enter" onPress={() => pressKey('Enter')} w={1.8} />
        </View>
        <View style={styles.row}>
          <Key label="Shift" onPress={() => toggleMod('Shift')} active={mods.Shift} w={2} />
          {R3.map((k) => <Key key={k} label={mods.Shift ? (SHIFT_MAP[k] ?? k.toUpperCase()) : k} onPress={() => pressChar(k)} />)}
          <Key label="↑" onPress={() => pressKey('ArrowUp')} />
        </View>
        <View style={styles.row}>
          <Key label="Ctrl" onPress={() => toggleMod('Control')} active={mods.Control} w={1.4} />
          <Key label="Win" onPress={() => toggleMod('Meta')} active={mods.Meta} w={1.2} />
          <Key label="Alt" onPress={() => toggleMod('Alt')} active={mods.Alt} w={1.2} />
          <Key label="Space" onPress={() => pressChar(' ')} wide w={5} />
          <Key label="←" onPress={() => pressKey('ArrowLeft')} />
          <Key label="↓" onPress={() => pressKey('ArrowDown')} />
          <Key label="→" onPress={() => pressKey('ArrowRight')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  sub: { fontSize: 12.5, color: C.muted, fontWeight: '500', marginTop: 1 },
  pad: { flex: 1, margin: 12, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  padHint: { color: C.muted, fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  mbtn: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: C.card2 },
  mbtnT: { color: C.ink, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  key: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 8, height: 42, alignItems: 'center', justifyContent: 'center' },
  wide: {},
  keyActive: { backgroundColor: C.dark, borderColor: C.dark },
  keyPressed: { backgroundColor: C.card2 },
  keyT: { fontSize: 13, fontWeight: '700', color: C.ink },
});
