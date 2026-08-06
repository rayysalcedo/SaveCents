// v4 "Jeepney Fare" speed pass — the money field is now the loudest thing on
// any form: oversized editorial numerals (28px, tabular), a quiet muted
// currency mark, and 1-tap quick-increment chips (+50 / +100 / +500 / +1000)
// so a fare or merienda run is logged in under three seconds without ever
// opening the keyboard.
import React from 'react';
import {
  InputAccessoryView, Platform, Pressable, StyleSheet, Text, TextInput, View, ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { radius, type, useTheme } from '../theme/colors';
import { useFinance } from '../store/finance';

// Formats as you type: "1234567.5" -> "1,234,567.5". Parent holds the RAW
// numeric string (digits + one dot, max 2 decimals); display adds commas.
export function formatMoneyRaw(raw: string): string {
  if (!raw) return '';
  const [intPart, decPart] = raw.split('.');
  const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

export function cleanMoneyInput(text: string): string {
  let v = text.replace(/[^\d.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    const [i, d] = v.split('.');
    v = i + '.' + (d ?? '').slice(0, 2);
  }
  return v.replace(/^0+(?=\d)/, '');
}

const ACCESSORY_ID = 'savecents-money-done';
const QUICK_STEPS = [50, 100, 500, 1000] as const;

export function MoneyInput({
  value, onChangeText, placeholder = '0.00', autoFocus, style, quickChips = true,
}: {
  value: string;
  onChangeText: (raw: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: ViewStyle;
  /** 1-tap increment chips beneath the field. On by default for speed. */
  quickChips?: boolean;
}) {
  const t = useTheme();
  const currency = useFinance((s) => s.currency);

  const bump = (step: number) => {
    const current = parseFloat(value) || 0;
    const next = current + step;
    // Preserve cents only if the user had typed them.
    onChangeText(Number.isInteger(next) ? String(next) : next.toFixed(2));
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <View style={[styles.block, style]}>
      <View style={[styles.wrap, { backgroundColor: t.inputFill, borderColor: t.border }]}>
        <Text style={[styles.symbol, { color: t.textMuted }]}>{currency}</Text>
        <TextInput
          style={[styles.input, { color: t.textPrimary }, type.money as any]}
          value={formatMoneyRaw(value)}
          onChangeText={(txt) => onChangeText(cleanMoneyInput(txt))}
          placeholder={placeholder}
          placeholderTextColor={t.textFaint}
          keyboardType="decimal-pad"
          returnKeyType="done"
          autoFocus={autoFocus}
          inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
        />
      </View>

      {quickChips && (
        <View style={styles.chipRow}>
          {QUICK_STEPS.map((step) => (
            <Pressable
              key={step}
              onPress={() => bump(step)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: t.border, backgroundColor: pressed ? t.emeraldTint : 'transparent' },
              ]}
              hitSlop={4}
            >
              <Text style={[styles.chipText, { color: t.emerald }, type.money as any]}>+{step}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor={t.sheet}>
          {/* Slim seam: fills the strip iOS reserves above number pads */}
          <View style={[styles.accessory, { borderTopColor: t.borderSoft }]} />
        </InputAccessoryView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 12 },
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 60, borderRadius: radius.input, paddingHorizontal: 16,
    borderWidth: 1,
  },
  // Currency mark recedes; the amount leads.
  symbol: { fontSize: 15, fontWeight: '600' },
  accessory: { height: 8, borderTopWidth: 1 },
  // Editorial numerals: large, bold, tabular — instantly legible.
  input: { flex: 1, fontSize: 28, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: {
    flex: 1, height: 36, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '700' },
});
