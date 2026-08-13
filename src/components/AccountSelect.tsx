// v5.35: the shared account dropdown. Owner: "all items that are so many
// should be a dropdown across the app" - this replaces the wrapping chip
// grids (planner sheets) that grew unusable past a handful of sources.
// Same IN-FLOW menu pattern as the CentsHub pickers (v5.6 lesson: absolute
// overlays clip past the sheet edge and rob the outer ScrollView of the
// height it needs). Module scope by definition, so rule 4 is satisfied and
// any future search field inside won't lose keyboard focus.
import React, { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Account, peso } from '../models/types';
import { institutionFor } from '../data/countries';
import { Palette, type, useTheme } from '../theme/colors';

// What a source can actually cover: balance for debit style, remaining
// credit for cards (mirrors availOf in the planner sheets it replaces).
const availOf = (a: Account) =>
  a.kind === 'credit' ? Math.max((a.creditLimit ?? 0) - a.balance, 0) : a.balance;

function Dot({ t, country, a }: { t: Palette; country: string; a: Account }) {
  const inst = institutionFor(country, a.name);
  const c = a.color ?? inst?.color ?? t.emerald;
  return (
    <View style={{
      width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c + '22', borderWidth: 1, borderColor: c + '55',
    }}>
      <Text style={{ color: c, fontSize: 9.5, fontWeight: '800' }}>
        {a.initial ?? inst?.initial ?? a.name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function AccountSelect({ accounts, country, value, onChange, noneLabel, noneValue = null, placeholder, style }: {
  accounts: Account[];
  country: string;
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;        // e.g. "Track only" / "No source"; omit = an account is required
  noneValue?: string | null; // what picking "none" reports (the receive sheet uses 'none')
  placeholder?: string;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value) ?? null;
  const noneSelected = noneLabel !== undefined && value === noneValue;
  const pick = (v: string | null) => { onChange(v); setOpen(false); };
  const displayName = (a: Account) => (a.nickname ? `${a.name} ${a.nickname}` : a.name);

  return (
    <View style={[{ zIndex: 20 }, style]}>
      <Pressable
        style={[styles.select, open && { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint }]}
        onPress={() => { Keyboard.dismiss(); setOpen(!open); }}
      >
        {selected ? (
          <>
            <Dot t={t} country={country} a={selected} />
            <Text style={styles.selectText} numberOfLines={1}>{displayName(selected)}</Text>
            <Text style={styles.selectBal}>{peso(availOf(selected))}{selected.kind === 'credit' ? ' left' : ''}</Text>
          </>
        ) : noneSelected ? (
          <>
            <View style={styles.noneIcon}>
              <Ionicons name="create-outline" size={14} color={t.textMuted} />
            </View>
            <Text style={styles.selectText}>{noneLabel}</Text>
          </>
        ) : (
          <>
            <View style={styles.noneIcon}>
              <Ionicons name="wallet-outline" size={14} color={t.textMuted} />
            </View>
            <Text style={[styles.selectText, { color: t.textMuted }]}>{placeholder ?? 'Choose an account'}</Text>
          </>
        )}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={t.emerald} />
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <ScrollView
            style={{ maxHeight: 250 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {noneLabel !== undefined && (
              <Pressable style={[styles.row, styles.divider]} onPress={() => pick(noneValue)}>
                <View style={styles.noneIcon}>
                  <Ionicons name="create-outline" size={14} color={t.textMuted} />
                </View>
                <Text style={[styles.rowText, { color: t.textMuted }]}>{noneLabel}</Text>
                {noneSelected && <Ionicons name="checkmark-circle" size={16} color={t.emerald} />}
              </Pressable>
            )}
            {accounts.map((a, i) => (
              <Pressable
                key={a.id}
                style={[styles.row, i < accounts.length - 1 && styles.divider]}
                onPress={() => pick(a.id)}
              >
                <Dot t={t} country={country} a={a} />
                <Text style={styles.rowText} numberOfLines={1}>{displayName(a)}</Text>
                <Text style={styles.rowBal}>{peso(availOf(a))}{a.kind === 'credit' ? ' left' : ''}</Text>
                {value === a.id && <Ionicons name="checkmark-circle" size={16} color={t.emerald} />}
              </Pressable>
            ))}
            {accounts.length === 0 && (
              <Text style={styles.empty}>No accounts yet. Add one in the Wallet tab.</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  selectText: { color: t.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  selectBal: { color: t.textMuted, fontSize: 12, fontWeight: '700', ...type.money },
  noneIcon: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  menu: {
    marginTop: 8,
    borderRadius: 16, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
  divider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  rowText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  rowBal: { color: t.textMuted, fontSize: 12, ...type.money },
  empty: { color: t.textMuted, fontSize: 12.5, padding: 12 },
});
