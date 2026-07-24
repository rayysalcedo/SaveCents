import React from 'react';
import {
  InputAccessoryView, Platform, StyleSheet, Text, TextInput, View, ViewStyle,
} from 'react-native';
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

export function MoneyInput({
  value, onChangeText, placeholder = '0.00', autoFocus, style,
}: {
  value: string;
  onChangeText: (raw: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const currency = useFinance((s) => s.currency);
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: t.inputFill, borderColor: t.borderSoft },
        style,
      ]}
    >
      <Text style={[styles.symbol, { color: t.emerald }]}>{currency}</Text>
      <TextInput
        style={[styles.input, { color: t.textPrimary }, type.money as any]}
        value={formatMoneyRaw(value)}
        onChangeText={(txt) => onChangeText(cleanMoneyInput(txt))}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        keyboardType="decimal-pad"
        returnKeyType="done"
        autoFocus={autoFocus}
        inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
      />
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={ACCESSORY_ID} backgroundColor={t.sheet}>
          {/* Slim seam: fills the strip iOS reserves above number pads (prevents the see-through gap) */}
          <View style={[styles.accessory, { borderTopColor: t.borderSoft }]} />
        </InputAccessoryView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 52, borderRadius: radius.input, paddingHorizontal: 14,
    borderWidth: 1, marginBottom: 12,
  },
  symbol: { fontSize: 17, fontWeight: '800' },
  accessory: { height: 8, borderTopWidth: 1 },
  input: { flex: 1, fontSize: 17, fontWeight: '700' },
});
