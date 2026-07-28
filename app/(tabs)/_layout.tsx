import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/colors';
import { useUI } from '../../src/store/ui';
import { CentsHub } from '../../src/components/cents/CentsHub';
import { CentsChatModal } from '../../src/components/cents/CentsChatModal';
import { VoiceOverlay } from '../../src/components/cents/VoiceOverlay';

// M5 nav: 5 slots — Home · Wallet · Cents (center ACTION, opens the hub
// overlay, deliberately not a route) · Goals · Analytics
const TAB_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  dashboard: { icon: 'home', label: 'Home' },
  wallet: { icon: 'wallet', label: 'Wallet' },
  goals: { icon: 'flag', label: 'Goals' },
  analytics: { icon: 'bar-chart', label: 'Analytics' },
};

function TabHighlight({ focused, colors }: { focused: boolean; colors: [string, string] }) {
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(pop, {
      toValue: focused ? 1 : 0,
      friction: 6,
      tension: 160,
      useNativeDriver: true,
    }).start();
  }, [focused, pop]);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: pop,
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
        },
      ]}
    >
      <LinearGradient colors={colors} style={styles.circle} />
    </Animated.View>
  );
}

// Raised circular Cents button — opens the Cents hub overlay.
function CentsButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, friction: 6, tension: 200, useNativeDriver: true }).start();
  return (
    <Pressable
      style={styles.centerSlot}
      onPressIn={() => press(0.92)}
      onPressOut={() => press(1)}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
    >
      <Animated.View
        style={[
          styles.centerShadow,
          { shadowColor: t.emerald, transform: [{ scale }] },
        ]}
      >
        <LinearGradient
          colors={active ? [t.mint, t.emerald] : [t.emerald, t.teal]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.centerBtn}
        >
          {/* glass sheen on the button dome */}
          <LinearGradient
            colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.8 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="sparkles" size={24} color={t.onEmerald} />
        </LinearGradient>
      </Animated.View>
      <Text style={[styles.centerLabel, { color: active ? t.emerald : t.textMuted }]}>Cents</Text>
    </Pressable>
  );
}

function LiquidTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const dark = t.mode === 'dark';
  const { hubOpen, openHub, closeHub, chatOpen } = useUI();

  const go = (name: string, key: string, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(name);
  };

  const renderTab = (route: (typeof state.routes)[number], i: number) => {
    const focused = state.index === i;
    const meta = TAB_META[route.name];
    if (!meta) return null;
    return (
      <Pressable key={route.key} style={styles.item} onPress={() => go(route.name, route.key, focused)}>
        <View style={styles.iconSlot}>
          <TabHighlight focused={focused} colors={[t.emerald, t.teal]} />
          <View style={styles.glyphBox}>
            <Ionicons
              name={focused ? meta.icon : (`${meta.icon}-outline` as any)}
              size={19}
              color={focused ? t.onEmerald : t.textMuted}
            />
          </View>
        </View>
        <Text style={[styles.label, { color: focused ? t.emerald : t.textMuted }]} numberOfLines={1}>
          {meta.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)',
          shadowColor: dark ? '#000000' : '#022C22',
          shadowOpacity: dark ? 0.3 : 0.14,
        },
      ]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: 999, overflow: 'hidden',
            borderWidth: 1.2,
            borderColor: dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)',
          },
        ]}
      >
        <BlurView intensity={70} tint={t.blurTint} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={
            dark
              ? ['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0)']
              : ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']
          }
          locations={[0, 0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      {state.routes.slice(0, 2).map((r, i) => renderTab(r, i))}
      <CentsButton
        active={hubOpen || chatOpen}
        onPress={() => (hubOpen ? closeHub() : openHub())}
      />
      {state.routes.slice(2).map((r, i) => renderTab(r, i + 2))}
    </View>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <LiquidTabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      >
        <Tabs.Screen name="dashboard" />
        <Tabs.Screen name="wallet" />
        <Tabs.Screen name="goals" />
        <Tabs.Screen name="analytics" />
      </Tabs>
      {/* Cents overlay stack — above everything incl. the tab bar */}
      <CentsHub />
      <CentsChatModal />
      <VoiceOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 28,
    left: 16,
    right: 16,
    height: 72,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  item: { flex: 1, height: 72, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 4 },
  iconSlot: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  circle: { flex: 1, borderRadius: 20 },
  glyphBox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  centerSlot: { flex: 1.15, alignItems: 'center', justifyContent: 'flex-end', height: 72, paddingBottom: 6 },
  centerShadow: {
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    marginBottom: 3,
  },
  centerBtn: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.65)',
    marginTop: -22, // floats above the pill
  },
  centerLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
});
