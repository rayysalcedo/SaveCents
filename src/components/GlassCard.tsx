import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { radius, useTheme } from '../theme/colors';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: boolean;
  pad?: number;
}

export function GlassCard({ children, style, glow = false, pad = 20 }: Props) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.shadowWrap,
        glow && { shadowColor: t.emerald, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
        t.mode === 'light' && !glow && styles.lightShadow,
        style,
      ]}
    >
      <BlurView intensity={30} tint={t.blurTint} style={styles.blur}>
        <View
          style={[
            styles.inner,
            { padding: pad, backgroundColor: t.surface, borderColor: glow ? t.emeraldBorder : t.border },
          ]}
        >
          {children}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shadow and clipping must live on DIFFERENT views: overflow 'hidden'
  // sets masksToBounds on iOS which crops the shadow (the light-mode
  // 'cropped shadow' bug). The blur child clips itself.
  shadowWrap: { borderRadius: radius.card },
  lightShadow: {
    shadowColor: '#0B3A2E', shadowOpacity: 0.09, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  blur: { borderRadius: radius.card, overflow: 'hidden', flexGrow: 1 },
  inner: { borderRadius: radius.card, borderWidth: 1, flexGrow: 1 },
});
