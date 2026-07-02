import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { C } from './theme';

// Sheet — a spring bottom sheet with a tap-to-dismiss backdrop (no dialogs).
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const [render, setRender] = useState(visible);
  const y = useRef(new Animated.Value(600)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRender(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 5 }),
          Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]).start();
      });
    } else {
      Animated.parallel([
        Animated.timing(y, { toValue: 600, duration: 200, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setRender(false));
    }
  }, [visible, y, fade]);

  if (!render) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <BlurView intensity={16} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,23,32,0.34)' }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// SheetHeader — title + optional subtitle at the top of a sheet.
export function SheetHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: C.ink, letterSpacing: -0.3 }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13, color: C.muted, fontWeight: '500', marginTop: 3 }}>{subtitle}</Text> : null}
    </View>
  );
}

// SheetRow — a tappable action row inside a sheet.
export function SheetRow({
  icon: Icon,
  color = C.ink,
  label,
  hint,
  danger,
  onPress,
}: {
  icon: any;
  color?: string;
  label: string;
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const c = danger ? C.red : color;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.card2 }]}>
      <View style={[styles.rowIc, { backgroundColor: hexA(c, danger ? 0.12 : 0.11) }]}>
        <Icon size={21} color={c} weight="duotone" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: danger ? C.red : C.ink }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 12, color: C.muted, fontWeight: '500' }}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 34,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: C.line, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, paddingHorizontal: 6, borderRadius: 14 },
  rowIc: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
