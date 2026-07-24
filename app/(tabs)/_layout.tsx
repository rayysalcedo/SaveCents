import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/colors';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  dashboard: 'grid',
  chat: 'sparkles',
  goals: 'flag',
  profile: 'person',
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

function LiquidTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const dark = t.mode === 'dark';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)',
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

      {state.routes.map((route, i) => {
        const focused = state.index === i;
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
          >
            <View style={styles.iconSlot}>
              <TabHighlight focused={focused} colors={[t.emerald, t.teal]} />
              <View style={styles.glyphBox}>
                <Ionicons
                  name={focused ? ICONS[route.name] : (`${ICONS[route.name]}-outline` as any)}
                  size={20}
                  color={focused ? t.onEmerald : t.textMuted}
                />
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="goals" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 28,
    left: 24,
    right: 24,
    height: 68,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  item: { flex: 1, height: 68, alignItems: 'center', justifyContent: 'center' },
  iconSlot: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  circle: { flex: 1, borderRadius: 24 },
  glyphBox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
});
