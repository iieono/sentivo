import React, { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ClipAPI from 'expo-clipboard';
import { ClipboardText, Copy, LinkSimple, X } from 'phosphor-react-native';
import { C, tint } from './theme';
import { useConn } from './conn';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

// ClipSnack — shows a dismissible snackbar (Copy / Open / Dismiss) whenever the laptop
// copies something while clipboard sync is on. Floats above the tab bar over any screen.
export default function ClipSnack() {
  const { subscribe } = useConn();
  const [text, setText] = useState<string | null>(null);
  const y = useRef(new Animated.Value(140)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(y, { toValue: 140, duration: 200, useNativeDriver: true }).start(() => setText(null));
  };

  useEffect(
    () =>
      subscribe((m) => {
        if (m.Kind === 'event' && m.Action === 'clip' && m.Text) {
          setText(m.Text);
          Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 15, bounciness: 7 }).start();
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(dismiss, 6000);
        }
      }),
    [subscribe]
  );

  if (!text) return null;
  return (
    <Animated.View style={[styles.snack, { transform: [{ translateY: y }] }]} pointerEvents="box-none">
      <View style={styles.ic}>
        <ClipboardText size={18} color={C.emerald} weight="duotone" />
      </View>
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
      {isUrl(text) ? (
        <Pressable onPress={() => Linking.openURL(text.trim())} hitSlop={8} style={styles.btn}>
          <LinkSimple size={17} color={C.violet} weight="bold" />
        </Pressable>
      ) : null}
      <Pressable onPress={() => ClipAPI.setStringAsync(text)} hitSlop={8} style={styles.btn}>
        <Copy size={17} color={C.blue} weight="bold" />
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} style={styles.btn}>
        <X size={17} color={C.muted} weight="bold" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  snack: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 96,
    backgroundColor: C.card,
    borderRadius: 18,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: '#0F1720',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  ic: { width: 34, height: 34, borderRadius: 11, backgroundColor: tint(C.emerald, 0.13), alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 13.5, fontWeight: '600', color: C.ink },
  btn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
