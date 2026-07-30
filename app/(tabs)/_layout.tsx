import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/colors';
import { useUI } from '../../src/store/ui';
import { CentsHub } from '../../src/components/cents/CentsHub';
import { CentsChatModal } from '../../src/components/cents/CentsChatModal';
import { ScanOverlay } from '../../src/components/cents/ScanOverlay';
import { VoiceOverlay } from '../../src/components/cents/VoiceOverlay';
import { CentsQuickDial, QUICK_OPTIONS, quickIndexForGesture } from '../../src/components/cents/CentsQuickDial';

// M5.5f nav: realistic liquid-glass pill, ICONS ONLY (no labels), with
// press/hold physics. 5 slots: Home · Wallet · Cents (center ACTION, opens
// the hub overlay, deliberately not a route) · Goals · Analytics.
const TAB_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  dashboard: { icon: 'home', label: 'Home' },
  wallet: { icon: 'wallet', label: 'Wallet' },
  goals: { icon: 'flag', label: 'Goals' },
  analytics: { icon: 'bar-chart', label: 'Analytics' },
};

// Soft glass circle that pops in behind the focused icon.
function TabHighlight({ focused, dark }: { focused: boolean; dark: boolean }) {
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: focused ? 1 : 0, friction: 7, tension: 170, useNativeDriver: true }).start();
  }, [focused, pop]);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: pop,
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        },
      ]}
    >
      <View
        style={[
          styles.circle,
          {
            backgroundColor: dark ? 'rgba(110,231,183,0.16)' : 'rgba(16,185,129,0.14)',
            borderWidth: 1,
            borderColor: dark ? 'rgba(110,231,183,0.35)' : 'rgba(16,185,129,0.3)',
          },
        ]}
      />
    </Animated.View>
  );
}

// One icon slot with press physics: dip on touch, spring back on release.
function TabItem({ focused, icon, label, color, dark, onPress }: {
  focused: boolean; icon: keyof typeof Ionicons.glyphMap; label: string;
  color: string; dark: boolean; onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, friction: 6, tension: 320, useNativeDriver: true }).start();
  return (
    <Pressable
      style={styles.item}
      accessibilityLabel={label}
      onPressIn={() => to(0.92)}
      onPressOut={() => to(1)}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
    >
      <Animated.View style={[styles.iconSlot, { transform: [{ scale }] }]}>
        <TabHighlight focused={focused} dark={dark} />
        <View style={styles.glyphBox}>
          <Ionicons
            name={focused ? icon : (`${icon}-outline` as any)}
            size={22}
            color={color}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
}

// Center Cents button: floats in the bar's carved notch (docked-FAB style).
// Press dips it, holding swells it with a mint glow, release springs back.
// M5.6: the center button is now a gesture surface, not just a Pressable.
//   tap            -> hub (unchanged)
//   swipe up       -> quick dial opens; slide over a chip, release to launch
//   hold 220ms     -> swell + glow (unchanged feel) AND the dial opens;
//                     release in place pins it for tapping
// A PanResponder replaces the Pressable because tap / hold / drag-select all
// need to live in ONE responder; state flows through the ui store so the
// CentsQuickDial overlay (mounted in TabLayout) renders in lockstep.
function CentsButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const spring = (v: number) =>
    Animated.spring(scale, { toValue: v, friction: 5, tension: 220, useNativeDriver: true }).start();
  const glowTo = (v: number, dur = 220) =>
    Animated.timing(glow, { toValue: v, duration: dur, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();

  // Gesture bookkeeping. Handlers read the freshest store via useUI.getState()
  // so the responder (created once) never sees stale closures.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedThisGesture = useRef(false);
  const movedRef = useRef(false);
  const startTs = useRef(0);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };

  const openDial = () => {
    if (openedThisGesture.current) return;
    openedThisGesture.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    spring(1.08);
    glowTo(1, 160);
    useUI.getState().openQuick();
  };

  const settle = () => { spring(1); glowTo(0, 320); };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        movedRef.current = false;
        openedThisGesture.current = false;
        startTs.current = Date.now();
        spring(0.94);
        glowTo(0.6);
        clearHold();
        holdTimer.current = setTimeout(openDial, 220);
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dy) > 10 || Math.abs(g.dx) > 10) movedRef.current = true;
        if (!openedThisGesture.current && g.dy < -18) { clearHold(); openDial(); }
        if (openedThisGesture.current) {
          const idx = quickIndexForGesture(g.dx, g.dy);
          const st = useUI.getState();
          if (idx !== st.quickIndex) {
            st.setQuickIndex(idx);
            if (idx >= 0) Haptics.selectionAsync().catch(() => {});
          }
        }
      },
      onPanResponderRelease: () => {
        clearHold();
        settle();
        const st = useUI.getState();
        if (openedThisGesture.current) {
          if (st.quickIndex >= 0) {
            // Drag-select commit: same launches the pinned chips use.
            const i = st.quickIndex;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            st.closeQuick();
            const key = QUICK_OPTIONS[i].key;
            if (key === 'ai') st.openChat();
            else if (key === 'scan') st.openScan();
            else st.openVoice(); // overlay in place; X returns right here
          } else {
            // Released in place: pin the dial so its chips become tappable.
            st.setQuickDragging(false);
            st.setQuickIndex(-1);
          }
          return;
        }
        // Plain tap: dismiss a pinned dial if one is up, else toggle the hub.
        if (!movedRef.current && Date.now() - startTs.current < 320) {
          if (st.quickOpen) { st.closeQuick(); return; }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onPressRef.current();
        }
      },
      onPanResponderTerminate: () => {
        clearHold();
        settle();
        const st = useUI.getState();
        if (openedThisGesture.current && st.quickDragging) st.closeQuick();
      },
    }),
  ).current;

  return (
    <View style={styles.centerFloat} accessibilityLabel="Cents" {...pan.panHandlers}>
      <Animated.View style={[styles.centerShadow, { transform: [{ scale }] }]}>
        <View style={styles.centerClip}>
          {/* Glow ring: brightens while held */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
            <View style={[StyleSheet.absoluteFill, { borderRadius: 28, borderWidth: 2, borderColor: t.mint, backgroundColor: 'rgba(16,185,129,0.14)' }]} />
          </Animated.View>
          {/* Top-lit vertical gradient, matching the reference button */}
          <LinearGradient
            colors={active ? [t.mint, t.emerald] : [t.emerald, t.teal]}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
            style={styles.centerBtn}
          >
            <Image source={require('../../assets/cents-mark.png')} style={{ width: 30, height: 30 }} resizeMode="contain" />
          </LinearGradient>
        </View>
      </Animated.View>
    </View>
  );
}

// Capsule path with a concave notch carved into the top center. The blur is
// MASKED to this path (BlurView cannot be path-clipped any other way), and
// the same path is stroked on top as the border.
//
// Cradle geometry (docked-FAB style, like the reference):
// - The scoop is a single circular arc of radius NOTCH_R centered on the
//   button's center, so the air gap around the button is EVEN everywhere.
// - The scoop meets the flat top edge through two small fillet arcs that are
//   tangent to BOTH the edge and the scoop — no kinks, no "ears".
const BAR_H = 64;
const CAP_R = 32;
const BTN_SIZE = 56;           // Cents button diameter
const BTN_GAP = 7;             // even air gap between button and bar
const NOTCH_R = BTN_SIZE / 2 + BTN_GAP; // 35
const BTN_CY = 14;             // button center, px below the bar's top edge (bigger = sits lower)
const FILLET_R = 8;            // shoulder rounding where scoop meets top edge

function notchedBarPath(w: number): string {
  const cx = w / 2;
  const R = NOTCH_R;
  const f = FILLET_R;
  // Fillet circle centers sit at y = f (tangent to the top edge) and are
  // externally tangent to the scoop circle centered at (cx, BTN_CY):
  const a = Math.sqrt((R + f) ** 2 - (f - BTN_CY) ** 2); // x-offset of fillet centers
  // Tangent point where each fillet hands off to the scoop (on the line
  // joining the two circle centers):
  const k = R / (R + f);
  const tx = a * k;                    // x-offset of hand-off point from cx
  const ty = BTN_CY + (f - BTN_CY) * k; // y of hand-off point
  // When the button sits deep (hand-off points above the scoop's center),
  // the scoop spans >180° — the SVG large-arc flag must flip to 1 or the
  // renderer draws the mirrored shallow arc and eats the bottom gap.
  const largeArc = ty < BTN_CY ? 1 : 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [
    `M ${CAP_R} 0`,
    `H ${r2(cx - a)}`,
    `A ${f} ${f} 0 0 1 ${r2(cx - tx)} ${r2(ty)}`,
    `A ${R} ${R} 0 ${largeArc} 0 ${r2(cx + tx)} ${r2(ty)}`,
    `A ${f} ${f} 0 0 1 ${r2(cx + a)} 0`,
    `H ${w - CAP_R}`,
    `A ${CAP_R} ${CAP_R} 0 0 1 ${w - CAP_R} ${BAR_H}`,
    `H ${CAP_R}`,
    `A ${CAP_R} ${CAP_R} 0 0 1 ${CAP_R} 0`,
    'Z',
  ].join(' ');
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
      <TabItem
        key={route.key}
        focused={focused}
        icon={meta.icon}
        label={meta.label}
        dark={dark}
        color={focused ? t.emerald : t.textMuted}
        onPress={() => go(route.name, route.key, focused)}
      />
    );
  };

  const [barW, setBarW] = useState(0);
  const d = barW > 0 ? notchedBarPath(barW) : '';

  return (
    <View
      style={[
        styles.bar,
        {
          shadowColor: dark ? '#000000' : '#0B3A2E',
          shadowOpacity: dark ? 0.35 : 0.16,
        },
      ]}
      onLayout={(e) => setBarW(Math.round(e.nativeEvent.layout.width))}
    >
      {/* Notched liquid-glass shell: blur masked to the carved path */}
      {barW > 0 && (
        <>
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <Svg width={barW} height={BAR_H}>
                <Path d={d} fill="#FFFFFF" />
              </Svg>
            }
          >
            <BlurView intensity={85} tint={t.blurTint} style={StyleSheet.absoluteFill} />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: dark ? 'rgba(10,20,14,0.42)' : 'rgba(255,255,255,0.5)' },
              ]}
            />
          </MaskedView>
          <Svg width={barW} height={BAR_H} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path
              d={d}
              fill="none"
              stroke={dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.92)'}
              strokeWidth={1.2}
            />
          </Svg>
        </>
      )}

      {state.routes.slice(0, 2).map((r, i) => renderTab(r, i))}
      <View style={styles.centerSlot} pointerEvents="box-none">
        <CentsButton
          active={hubOpen || chatOpen}
          onPress={() => (hubOpen ? closeHub() : openHub())}
        />
      </View>
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
      <CentsQuickDial />
      <CentsHub />
      <CentsChatModal />
      <ScanOverlay />
      <VoiceOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 28,
    left: 20,
    right: 20,
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
    // overflow stays visible: the Cents button floats above the notch
  },
  item: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
  iconSlot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { flex: 1, borderRadius: 22 },
  glyphBox: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  centerSlot: { flex: 1.15, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
  centerFloat: {
    position: 'absolute',
    // Button center must coincide with the scoop center (BTN_CY below the
    // bar's top edge) so the BTN_GAP air ring is even all the way around.
    top: BTN_CY - BTN_SIZE / 2, // -26: floats ~46% above the bar, like the ref
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerShadow: {
    shadowColor: '#10B981', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  centerClip: {
    width: BTN_SIZE, height: BTN_SIZE, borderRadius: BTN_SIZE / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  centerBtn: {
    width: BTN_SIZE, height: BTN_SIZE, borderRadius: BTN_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
  },
});