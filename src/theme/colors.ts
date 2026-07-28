// "Fintech Glassmorphism" v3 — themed: Deep Obsidian (dark) / Misty Mint (light)
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useFinance } from '../store/finance';

const brand = {
  emerald: '#10B981',
  mint: '#6EE7B7',
  teal: '#0D9488',
  // M5 redesign: soft sage accents for the friendlier green/white/sage look
  sage: '#9DBFA5',
  sageTint: 'rgba(157,191,165,0.22)',
  sageSoft: 'rgba(157,191,165,0.12)',
  forest: '#047857',
  deepForest: '#065F46',
  red: '#FF4D4D',
  purple: '#8B5CF6',
  amber: '#F59E0B',
  heroGradient: ['#065F46', '#059669', '#0D9488'] as const,
  sheen: 'rgba(255,255,255,0.14)',
  emeraldTint: 'rgba(16,185,129,0.12)',
  emeraldBorder: 'rgba(16,185,129,0.35)',
  redTint: 'rgba(255,77,77,0.12)',
  emeraldGlow: 'rgba(16,185,129,0.25)',
};

interface ThemeMeta {
  mode: 'dark' | 'light';
  blurTint: 'dark' | 'light';
  statusBar: 'light' | 'dark';
}

export const darkPalette = {
  ...brand,
  onEmerald: '#04140D',
  ...( { mode: 'dark', blurTint: 'dark', statusBar: 'light' } as ThemeMeta ),
  bg: '#040906',
  surface: 'rgba(255,255,255,0.07)',
  surfaceStrong: 'rgba(255,255,255,0.11)',
  sheet: '#0A120D',
  menuBg: 'rgba(10,18,13,0.92)',
  border: 'rgba(255,255,255,0.14)',
  borderSoft: 'rgba(255,255,255,0.07)',
  inputFill: 'rgba(255,255,255,0.06)',
  trackBg: 'rgba(255,255,255,0.07)',
  dotIdle: 'rgba(255,255,255,0.2)',
  insetBg: '#06120C',
  tabBarBg: 'rgba(4,9,6,0.55)',
  textPrimary: '#FFFFFF',
  textMuted: '#94A3B8',
  textFaint: 'rgba(148,163,184,0.55)',
};

export type Palette = typeof darkPalette;

// Derived from Color.kt: LightBackground #F8FAFC, LightTextPrimary #022C22, LightTextMuted #0F766E
export const lightPalette: Palette = {
  ...brand,
  onEmerald: '#FFFFFF',
  ...( { mode: 'light', blurTint: 'light', statusBar: 'dark' } as ThemeMeta ),
  bg: '#F1F6F0',
  surface: 'rgba(255,255,255,0.78)',
  surfaceStrong: 'rgba(255,255,255,0.94)',
  sheet: '#FFFFFF',
  menuBg: 'rgba(255,255,255,0.97)',
  border: 'rgba(2,44,34,0.10)',
  borderSoft: 'rgba(2,44,34,0.06)',
  inputFill: 'rgba(2,44,34,0.05)',
  trackBg: 'rgba(2,44,34,0.08)',
  dotIdle: 'rgba(2,44,34,0.18)',
  insetBg: '#FFFFFF',
  tabBarBg: 'rgba(248,252,250,0.65)',
  textPrimary: '#022C22',
  textMuted: '#0F766E',
  textFaint: 'rgba(15,118,110,0.55)',
};

export function useTheme(): Palette {
  const mode = useFinance((s) => s.themeMode);
  const sys = useColorScheme();
  return useMemo(() => {
    const resolved = mode === 'system' ? (sys ?? 'dark') : mode;
    return resolved === 'light' ? lightPalette : darkPalette;
  }, [mode, sys]);
}

// Static brand constants for chart internals (identical across themes)
export const C = darkPalette;

export const radius = {
  card: 26,
  chip: 999,
  input: 16,
  tile: 20,
  sm: 12,
} as const;

export const type = {
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
  money: { fontVariant: ['tabular-nums'] as any, letterSpacing: -0.5 },
};
