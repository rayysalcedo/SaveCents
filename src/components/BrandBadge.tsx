// v4.1: brand + bank badges. Both prefer a REAL logo image when one is
// registered below, and fall back to an app-icon-style tile: solid brand
// color, white bold monogram, crisp 1px border. Matte, no gloss.
//
// To use official artwork: add the PNG under assets/brands/ (transaction
// merchants) or assets/banks/ (linked sources) and register it in the map —
// React Native require() must be static, hence the explicit tables.
import React from 'react';
import { Image, ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Brand, brandFor } from '../data/brands';
import { Institution } from '../data/countries';
import { useTheme } from '../theme/colors';

// Drop-in logo registries (see header note). Example:
//   'Jollibee': require('../../assets/brands/jollibee.png'),
const BRAND_LOGOS: Record<string, ImageSourcePropType> = {};
// v4.5: when the logo PNGs land in assets/banks/, register each here, e.g.
//   'BDO': require('../../assets/banks/bdo.png'),
//   'GCash': require('../../assets/banks/gcash.png'),
// Keys must match the institution names in src/data/countries.ts exactly.
const BANK_LOGOS: Record<string, ImageSourcePropType> = {};

/** Readable white-or-ink foreground for a given brand color. */
function onColor(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceived luminance (ITU-R BT.601)
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1A1D20' : '#FFFFFF';
}

/**
 * Transaction-row badge. Detects a known merchant from the description;
 * unknown merchants fall back to the budget-category icon in a neutral chip.
 * Savings moves (goalId set) get a green flag — they're progress, not spend.
 */
export function MerchantBadge({
  description, fallbackIcon, isIncome, isGoalMove, size = 38,
}: {
  description: string;
  fallbackIcon: keyof typeof Ionicons.glyphMap;
  isIncome?: boolean;
  isGoalMove?: boolean;
  size?: number;
}) {
  const t = useTheme();
  const brand: Brand | undefined = isGoalMove || isIncome ? undefined : brandFor(description);
  const r = size * 0.34;

  if (isGoalMove) {
    return (
      <View style={[styles.tile, { width: size, height: size, borderRadius: r, backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
        <Ionicons name="flag" size={size * 0.42} color={t.emerald} />
      </View>
    );
  }
  if (isIncome) {
    return (
      <View style={[styles.tile, { width: size, height: size, borderRadius: r, backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
        <Ionicons name="trending-up" size={size * 0.42} color={t.emerald} />
      </View>
    );
  }
  if (brand) {
    const logo = BRAND_LOGOS[brand.name];
    return (
      <View style={[styles.tile, { width: size, height: size, borderRadius: r, backgroundColor: brand.color, borderColor: 'rgba(0,0,0,0.06)' }]}>
        {logo
          ? <Image source={logo} style={{ width: size * 0.62, height: size * 0.62 }} resizeMode="contain" />
          : <Text style={[styles.mono, { color: onColor(brand.color), fontSize: size * (brand.initial.length > 1 ? 0.30 : 0.40) }]}>{brand.initial}</Text>}
      </View>
    );
  }
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: r, backgroundColor: t.inputFill, borderColor: t.borderSoft }]}>
      <Ionicons name={fallbackIcon} size={size * 0.42} color={t.textMuted} />
    </View>
  );
}

/**
 * Linked-source logo mark: a white tile carrying the bank's REAL logo when
 * one is registered in BANK_LOGOS. v4.6: no letter-monogram fallback — with
 * no registered logo it renders nothing, so cards show just the name until
 * the artwork lands.
 */
export function BankMark({ inst, name, size = 34 }: { inst?: Institution; name: string; size?: number }) {
  const logo = BANK_LOGOS[inst?.name ?? name];
  if (!logo) return null;
  return (
    <View style={[styles.tile, styles.bankTile, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Image source={logo} style={{ width: size * 0.68, height: size * 0.68 }} resizeMode="contain" />
    </View>
  );
}

/**
 * Card-network mark for card faces. Drawn, not an asset: VISA as its italic
 * wordmark, Mastercard as the interlocking red/amber discs. Reads instantly
 * at card scale without shipping trademark files.
 */
export function NetworkMark({ network, height = 14 }: { network?: 'visa' | 'mastercard' | 'none'; height?: number }) {
  if (!network || network === 'none') return null;
  if (network === 'visa') {
    return (
      <Text
        style={{
          color: '#FFFFFF', fontWeight: '900', fontStyle: 'italic',
          fontSize: height, letterSpacing: 0.5, includeFontPadding: false as any,
        }}
      >
        VISA
      </Text>
    );
  }
  const d = height * 1.35;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: '#EB001B' }} />
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: '#F79E1B', marginLeft: -d * 0.38, opacity: 0.92 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  bankTile: { backgroundColor: '#FFFFFF', borderColor: 'rgba(0,0,0,0.08)' },
  mono: { fontWeight: '800', letterSpacing: -0.3 },
});
