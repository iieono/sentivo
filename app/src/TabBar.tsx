import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Bell, Broadcast, GearSix, House, ShieldCheck } from 'phosphor-react-native';
import { C } from './theme';
import { useImmersive } from './immersive';

const ICONS: Record<string, any> = { Home: House, Screen: Broadcast, Guard: ShieldCheck, Activity: Bell, Settings: GearSix };
const MARGIN = 16;
const PAD = 8;

// Floating tab bar with a dark pill that springs to the active tab.
export default function FloatingTabBar({ state, navigation }: any) {
  const immersive = useImmersive();
  const routes = state.routes;
  const barW = useWindowDimensions().width - MARGIN * 2; // reactive: corrects after an orientation change
  const tabW = (barW - PAD * 2) / routes.length;
  const x = useRef(new Animated.Value(state.index * tabW)).current;

  useEffect(() => {
    Animated.spring(x, { toValue: state.index * tabW, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
  }, [state.index, tabW, x]);

  if (immersive) return null;
  return (
    <View style={[styles.bar, { width: barW }]}>
      <BlurView intensity={36} tint="light" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      {/* opaque scrim: the blur is too weak on some devices, so content bled through the bar */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.9)' }]} />
      <Animated.View style={[styles.pill, { width: tabW, transform: [{ translateX: x }] }]} />
      {routes.map((route: any, i: number) => {
        const focused = state.index === i;
        const Icon = ICONS[route.name] || House;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable key={route.key} onPress={onPress} style={[styles.tab, { width: tabW }]}>
            <Icon size={21} color={focused ? '#fff' : C.muted} weight={focused ? 'bold' : 'regular'} />
            <Text style={[styles.label, { color: focused ? '#fff' : C.muted }]} numberOfLines={1}>
              {route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 18,
    left: MARGIN,
    height: 66,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.62)',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    padding: PAD,
    shadowColor: '#0F1720',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  pill: { position: 'absolute', left: PAD, top: PAD, bottom: PAD, borderRadius: 20, backgroundColor: C.dark },
  tab: { height: 50, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9.5, fontWeight: '700', marginTop: 3 },
});
