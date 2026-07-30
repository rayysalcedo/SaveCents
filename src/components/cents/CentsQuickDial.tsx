// M5.6 — Cents quick dial. Swipe up or hold the center Cents button and three
// buttons fan out above the notch: Cents AI, Cents Scanner, Cents Voice.
// Owner spec (v23): icon-only circles that LOOK AND FEEL like the Cents
// button itself — same top-lit emerald gradient, same emerald shadow, no
// borders, no labels (labels stay as accessibilityLabel). Icons are the
// brand yellow marks, so the buttons read yellow-and-green like the logo.
// Highlight while dragging = the same swell + glow ring the Cents button uses
// on hold, with the ring in brand yellow.
//
// Two ways to pick:
//   - drag: keep the finger down, slide up to a button, release to launch;
//   - pin: hold and release in place, the dial stays open, tap a button.
// Backdrop tap or another tap on the Cents button dismisses a pinned dial.
//
// The gesture lives on the CentsButton PanResponder in app/(tabs)/_layout.tsx;
// this overlay renders state from the ui store so the two never disagree.
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Palette, useTheme } from '../../theme/colors';
import { useUI } from '../../store/ui';

// ── Geometry (shared with the button's gesture math) ────────────────────────
// Bar: bottom 28, height 64; button top overhangs the bar by 14, size 56.
// Button center from screen bottom = 78. The dial fans out on an ARC around
// that center (owner spec v24: a curve is easier to drag-select than a line):
// Scanner up-left, Cents AI at the top, Voice up-right, all ~105pt away.
export const QUICK_BTN = 56;
const BTN_CENTER_BOTTOM = 78;

export const QUICK_OPTIONS = [
  { key: 'scan', label: 'Cents Scanner', dx: -78, rise: 72 },
  { key: 'ai', label: 'Cents AI', dx: 0, rise: 106 },
  { key: 'voice', label: 'Cents Voice', dx: 78, rise: 72 },
] as const;

// Position helpers for the overlay.
export function quickButtonBottom(i: number): number {
  return BTN_CENTER_BOTTOM + QUICK_OPTIONS[i].rise - QUICK_BTN / 2;
}

// Map a PanResponder gesture (dx, dy; dy negative = up) to the nearest arc
// button, or -1 while the finger is still near the Cents button.
export function quickIndexForGesture(dx: number, dy: number): number {
  const rise = -dy;
  if (Math.hypot(dx, rise) < 48) return -1; // dead zone around the start
  if (rise < 24) return -1;                 // below the fan
  let best = -1;
  let bestD = Infinity;
  QUICK_OPTIONS.forEach((o, i) => {
    const d = Math.hypot(o.dx - dx, o.rise - rise);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= 92 ? best : -1;
}

type Styles = ReturnType<typeof makeStyles>;

// Module scope per HANDOFF rule 3.1.
function DialButton({ t, styles, index, label, open, highlighted, pinned, onPick }: {
  t: Palette; styles: Styles; index: number; label: string;
  open: boolean; highlighted: boolean; pinned: boolean; onPick: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 190,
      delay: open ? index * 40 : 0, // stagger the fan-out, collapse together
    }).start();
  }, [open, anim, index]);

  useEffect(() => {
    Animated.spring(pop, { toValue: highlighted ? 1 : 0, useNativeDriver: true, friction: 6, tension: 300 }).start();
  }, [highlighted, pop]);

  const opt = QUICK_OPTIONS[index];
  return (
    <Animated.View
      pointerEvents={pinned ? 'auto' : 'none'}
      style={[
        styles.btnShadow,
        { bottom: quickButtonBottom(index) },
        {
          opacity: anim,
          transform: [
            { translateX: opt.dx },
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
            { scale: Animated.multiply(anim, pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] })) },
          ],
        },
        highlighted && styles.btnShadowHot,
      ]}
    >
      {/* Name pill: appears only for the highlighted option (owner spec) */}
      <Animated.View
        pointerEvents="none"
        style={[styles.labelPill, { opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
      >
        <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
      </Animated.View>
      {/* flex:1 is REQUIRED here: an unsized Pressable collapses flex children
          to 0 height (the v21 "chips render as lines" bug). */}
      <Pressable onPress={onPick} disabled={!pinned} style={styles.press} accessibilityLabel={label}>
        <View style={styles.clip}>
          {/* Same top-lit vertical gradient as the Cents button */}
          <LinearGradient
            colors={[t.emerald, t.teal]}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
            style={styles.grad}
          >
            {/* Cents AI gets a chat bubble, NOT the cent mark: the main
                button already wears the mark, and a twin directly above it
                read as the button "showing up again" (owner feedback). */}
            {opt.key === 'ai' && <Ionicons name="chatbubble" size={24} color={t.centsYellow} />}
            {opt.key === 'scan' && <Image source={require('../../../assets/cents-scan-mark.png')} style={styles.icon} resizeMode="contain" />}
            {opt.key === 'voice' && <Ionicons name="mic" size={24} color={t.centsYellow} />}
          </LinearGradient>
          {/* Yellow glow ring ON TOP, mirrors the Cents button's hold ring */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: pop }]} pointerEvents="none">
            <View style={styles.hotRing} />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function CentsQuickDial() {
  const t = useTheme();
  const styles = React.useMemo(() => makeStyles(t), [t]);
  const { quickOpen, quickDragging, quickIndex, closeQuick, openChat, openScan, openVoice } = useUI();
  const veil = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(veil, { toValue: quickOpen ? 1 : 0, duration: quickOpen ? 160 : 120, useNativeDriver: true }).start();
  }, [quickOpen, veil]);

  const pick = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    closeQuick();
    const key = QUICK_OPTIONS[i].key;
    if (key === 'ai') openChat();
    else if (key === 'scan') openScan();
    else openVoice(); // overlay in place; its X returns right here
  };

  if (!quickOpen) return null;
  const pinned = !quickDragging;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={pinned ? 'auto' : 'none'}>
      {/* Backdrop: only interactive when the dial is pinned */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]} pointerEvents={pinned ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeQuick} disabled={!pinned}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.mode === 'dark' ? 'rgba(3,10,6,0.34)' : 'rgba(6,40,28,0.14)' }]} />
        </Pressable>
      </Animated.View>

      {QUICK_OPTIONS.map((o, i) => (
        <DialButton
          key={o.key}
          t={t} styles={styles}
          index={i} label={o.label}
          open={quickOpen}
          highlighted={quickIndex === i}
          pinned={pinned}
          onPick={() => pick(i)}
        />
      ))}
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  // Shadow wrapper matches the Cents button's centerShadow; clipping happens
  // on the child (rule 3.2: never shadow + overflow hidden on one view).
  btnShadow: {
    position: 'absolute',
    alignSelf: 'center',
    width: QUICK_BTN,
    height: QUICK_BTN,
    shadowColor: '#10B981', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  // Highlighted button jumps the sibling stack (zIndex for iOS, elevation
  // for Android) so its name pill renders OVER the neighboring buttons —
  // without this the Scanner pill slid under the AI button.
  btnShadowHot: {
    shadowColor: t.centsYellow,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    zIndex: 10,
    elevation: 20,
  },
  press: { flex: 1 },
  clip: { flex: 1, borderRadius: QUICK_BTN / 2, overflow: 'hidden' },
  grad: { flex: 1, borderRadius: QUICK_BTN / 2, alignItems: 'center', justifyContent: 'center' },
  hotRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: QUICK_BTN / 2,
    borderWidth: 2,
    borderColor: t.centsYellow,
    backgroundColor: 'rgba(255,222,89,0.12)',
    zIndex: 2,
  },
  icon: { width: 26, height: 26 },
  // White, small, and WIDER THAN THE BUTTON via an explicit width + left
  // offset: an absolute child sized by the 56px wrapper wrapped its text into
  // a vertical blob (the v24 "Cen ts Sca nner" bug).
  labelPill: {
    position: 'absolute',
    bottom: QUICK_BTN + 8,
    width: 120,
    left: (QUICK_BTN - 120) / 2,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0B3A2E', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  labelText: { color: t.deepForest, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});
