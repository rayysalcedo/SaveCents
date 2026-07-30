// M5: Wallet tab — manage, modify and add linked cards & e-wallets.
// Extracted from the old Profile tab and rebuilt with the friendly sage look.
import React, { useMemo, useState } from 'react';
import {
  Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../src/components/GlassCard';
import { MoneyInput } from '../../src/components/MoneyInput';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { useFinance } from '../../src/store/finance';
import { peso } from '../../src/models/types';
import { COUNTRIES, institutionFor } from '../../src/data/countries';

const SWATCHES = ['#10B981', '#0071F2', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#64748B'];


// Rule 3.1: module scope, not inside the screen's render body (inline
// component types remount their subtree on every parent re-render).
const InstTile = ({ country, t, name, size = 42, colorOverride, initialOverride }: {
  country: string; t: Palette; name: string; size?: number; colorOverride?: string; initialOverride?: string;
}) => {
  const inst = institutionFor(country, name);
  const color = colorOverride ?? inst?.color ?? t.emerald;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.34,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55',
      }}
    >
      <Text style={{ color, fontSize: size * 0.34, fontWeight: '800' }}>
        {initialOverride ?? inst?.initial ?? name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
};

export default function WalletScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { accounts, country, addAccount, removeAccount, setAccountBalance } = useFinance();
  const countryData = COUNTRIES[country];
  const totalLiquid = accounts.reduce((a, x) => a + x.balance, 0);

  const [addSheet, setAddSheet] = useState(false);
  const addDrag = useDragToDismiss(() => setAddSheet(false));
  const editDrag = useDragToDismiss(() => setEditing(null));
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState('#10B981');
  const [editing, setEditing] = useState<{ id: string; name: string; balance: string } | null>(null);

  const saveBalance = () => {
    if (!editing) return;
    const v = parseFloat(editing.balance);
    if (!Number.isNaN(v) && v >= 0) setAccountBalance(editing.id, v);
    setEditing(null);
  };

  const kindOf = (name: string) => {
    const inst = institutionFor(country, name);
    return inst?.kind === 'wallet' ? 'E-wallet' : inst?.kind === 'bank' ? 'Bank' : inst?.kind === 'cash' ? 'Cash' : 'Custom';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Wallet</Text>
            <Text style={styles.subtitle}>Your cards, banks and e-wallets in one place</Text>
          </View>
          <View style={styles.titleBadge}>
            <Ionicons name="card" size={22} color={t.emerald} />
          </View>
        </View>

        {/* Total card — soft green hero */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={[...t.heroGradient]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <LinearGradient
              colors={[t.sheen, 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.9 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroTop}>
              <Text style={styles.heroEyebrow}>TOTAL ACROSS {accounts.length} SOURCE{accounts.length === 1 ? '' : 'S'}</Text>
              <Ionicons name="shield-checkmark" size={16} color="rgba(231,255,246,0.85)" />
            </View>
            <Text style={styles.heroValue}>{peso(totalLiquid)}</Text>
            <View style={styles.heroChips}>
              {accounts.slice(0, 4).map((a) => (
                <View key={a.id} style={styles.heroChip}>
                  <Text style={styles.heroChipText}>{a.name}</Text>
                </View>
              ))}
              {accounts.length > 4 && (
                <View style={styles.heroChip}>
                  <Text style={styles.heroChipText}>+{accounts.length - 4}</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* Accounts list */}
        <Text style={styles.eyebrow}>LINKED SOURCES</Text>
        <GlassCard pad={8} style={{ marginBottom: 16 }}>
          {accounts.length === 0 && (
            <View style={styles.empty}>
              <View style={styles.emptyBadge}>
                <Ionicons name="wallet-outline" size={26} color={t.emerald} />
              </View>
              <Text style={styles.emptyTitle}>Nothing linked yet</Text>
              <Text style={styles.emptyText}>Add your GCash, bank or cash below. It takes one tap.</Text>
            </View>
          )}
          {accounts.map((a, i, arr) => (
            <View key={a.id} style={[styles.acctRow, i < arr.length - 1 && styles.divider]}>
              <InstTile country={country} t={t} name={a.name} colorOverride={a.color} initialOverride={a.initial} />
              <Pressable
                style={{ flex: 1 }}
                onPress={() => setEditing({ id: a.id, name: a.name, balance: a.balance ? String(a.balance) : '' })}
              >
                <Text style={styles.acctName}>{a.name}</Text>
                <Text style={styles.acctHint}>{kindOf(a.name)} · tap to edit balance</Text>
              </Pressable>
              <Text style={styles.acctBalance}>{peso(a.balance)}</Text>
              <Pressable style={styles.trash} onPress={() => removeAccount(a.id)}>
                <Ionicons name="trash-outline" size={16} color={t.red} />
              </Pressable>
            </View>
          ))}
        </GlassCard>

        {/* Big friendly add button */}
        <Pressable onPress={() => setAddSheet(true)}>
          <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addBtn}>
            <Ionicons name="add-circle" size={20} color={t.onEmerald} />
            <Text style={styles.addBtnText}>Add a card or e-wallet</Text>
          </LinearGradient>
        </Pressable>
        <Text style={styles.addHint}>
          {countryData.flag} {countryData.institutions.length} {countryData.name} banks & wallets ready for one-tap setup
        </Text>

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Add account sheet: one tap per institution + custom */}
      <Modal visible={addSheet} transparent animationType="slide" onRequestClose={() => setAddSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setAddSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: addDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...addDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.sheetTitle}>Add account</Text>
              <Text style={styles.sheetSub}>
                {countryData.flag} {countryData.name}. One tap to add, then set the balance from your list.
              </Text>
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {countryData.institutions.map((inst, i, arr) => {
                  const added = accounts.some((a) => a.name.toLowerCase() === inst.name.toLowerCase());
                  return (
                    <Pressable
                      key={inst.name}
                      disabled={added}
                      onPress={() => addAccount(inst.name)}
                      style={({ pressed }) => [
                        styles.instRow,
                        i < arr.length - 1 && styles.divider,
                        pressed && !added && { backgroundColor: t.inputFill },
                      ]}
                    >
                      <InstTile country={country} t={t} name={inst.name} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.instName, added && { color: t.textMuted }]}>{inst.name}</Text>
                        <Text style={styles.instKind}>{inst.kind === 'wallet' ? 'E-wallet' : inst.kind === 'bank' ? 'Bank' : 'Physical cash'}</Text>
                      </View>
                      {added ? (
                        <View style={styles.addedBadge}>
                          <Ionicons name="checkmark" size={12} color={t.emerald} />
                          <Text style={styles.addedText}>Added</Text>
                        </View>
                      ) : (
                        <View style={styles.addBadge}>
                          <Ionicons name="add" size={16} color={t.onEmerald} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.customDivider} />
              {!customMode ? (
                <Pressable style={styles.customToggle} onPress={() => setCustomMode(true)}>
                  <Ionicons name="color-wand" size={16} color={t.emerald} />
                  <Text style={styles.customToggleText}>Create a custom bank or wallet</Text>
                </Pressable>
              ) : (
                <View>
                  <TextInput
                    style={styles.input}
                    placeholder="Name (e.g. Payroll Card)"
                    placeholderTextColor={t.textMuted}
                    value={customName}
                    onChangeText={setCustomName}
                    returnKeyType="done"
                  />
                  <View style={styles.swatchRow}>
                    {SWATCHES.map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => setCustomColor(c)}
                        style={[styles.swatch, { backgroundColor: c }, customColor === c && styles.swatchSel]}
                      >
                        {customColor === c && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => {
                      if (!customName.trim()) return;
                      addAccount(customName.trim(), customColor, customName.trim().slice(0, 2).toUpperCase());
                      setCustomName(''); setCustomMode(false);
                    }}
                  >
                    <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                      <Text style={styles.submitText}>Add custom account</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              )}
            </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Balance editor */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setEditing(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: editDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...editDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.sheetTitle}>{editing?.name} balance</Text>
              <MoneyInput
                value={editing?.balance ?? ''}
                onChangeText={(v) => editing && setEditing({ ...editing, balance: v })}
                autoFocus
              />
              <Pressable onPress={saveBalance}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  titleBadge: {
    width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  emptyBadge: {
    width: 60, height: 60, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: t.textMuted, fontSize: 13, marginTop: 3 },
  eyebrow: { ...type.eyebrow, color: t.textFaint, marginBottom: 12 },
  heroWrap: {
    borderRadius: radius.card, marginBottom: 24,
    shadowColor: t.emerald, shadowOpacity: t.mode === 'dark' ? 0.45 : 0.25, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  hero: { borderRadius: radius.card, padding: 24, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrow: { ...type.eyebrow, color: 'rgba(231,255,246,0.75)' },
  heroValue: { color: '#FFFFFF', fontSize: 40, fontWeight: '800', marginTop: 6, marginBottom: 16, ...type.money },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
  },
  heroChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 22, gap: 10 },
  emptyTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptyText: { color: t.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  acctName: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  acctHint: { color: t.textFaint, fontSize: 11, marginTop: 1 },
  acctBalance: { color: t.textPrimary, fontSize: 14, fontWeight: '800', ...type.money },
  trash: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },
  addBtn: {
    height: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: t.emerald, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  addBtnText: { color: t.onEmerald, fontSize: 15, fontWeight: '800' },
  addHint: { color: t.textFaint, fontSize: 12, textAlign: 'center', marginTop: 10 },
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  sheetSub: { color: t.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  instRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12 },
  instName: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  instKind: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  addBadge: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emerald,
  },
  addedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
  },
  addedText: { color: t.emerald, fontSize: 11, fontWeight: '800' },
  customDivider: { height: 1, backgroundColor: t.borderSoft, marginVertical: 12 },
  customToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46 },
  customToggleText: { color: t.emerald, fontSize: 14, fontWeight: '800' },
  input: {
    height: 54, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 22, fontWeight: '800',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, marginBottom: 12,
    ...type.money,
  },
  swatchRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchSel: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  submit: { height: 52, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },
});
