import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, StyleProp, UIManager, ViewStyle } from 'react-native';
import { ArrowClockwise, CheckCircle } from 'phosphor-react-native';
import { C } from './theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// springLayout — call before a state change so adds/removes/resizes animate smoothly.
export function springLayout() {
  LayoutAnimation.configureNext({
    duration: 320,
    create: { type: 'spring', property: 'scaleXY', springDamping: 0.7 },
    update: { type: 'spring', springDamping: 0.75 },
    delete: { type: 'easeInEaseOut', property: 'opacity', duration: 180 },
  });
}

// Toggle — a bouncy custom switch (thumb overshoots slightly on flip).
export function Toggle({ value, onValueChange, color = C.emerald }: { value: boolean; onValueChange: (v: boolean) => void; color?: string }) {
  const a = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 18, bounciness: 14 }).start();
  }, [value, a]);
  const W = 50, TH = 24, P = 3;
  const tx = a.interpolate({ inputRange: [0, 1], outputRange: [P, W - TH - P] });
  const bg = a.interpolate({ inputRange: [0, 1], outputRange: ['#CBD5E1', color] });
  return (
    <Pressable onPress={() => onValueChange(!value)} hitSlop={8}>
      <Animated.View style={{ width: W, height: 30, borderRadius: 999, backgroundColor: bg, justifyContent: 'center' }}>
        <Animated.View
          style={{
            width: TH, height: TH, borderRadius: 999, backgroundColor: '#fff', transform: [{ translateX: tx }],
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

// Pop — bouncy scale+fade entrance (for list items / things that appear).
export function Pop({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8, delay }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Bounce — any tappable element springs down on press and back on release.
// Runs on the native thread (useNativeDriver) so it stays 60fps and snappy.
export function Bounce({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.94,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const s = useRef(new Animated.Value(1)).current;
  const spring = (to: number) =>
    Animated.spring(s, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 14 }).start();
  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => spring(scaleTo)}
      onPressOut={() => spring(1)}
      style={[style, { transform: [{ scale: s }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// RefreshBtn — a refresh control that spins while busy and flashes a green check when a
// refresh completes, so you can see it's actually working.
export function RefreshBtn({ onPress, busy, style }: { onPress: () => void; busy: boolean; style?: StyleProp<ViewStyle> }) {
  const spin = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      spin.setValue(0);
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
      return () => loop.stop();
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      setDone(true);
      const t = setTimeout(() => setDone(false), 1000);
      return () => clearTimeout(t);
    }
  }, [busy, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Bounce onPress={onPress} style={style}>
      {done ? (
        <CheckCircle size={18} color={C.emerald} weight="bold" />
      ) : (
        <Animated.View style={{ transform: [{ rotate }] }}>
          <ArrowClockwise size={17} color={C.ink} weight="bold" />
        </Animated.View>
      )}
    </Bounce>
  );
}

// Rise — fade + slide-up on mount, with an optional stagger delay.
export function Rise({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6, delay }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}
