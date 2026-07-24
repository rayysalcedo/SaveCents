import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../src/theme/colors';
import { useCloudSync } from '../src/services/sync';

export default function RootLayout() {
  const t = useTheme();
  useCloudSync(); // login / signup / cold-start session restore all sync here
  const dark = t.mode === 'dark';
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* Aurora — deep green in dark, soft mint wash in light */}
      <LinearGradient
        colors={
          dark
            ? ['rgba(6,95,70,0.55)', 'rgba(13,148,136,0.18)', 'rgba(4,9,6,0)']
            : ['rgba(16,185,129,0.16)', 'rgba(110,231,183,0.08)', 'rgba(244,250,247,0)']
        }
        style={styles.aurora}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <LinearGradient
        colors={dark ? ['rgba(13,148,136,0.20)', 'rgba(13,148,136,0)'] : ['rgba(13,148,136,0.10)', 'rgba(13,148,136,0)']}
        style={[styles.glow, { top: -140, left: -100, width: 380, height: 380 }]}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 1, y: 1 }}
      />
      <LinearGradient
        colors={dark ? ['rgba(16,185,129,0.14)', 'rgba(16,185,129,0)'] : ['rgba(16,185,129,0.08)', 'rgba(16,185,129,0)']}
        style={[styles.glow, { bottom: -160, right: -120, width: 420, height: 420 }]}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 0, y: 0 }}
      />
      <StatusBar style={t.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glow: { position: 'absolute', borderRadius: 999 },
  aurora: { position: 'absolute', top: 0, left: 0, right: 0, height: 340 },
});