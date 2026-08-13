// "Minted Gold" v5 — Cents the coin IS the brand. Warm parchment light
// mode, espresso dark mode, one gold system in three roles:
//   COIN GOLD (bright #F5C64A / #F2BE22): the mark, fills, Paid chips, and
//     the ENTIRE dark-mode accent, with espresso ink on top of it.
//   DEEP GOLD (#A16207): light mode's working gold - buttons, active states,
//     icons - readable on parchment, unmistakably gold beside the fills.
//   Semantics: GOLD IN, RED OUT. Positive money glints gold (earning mints
//     coins); expenses keep the mature crimson. There is NO green and NO
//     third warning hue - urgent rides the red family, gentle stays neutral.
//   Owner decision (M5.47): credit/debit CARD colors are DATA (institution
//     brands, user swatches) and are never rethemed - only app chrome is.
// Design rules carried from v4:
//   1. Surfaces over glass: solid matte fills + crisp 1px borders.
//   2. Accent discipline: ~90% of every screen stays neutral so numbers lead.
//   3. Compatibility: token KEYS are unchanged (emerald now paints GOLD) so
//      every screen re-skins automatically; `teal` === `emerald` keeps
//      legacy gradients flat.
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useFinance } from '../store/finance';

const brand = {
  // Primary action / positive money — bright coin gold (dark-mode value;
  // light mode overrides to the deep working gold below).
  emerald: '#F5C64A',
  // Identical to emerald so all legacy [emerald, teal] gradients go FLAT.
  teal: '#F5C64A',
  // Champagne neutrals — subtle held/active states, warmed from sage.
  mint: '#CDB77E',
  sage: '#C2AD79',
  centsYellow: '#F2BE22', // the coin itself, promoted to hero
  centsYellowTint: 'rgba(242,190,34,0.12)',
  sageTint: 'rgba(242,190,34,0.12)',
  sageSoft: 'rgba(242,190,34,0.07)',
  forest: '#8A5C00',      // deep gold ink (positive money text on light)
  deepForest: '#5C3D00',
  // Mature crimson for expenses/destructive — no hot #FF4D4D.
  red: '#DC2626',
  // Editorial slate for chart/allocation hues (unchanged).
  purple: '#64748B',
  // Owner decision (M5.47): NO third warning hue. Urgent = red family,
  // gentle = neutral. amber resolves to crimson so legacy warn paint
  // reads urgent instead of colliding with the gold brand.
  amber: '#DC2626',
  // The espresso "gold card" hero (owner decision c).
  heroGradient: ['#241A05', '#1A1206', '#0F0A03'] as const,
  // Sheen overlays render invisible — decorative gloss is retired.
  sheen: 'rgba(255,255,255,0)',
  emeraldTint: 'rgba(245,198,74,0.12)',
  emeraldBorder: 'rgba(245,198,74,0.32)',
  redTint: 'rgba(220,38,38,0.08)',
  // Glow retired: any legacy glow paint resolves to near-nothing.
  emeraldGlow: 'rgba(245,198,74,0.10)',
};

interface ThemeMeta {
  mode: 'dark' | 'light';
  blurTint: 'dark' | 'light';
  statusBar: 'light' | 'dark';
}

export const darkPalette = {
  ...brand,
  // Espresso ink on bright gold — the coin look. White-on-yellow fails
  // contrast; this is what makes dark-mode buttons feel minted.
  onEmerald: '#231A00',
  ...( { mode: 'dark', blurTint: 'dark', statusBar: 'light' } as ThemeMeta ),
  // Warm espresso, not blue slate — cool charcoal makes gold look sickly;
  // warm charcoal makes it look like a black card.
  bg: '#15110C',
  surface: '#1D1812',           // SOLID matte card
  surfaceStrong: '#262017',
  sheet: '#1D1812',
  menuBg: '#262017',
  border: 'rgba(255,244,214,0.09)',
  borderSoft: 'rgba(255,244,214,0.05)',
  inputFill: '#262017',
  trackBg: 'rgba(255,244,214,0.07)',
  dotIdle: 'rgba(255,244,214,0.18)',
  insetBg: '#191510',
  tabBarBg: '#1D1812',
  textPrimary: '#F5F1E8',       // warm parchment ink
  textMuted: '#A79E8C',
  textFaint: 'rgba(167,158,140,0.55)',
};

export type Palette = typeof darkPalette;

export const lightPalette: Palette = {
  ...brand,
  // Light mode's WORKING gold: deep enough to read as text/icons on
  // parchment, unmistakably gold next to the bright coin fills.
  emerald: '#A16207',
  teal: '#A16207',
  emeraldTint: 'rgba(161,98,7,0.08)',
  emeraldBorder: 'rgba(161,98,7,0.26)',
  emeraldGlow: 'rgba(242,190,34,0.14)',
  onEmerald: '#FFFFFF',
  ...( { mode: 'light', blurTint: 'light', statusBar: 'dark' } as ThemeMeta ),
  // Warm parchment, one shade toward the coin.
  bg: '#FBF8F2',
  surface: '#FFFFFF',
  surfaceStrong: '#FFFFFF',
  sheet: '#FFFFFF',
  menuBg: '#FFFFFF',
  border: '#EAE4D8',
  borderSoft: '#F3EEE4',
  inputFill: '#F7F3EA',
  trackBg: '#EEE8DB',
  dotIdle: '#DCD5C6',
  insetBg: '#F7F3EA',
  tabBarBg: '#FFFFFF',
  textPrimary: '#221B10',       // espresso ink
  textMuted: '#77705F',
  textFaint: 'rgba(119,112,95,0.55)',
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
