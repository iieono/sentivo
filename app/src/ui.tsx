import React from 'react';
import { ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from './theme';

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const inner = (
    <>
      {title ? (
        <View style={{ marginBottom: 14, marginTop: 2 }}>
          <Text style={styles.h1}>{title}</Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
          {inner}
        </ScrollView>
      ) : (
        <View style={[styles.pad, { flex: 1 }]}>{inner}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />;
}

export const T = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '800', color: C.ink },
  body: { fontSize: 14, color: C.ink, fontWeight: '500' },
  muted: { fontSize: 12.5, color: C.muted, fontWeight: '500' },
});

const styles = StyleSheet.create({
  pad: { padding: 18, paddingBottom: 110 },
  h1: { fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: C.muted, fontWeight: '500', marginTop: 2 },
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: '#0F1720',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
});
