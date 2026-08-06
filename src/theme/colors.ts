// "Grounded Editorial" v4 — matte surfaces, earthy neutrals, forest-green
// accents. Design rules:
//   1. Surfaces over glass: solid matte fills + crisp 1px borders. No blur,
//      no neon glow. Shadows are reserved for FLOATING elements (modals, FAB).
//   2. Accent discipline: ~90% of every screen is neutral; forest green marks
//      primary actions/income, warm amber marks alerts, so numbers lead.
//   3. Compatibility: token KEYS are unchanged so every screen re-skins
//      automatically. `teal` === `emerald` on purpose — legacy
//      [emerald, teal] gradients now render as flat solids.
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useFinance } from '../store/finance';

const brand = {
  // Primary action / income green — mature forest, not neon emerald.
  emerald: '#2E9E5B',
  // Identical to emerald so all legacy [emerald, teal] gradients go FLAT.
  teal: '#2E9E5B',
  // Muted sage (was neon mint) — used for subtle held/active states.
  mint: '#7FB89A',
  sage: '#9DBFA5',
  centsYellow: '#E8C547', // brand mark, slightly desaturated
  centsYellowTint: 'rgba(232,197,71,0.12)',
  sageTint: 'rgba(157,191,165,0.14)',
  sageSoft: 'rgba(157,191,165,0.08)',
  forest: '#165B33',
  deepForest: '#11492A',
  // Mature crimson for expenses/destructive — no hot #FF4D4D.
  red: '#DC2626',
  // Cyberpunk purple retired -> editorial slate (charts/allocation hues).
  purple: '#64748B',
  // Warm amber for alerts/warnings per the editorial palette.
  amber: '#D97706',
  // Flat: legacy "hero gradient" call sites now paint a single matte forest.
  heroGradient: ['#165B33', '#165B33', '#165B33'] as const,
  // Sheen overlays render invisible — decorative gloss is retired.
  sheen: 'rgba(255,255,255,0)',
  emeraldTint: 'rgba(46,158,91,0.10)',
  emeraldBorder: 'rgba(46,158,91,0.30)',
  redTint: 'rgba(220,38,38,0.08)',
  // Glow retired: any legacy glow paint resolves to near-nothing.
  emeraldGlow: 'rgba(46,158,91,0.10)',
};

interface ThemeMeta {
  mode: 'dark' | 'light';
  blurTint: 'dark' | 'light';
  statusBar: 'light' | 'dark';
}

export const darkPalette = {
  ...brand,
  onEmerald: '#FFFFFF',
  ...( { mode: 'dark', blurTint: 'dark', statusBar: 'light' } as ThemeMeta ),
  // Deep slate/charcoal — grounded, not pitch-black-with-glow.
  bg: '#121417',
  surface: '#1A1D20',           // SOLID matte card (was translucent glass)
  surfaceStrong: '#212529',
  sheet: '#1A1D20',
  menuBg: '#212529',
  border: 'rgba(255,255,255,0.08)',
  borderSoft: 'rgba(255,255,255,0.05)',
  inputFill: '#212529',
  trackBg: 'rgba(255,255,255,0.06)',
  dotIdle: 'rgba(255,255,255,0.18)',
  insetBg: '#16181B',
  tabBarBg: '#1A1D20',
  textPrimary: '#F4F3F0',       // warm off-white ink
  textMuted: '#9AA1A9',
  textFaint: 'rgba(154,161,169,0.55)',
};

export type Palette = typeof darkPalette;

export const lightPalette: Palette = {
  ...brand,
  // Deeper forest reads better on warm off-white.
  emerald: '#165B33',
  teal: '#165B33',
  emeraldTint: 'rgba(22,91,51,0.07)',
  emeraldBorder: 'rgba(22,91,51,0.22)',
  emeraldGlow: 'rgba(22,91,51,0.08)',
  onEmerald: '#FFFFFF',
  ...( { mode: 'light', blurTint: 'light', statusBar: 'dark' } as ThemeMeta ),
  // Warm paper off-white, not clinical mint.
  bg: '#FAF9F6',
  surface: '#FFFFFF',
  surfaceStrong: '#FFFFFF',
  sheet: '#FFFFFF',
  menuBg: '#FFFFFF',
  border: '#E9ECEF',
  borderSoft: '#F1F3F5',
  inputFill: '#F5F4F0',
  trackBg: '#ECEBE7',
  dotIdle: '#D8D7D2',
  insetBg: '#F5F4F0',
  tabBarBg: '#FFFFFF',
  textPrimary: '#1A1D20',       // charcoal ink
  textMuted: '#6C757D',
  textFaint: 'rgba(108,117,125,0.55)',
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

// Tighter radii: 16px cards read as editorial print, not bubbles.
export const radius = {
  card: 16,
  chip: 999,
  input: 12,
  tile: 12,
  sm: 10,
} as const;

export const type = {
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  money: { fontVariant: ['tabular-nums'] as any, letterSpacing: -0.5 },
};
