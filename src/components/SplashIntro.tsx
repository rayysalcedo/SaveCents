// Animated open: a brand-green overlay that plays once at cold start. The
// logo pops in with a spring (slight overshoot, like a coin landing), holds
// a beat, then the whole sheet dissolves into the app. Pure Animated API,
// no native modules, so it ships safely over EAS Update to the existing
// bundle. pointerEvents none: it can never block a tap, even mid-fade.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

const BRAND_GREEN = '#00C968';

export default function SplashIntro() {
  const [done, setDone] = useState(false);
  const scale = useRef(new Animated.Value(0.72)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Expo Go keeps its own loading screen up slightly past first render
      // when running a published bundle; without this hold the whole intro
      // plays behind it. The overlay is solid green during the wait, so the
      // user just sees green a beat longer, then the pop. Standalone builds
      // simply show green a moment before the logo lands, which reads fine.
      Animated.delay(600),
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 90,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(320),
      Animated.timing(overlay, {
        toValue: 0,
        duration: 420,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setDone(true));
  }, [logoOpacity, overlay, scale]);

  if (done) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.fill, { opacity: overlay }]}>
      <Animated.Image
        source={require('../../assets/splash-logo.png')}
        style={[styles.logo, { opacity: logoOpacity, transform: [{ scale }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
  },
  // The logo art shares the overlay's exact green, so the square image
  // blends invisibly into the sheet and only the glyph reads.
  logo: { width: 200, height: 200 },
});