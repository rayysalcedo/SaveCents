import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/colors';
import { useCloudSync } from '../src/services/sync';
import { useNotificationSync } from '../src/hooks/useNotificationSync';
import SplashIntro from '../src/components/SplashIntro';

export default function RootLayout() {
  const t = useTheme();
  // Every glyph in the app is Ionicons; if the font isn't ready the whole
  // UI renders "?" boxes (seen after cold starts). Hold on the plain
  // canvas until it loads - SplashIntro covers the beat anyway.
  const [fontsLoaded] = useFonts(Ionicons.font);
  useCloudSync(); // login / signup / cold-start session restore all sync here
  useNotificationSync(); // bill-due-tomorrow reminders track the budgets
  if (!fontsLoaded) {
    return <View style={[styles.root, { backgroundColor: t.bg }]} />;
  }
  // v4 editorial: the aurora / glow washes are retired. The canvas is a
  // single flat matte tone so surfaces and numbers carry the hierarchy.
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={t.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="profile"
          options={{ animation: 'slide_from_right', gestureEnabled: true, gestureDirection: 'horizontal', animationDuration: 260 }}
        />
      </Stack>
      <SplashIntro />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
