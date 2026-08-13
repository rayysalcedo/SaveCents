// Animated open, v2 "the coin flip" (v5.50, owner request): the Cents coin
// (transparent asset) spins in like a flipped coin - rotateY with
// perspective, three decelerating turns - then LANDS with a real bounce
// (Easing.bounce on translateY), holds a beat, and the espresso sheet
// dissolves into the app. Pure Animated API, no native modules: Expo Go
// safe and ships over EAS Update.
//
// Taste dials (all single numbers): SPINS (turns), SPIN_MS (speed),
// DROP (landing height), BOUNCE_MS (settle time).
//
// NOTE the two-layer truth of splash screens: the OS's very first frame is
// the STATIC native splash (app.json) by design - nothing can animate it.
// This overlay takes over at first React render and plays the motion. For a
// zero-flash handoff the native splash art should be re-exported as the
// coin on the same espresso #241A05 (owner-side asset task).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

const ESPRESSO = '#241A05'; // matches the adaptive icon bg; gold pops on it
// WHOLE turns only - a half turn lands the coin on its BACK (mirrored),
// which is exactly the bug the owner caught on device (v80 fix).
const SPINS = 3;
const SPIN_MS = 950;
const DROP = 22;
const BOUNCE_MS = 520;

export default function SplashIntro() {
  const [done, setDone] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;      // 0..1 -> rotateY
  const scale = useRef(new Animated.Value(0.78)).current;
  const y = useRef(new Animated.Value(-DROP - 34)).current; // starts high
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Expo Go keeps its own loading screen up slightly past first render
      // when running a published bundle; without this hold the whole intro
      // plays behind it. Standalone builds just show espresso a beat.
      Animated.delay(600),
      // Phase A - the flip: the coin drops toward its mark while spinning
      // on its vertical axis, decelerating like a real toss.
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(spin, {
          toValue: 1, duration: SPIN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1, duration: SPIN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(y, {
          toValue: -DROP, duration: SPIN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
      // Phase B - the landing: classic double-bounce settle.
      Animated.timing(y, {
        toValue: 0, duration: BOUNCE_MS, easing: Easing.bounce, useNativeDriver: true,
      }),
      Animated.delay(240),
      Animated.timing(overlay, {
        toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
    ]).start(() => setDone(true));
  }, [logoOpacity, overlay, scale, spin, y]);

  const rotateY = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${SPINS * 360}deg`],
  });

  if (done) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.fill, { opacity: overlay }]}>
      <Animated.Image
        source={require('../../assets/cents-splash.png')}
        style={[styles.logo, {
          opacity: logoOpacity,
          // perspective must lead the chain for rotateY to read as a coin
          // flip instead of a flat squash.
          transform: [{ perspective: 800 }, { translateY: y }, { rotateY }, { scale }],
        }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ESPRESSO,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
  },
  logo: { width: 168, height: 168 },
});
