// v4.3 Wallet — track every card in one interactive grid.
// Top to bottom: Net worth hero (debit minus credit owed), All/Debit/Credit
// filter, then a two-column grid of brand-colored matte cards. Every card is
// pressable (springs on touch) and carries a three-dot menu that opens the
// editor: balance/amount owed, rename, and for credit cards the limit and
// billing day. Adding an account is one tap on an institution, then a short
// config step (type, starting numbers). Icons only, no emoji.
import React, { useMemo, useState } from 'react';
import {
  Animated, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, UIManager, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { MoneyInput } from '../../src/components/MoneyInput';
import { BankMark, NetworkMark } from '../../src/components/BrandBadge';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { useFinance } from '../../src/store/finance';
import { Account, peso } from '../../src/models/types';
import { COUNTRIES, Institution, institutionFor } from '../../src/data/countries';

// v4 editorial: earthy picker swatches for custom accounts.
const SWATCHES = ['#2E9E5B', '#D97706', '#64748B', '#B45309', '#DC2626', '#6D5A7A', '#5B8A72', '#4C7A8C'];

type Filter = 'all' | 'debit' | 'credit';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Darken a #RRGGBB for card surfaces (same recipe as the dashboard cards).
function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// One card in the wallet STACK. Collapsed cards show only their top strip
// (the next card overlaps them, wallet-style); the expanded card shows the
// full face: balance, credit bar, masked footer, network mark. Faces are a
// quiet two-stop gradient of the brand color. Module scope (rule 3.1).
function StackCard({ acct, inst, t, styles, index, expanded, onToggle, onMenu }: {
  acct: Account; inst?: Institution; t: Palette; styles: any;
  index: number; expanded: boolean; onToggle: () => void; onMenu: () => void;
}) {
  const isCredit = acct.kind === 'credit';
  const base = inst?.color ?? acct.color ?? '#165B33';
  const gradient: [string, string] = [shade(base, -0.55), shade(base, 0.02)];
  const used = isCredit && acct.creditLimit ? Math.min(acct.balance / acct.creditLimit, 1) : 0;
  const network = acct.network ?? inst?.network;
  const kindLabel = isCredit ? 'Credit'
    : inst?.kind === 'wallet' ? 'E-wallet'
    : inst?.kind === 'digital' ? 'Digital bank'
    : inst?.kind === 'fintech' ? 'Fintech'
    : inst?.kind === 'cash' ? 'Cash'
    : 'Debit';

  return (
    <View style={[styles.stackItem, index > 0 && styles.stackOverlap, { zIndex: index + 1 }]}>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onToggle(); }}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.card, !expanded && styles.cardCollapsed]}
        >
          {/* Top strip: always visible */}
          <View style={styles.cardTop}>
            <BankMark inst={inst} name={acct.name} size={30} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>{acct.name}</Text>
              <Text style={styles.cardKind}>{kindLabel}</Text>
            </View>
            {!expanded && <Text style={styles.stripAmount} numberOfLines={1}>{peso(acct.balance)}</Text>}
            <Pressable
              hitSlop={10}
              onPress={(e) => { e.stopPropagation?.(); onMenu(); }}
              style={({ pressed }) => [styles.dots, pressed && { backgroundColor: 'rgba(255,255,255,0.24)' }]}
              accessibilityLabel={`Edit ${acct.name}`}
            >
              <Ionicons name="ellipsis-horizontal" size={15} color="rgba(255,255,255,0.9)" />
            </Pressable>
          </View>

          {expanded && (
            <>
              <View style={{ height: 16 }} />
              <Text style={styles.cardEyebrow}>{isCredit ? 'BALANCE OWED' : 'CURRENT BALANCE'}</Text>
              <Text style={styles.cardAmount} numberOfLines={1}>{peso(acct.balance)}</Text>

              {isCredit && (acct.creditLimit ?? 0) > 0 && (
                <>
                  <View style={styles.cardTrack}>
                    <View style={[styles.cardFill, { width: `${Math.max(used * 100, 3)}%`, backgroundColor: used >= 0.9 ? '#FCA5A5' : 'rgba(255,255,255,0.92)' }]} />
                  </View>
                  <Text style={styles.cardCredit} numberOfLines={1}>
                    {Math.round(used * 100)}% of {peso(acct.creditLimit!)}{acct.billingDay ? ` · bills ${ordinal(acct.billingDay)}` : ''}
                  </Text>
                </>
              )}

              <View style={styles.cardFooter}>
                <Text style={styles.cardMask}>•••• ••••</Text>
                <NetworkMark network={network} height={13} />
              </View>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

export default function WalletScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { accounts, country, addAccount, removeAccount, setAccountBalance, updateAccount } = useFinance();
  const countryData = COUNTRIES[country];

  const debitTotal = accounts.reduce((a, x) => a + (x.kind === 'credit' ? 0 : x.balance), 0);
  const creditOwed = accounts.reduce((a, x) => a + (x.kind === 'credit' ? x.balance : 0), 0);
  const netWorth = debitTotal - creditOwed;
  const hasCredit = accounts.some((a) => a.kind === 'credit');

  const [filter, setFilter] = useState<Filter>('all');
  const shown = accounts.filter((a) =>
    filter === 'all' ? true : filter === 'credit' ? a.kind === 'credit' : a.kind !== 'credit');

  // One card open at a time; the rest collapse into their strips.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openId = shown.some((a) => a.id === expandedId) ? expandedId : shown[shown.length - 1]?.id ?? null;
  const toggleCard = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    setExpandedId(id === openId ? '' : id);
  };

  // ── Add flow: pick institution (or custom) → config step ──────────────
  const [addSheet, setAddSheet] = useState(false);
  const addDrag = useDragToDismiss(() => closeAdd());
  const [pick, setPick] = useState<{ name: string; color?: string; initial?: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState(SWATCHES[0]);
  const [newKind, setNewKind] = useState<'debit' | 'credit'>('debit');
  const [newBalance, setNewBalance] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [newBillDay, setNewBillDay] = useState('');

  const [instSearch, setInstSearch] = useState('');
  const [instFilter, setInstFilter] = useState<'all' | 'bank' | 'digital' | 'wallet' | 'fintech'>('all');
  const pickerList = useMemo(() => {
    const q = instSearch.trim().toLowerCase();
    return countryData.institutions.filter((i) => {
      if (instFilter !== 'all' && i.kind !== instFilter && !(instFilter === 'bank' && i.kind === 'cash')) return false;
      return !q || i.name.toLowerCase().includes(q);
    });
  }, [countryData, instSearch, instFilter]);

  const resetAdd = () => {
    setPick(null); setCustomMode(false); setCustomName('');
    setNewKind('debit'); setNewBalance(''); setNewLimit(''); setNewBillDay('');
    setInstSearch(''); setInstFilter('all');
  };
  const closeAdd = () => { setAddSheet(false); resetAdd(); };

  const confirmAdd = () => {
    if (!pick) return;
    if (newKind === 'credit' && !(parseFloat(newLimit) > 0)) return;
    addAccount(pick.name, pick.color, pick.initial, {
      kind: newKind,
      balance: parseFloat(newBalance) || 0,
      creditLimit: newKind === 'credit' ? parseFloat(newLimit) : undefined,
      billingDay: newKind === 'credit' ? parseInt(newBillDay, 10) || undefined : undefined,
      network: institutionFor(country, pick.name)?.network ?? 'none',
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    closeAdd();
  };

  // ── Editor (opened by tap or the three dots) ──────────────────────────
  const [editing, setEditing] = useState<Account | null>(null);
  const editDrag = useDragToDismiss(() => setEditing(null));
  const [eName, setEName] = useState('');
  const [eBalance, setEBalance] = useState('');
  const [eLimit, setELimit] = useState('');
  const [eBillDay, setEBillDay] = useState('');
  const [eNetwork, setENetwork] = useState<'visa' | 'mastercard' | 'none'>('none');

  const openEdit = (a: Account) => {
    setEName(a.name);
    setEBalance(a.balance ? String(a.balance) : '');
    setELimit(a.creditLimit ? String(a.creditLimit) : '');
    setEBillDay(a.billingDay ? String(a.billingDay) : '');
    setENetwork(a.network ?? institutionFor(country, a.name)?.network ?? 'none');
    setEditing(a);
  };
  const saveEdit = () => {
    if (!editing) return;
    const bal = parseFloat(eBalance);
    if (!Number.isNaN(bal) && bal >= 0) setAccountBalance(editing.id, bal);
    updateAccount(editing.id, {
      name: eName.trim() || editing.name,
      network: eNetwork,
      ...(editing.kind === 'credit' ? {
        creditLimit: Math.max(parseFloat(eLimit) || editing.creditLimit || 0, 0),
        billingDay: Math.min(Math.max(parseInt(eBillDay, 10) || editing.billingDay || 1, 1), 31),
      } : {}),
    });
    Haptics.selectionAsync().catch(() => {});
    setEditing(null);
  };
  const deleteEditing = () => {
    if (!editing) return;
    removeAccount(editing.id);
    setEditing(null);
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Header: title + compact add pill */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Wallet</Text>
          <Pressable
            onPress={() => setAddSheet(true)}
            style={({ pressed }) => [styles.addPill, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={16} color={t.onEmerald} />
            <Text style={styles.addPillText}>Add account</Text>
          </Pressable>
        </View>

        {/* Net worth hero */}
        <View style={styles.heroWrap}>
          <View style={[styles.hero, { backgroundColor: t.forest }]}>
            <Text style={styles.heroEyebrow}>NET WORTH</Text>
            <Text style={styles.heroValue}>{peso(netWorth)}</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Ionicons name="wallet-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={styles.heroStatText}>{peso(debitTotal)}</Text>
              </View>
              {hasCredit && (
                <View style={styles.heroStat}>
                  <Ionicons name="card-outline" size={13} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.heroStatText}>{peso(creditOwed)} owed</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Filter */}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.filterBtn, active && { backgroundColor: t.emerald, borderColor: t.emerald }]}
              >
                <Text style={[styles.filterText, active && { color: t.onEmerald }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Card grid */}
        {shown.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyBadge}>
              <Ionicons name={filter === 'credit' ? 'card-outline' : 'wallet-outline'} size={24} color={t.emerald} />
            </View>
            <Text style={styles.emptyTitle}>
              {filter === 'credit' ? 'No credit cards yet' : filter === 'debit' ? 'No debit accounts yet' : 'Nothing linked yet'}
            </Text>
          </View>
        ) : (
          <View style={styles.stack}>
            {shown.map((a, i) => (
              <StackCard
                key={a.id}
                acct={a}
                inst={institutionFor(country, a.name)}
                t={t}
                styles={styles}
                index={i}
                expanded={a.id === openId}
                onToggle={() => toggleCard(a.id)}
                onMenu={() => openEdit(a)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* ── Add sheet ─────────────────────────────────────────────────── */}
      <Modal visible={addSheet} transparent animationType="slide" onRequestClose={closeAdd}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={closeAdd} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: addDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...addDrag.panHandlers}>
                <View style={styles.handle} />
              </View>

              {!pick && !customMode && (
                <>
                  <View style={styles.sheetHeadRow}>
                    <Text style={styles.sheetTitle}>Add account</Text>
                    <View style={styles.countryLine}>
                      <Ionicons name="location-outline" size={13} color={t.textFaint} />
                      <Text style={styles.countryText}>{countryData.name}</Text>
                    </View>
                  </View>

                  {/* Search */}
                  <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={16} color={t.textFaint} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search banks and wallets"
                      placeholderTextColor={t.textFaint}
                      value={instSearch}
                      onChangeText={setInstSearch}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    {instSearch.length > 0 && (
                      <Pressable hitSlop={8} onPress={() => setInstSearch('')}>
                        <Ionicons name="close-circle" size={16} color={t.textFaint} />
                      </Pressable>
                    )}
                  </View>

                  {/* Category filter */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerChips} keyboardShouldPersistTaps="always">
                    {([
                      { key: 'all', label: 'All' },
                      { key: 'bank', label: 'Banks' },
                      { key: 'digital', label: 'Digital' },
                      { key: 'wallet', label: 'E-wallets' },
                      { key: 'fintech', label: 'Fintech' },
                    ] as const).map((f) => {
                      const active = instFilter === f.key;
                      return (
                        <Pressable
                          key={f.key}
                          onPress={() => setInstFilter(f.key)}
                          style={[styles.pickerChip, active && { backgroundColor: t.emerald, borderColor: t.emerald }]}
                        >
                          <Text style={[styles.pickerChipText, active && { color: t.onEmerald }]}>{f.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <ScrollView style={{ maxHeight: 330 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {pickerList.map((inst, i, arr) => {
                      const added = accounts.some((a) => a.name.toLowerCase() === inst.name.toLowerCase());
                      return (
                        <Pressable
                          key={inst.name}
                          disabled={added}
                          onPress={() => { Keyboard.dismiss(); setPick({ name: inst.name }); }}
                          style={({ pressed }) => [
                            styles.instRow,
                            i < arr.length - 1 && styles.divider,
                            pressed && !added && { backgroundColor: t.inputFill },
                          ]}
                        >
                          <BankMark inst={inst} name={inst.name} size={36} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.instName, added && { color: t.textFaint }]}>{inst.name}</Text>
                            <Text style={styles.instKind}>
                              {inst.kind === 'wallet' ? 'E-wallet' : inst.kind === 'digital' ? 'Digital bank' : inst.kind === 'fintech' ? 'Fintech' : inst.kind === 'cash' ? 'Cash' : 'Bank'}
                            </Text>
                          </View>
                          {added
                            ? <Ionicons name="checkmark-circle" size={18} color={t.emerald} />
                            : <Ionicons name="chevron-forward" size={16} color={t.textFaint} />}
                        </Pressable>
                      );
                    })}
                    {pickerList.length === 0 && (
                      <Text style={styles.noResults}>No matches. Create it as a custom account below.</Text>
                    )}
                  </ScrollView>
                  <View style={styles.customDivider} />
                  <Pressable style={styles.customToggle} onPress={() => { setCustomMode(true); }}>
                    <Ionicons name="color-wand-outline" size={16} color={t.emerald} />
                    <Text style={styles.customToggleText}>Custom account</Text>
                  </Pressable>
                </>
              )}

              {customMode && !pick && (
                <>
                  <View style={styles.stepHead}>
                    <Pressable style={styles.backBtn} onPress={() => setCustomMode(false)} hitSlop={8}>
                      <Ionicons name="chevron-back" size={18} color={t.textPrimary} />
                    </Pressable>
                    <Text style={styles.sheetTitle}>Custom account</Text>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Name"
                    placeholderTextColor={t.textFaint}
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
                    disabled={!customName.trim()}
                    onPress={() => setPick({ name: customName.trim(), color: customColor, initial: customName.trim().slice(0, 2).toUpperCase() })}
                  >
                    <View style={[styles.submit, { backgroundColor: customName.trim() ? t.emerald : t.inputFill }]}>
                      <Text style={[styles.submitText, !customName.trim() && { color: t.textMuted }]}>Continue</Text>
                    </View>
                  </Pressable>
                </>
              )}

              {pick && (
                <>
                  <View style={styles.stepHead}>
                    <Pressable style={styles.backBtn} onPress={() => setPick(null)} hitSlop={8}>
                      <Ionicons name="chevron-back" size={18} color={t.textPrimary} />
                    </Pressable>
                    <BankMark inst={institutionFor(country, pick.name)} name={pick.name} size={30} />
                    <Text style={styles.sheetTitle}>{pick.name}</Text>
                  </View>

                  {/* Type */}
                  <View style={styles.typeRow}>
                    {(['debit', 'credit'] as const).map((k) => {
                      const active = newKind === k;
                      return (
                        <Pressable
                          key={k}
                          onPress={() => setNewKind(k)}
                          style={[styles.typeBtn, active && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}
                        >
                          <Ionicons name={k === 'credit' ? 'card-outline' : 'wallet-outline'} size={15} color={active ? t.emerald : t.textMuted} />
                          <Text style={[styles.typeText, active && { color: t.emerald }]}>{k === 'credit' ? 'Credit' : 'Debit'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>{newKind === 'credit' ? 'CURRENT BALANCE OWED' : 'STARTING BALANCE'}</Text>
                  <MoneyInput value={newBalance} onChangeText={setNewBalance} quickChips={false} />

                  {newKind === 'credit' && (
                    <>
                      <Text style={styles.fieldLabel}>CREDIT LIMIT</Text>
                      <MoneyInput value={newLimit} onChangeText={setNewLimit} quickChips={false} />
                      <Text style={styles.fieldLabel}>BILLING DAY OF MONTH</Text>
                      <TextInput
                        style={styles.dayInput}
                        placeholder="15"
                        placeholderTextColor={t.textFaint}
                        value={newBillDay}
                        onChangeText={(v) => setNewBillDay(v.replace(/[^\d]/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        returnKeyType="done"
                      />
                    </>
                  )}

                  <Pressable onPress={confirmAdd}>
                    <View style={[styles.submit, { backgroundColor: newKind === 'credit' && !(parseFloat(newLimit) > 0) ? t.inputFill : t.emerald }]}>
                      <Text style={[styles.submitText, newKind === 'credit' && !(parseFloat(newLimit) > 0) && { color: t.textMuted }]}>
                        Add {pick.name}
                      </Text>
                    </View>
                  </Pressable>
                </>
              )}
            </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Editor ────────────────────────────────────────────────────── */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setEditing(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: editDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...editDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.stepHead}>
                <BankMark inst={editing ? institutionFor(country, editing.name) : undefined} name={editing?.name ?? ''} size={30} />
                <Text style={styles.sheetTitle}>{editing?.kind === 'credit' ? 'Credit card' : 'Account'}</Text>
                <View style={{ flex: 1 }} />
                <Pressable style={styles.deleteBtn} onPress={deleteEditing} hitSlop={6}>
                  <Ionicons name="trash-outline" size={16} color={t.red} />
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>NAME</Text>
              <TextInput
                style={styles.input}
                value={eName}
                onChangeText={setEName}
                placeholder="Name"
                placeholderTextColor={t.textFaint}
                returnKeyType="done"
              />

              <Text style={styles.fieldLabel}>{editing?.kind === 'credit' ? 'BALANCE OWED' : 'BALANCE'}</Text>
              <MoneyInput value={eBalance} onChangeText={setEBalance} quickChips={false} />

              {editing?.kind === 'credit' && (
                <>
                  <Text style={styles.fieldLabel}>CREDIT LIMIT</Text>
                  <MoneyInput value={eLimit} onChangeText={setELimit} quickChips={false} />
                  <Text style={styles.fieldLabel}>BILLING DAY OF MONTH</Text>
                  <TextInput
                    style={styles.dayInput}
                    value={eBillDay}
                    onChangeText={(v) => setEBillDay(v.replace(/[^\d]/g, '').slice(0, 2))}
                    placeholder="15"
                    placeholderTextColor={t.textFaint}
                    keyboardType="number-pad"
                    returnKeyType="done"
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>CARD NETWORK</Text>
              <View style={styles.typeRow}>
                {(['none', 'visa', 'mastercard'] as const).map((n) => {
                  const active = eNetwork === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setENetwork(n)}
                      style={[styles.typeBtn, active && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}
                    >
                      <Text style={[styles.typeText, active && { color: t.emerald }]}>
                        {n === 'none' ? 'None' : n === 'visa' ? 'Visa' : 'Mastercard'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable onPress={saveEdit}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>Save</Text>
                </View>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800' },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: t.emerald, borderRadius: 999, paddingLeft: 10, paddingRight: 14, height: 36,
  },
  addPillText: { color: t.onEmerald, fontSize: 13, fontWeight: '700' },

  // Hero (floating panel: soft neutral shadow allowed)
  heroWrap: {
    borderRadius: radius.card, marginBottom: 16,
    shadowColor: '#000000', shadowOpacity: t.mode === 'dark' ? 0.20 : 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  hero: { borderRadius: radius.card, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  heroEyebrow: { ...type.eyebrow, color: 'rgba(255,255,255,0.7)' },
  heroValue: { color: '#FFFFFF', fontSize: 38, fontWeight: '800', marginTop: 4, ...type.money },
  heroStats: { flexDirection: 'row', gap: 16, marginTop: 10 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroStatText: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', ...type.money },

  // Filter
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterBtn: {
    flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  filterText: { color: t.textMuted, fontSize: 13, fontWeight: '700' },

  // Card stack — each card overlaps the one above, wallet-style. Cards are
  // the floating exception: a soft neutral shadow lifts each off the pile.
  stack: { paddingTop: 2 },
  stackItem: {
    borderRadius: 18,
    shadowColor: '#000000', shadowOpacity: t.mode === 'dark' ? 0.30 : 0.14,
    shadowRadius: 10, shadowOffset: { width: 0, height: -3 },
    elevation: 5,
  },
  stackOverlap: { marginTop: -12 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  cardCollapsed: { paddingBottom: 24 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  cardName: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  cardKind: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },
  stripAmount: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700', marginRight: 2, ...type.money },
  cardEyebrow: { ...type.eyebrow, color: 'rgba(255,255,255,0.6)', fontSize: 10 },
  cardAmount: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginTop: 2, ...type.money },
  cardTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', marginTop: 10 },
  cardFill: { height: 4, borderRadius: 2 },
  cardCredit: { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 5, ...type.money },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  cardMask: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  emptyBadge: {
    width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  emptyTitle: { color: t.textMuted, fontSize: 14, fontWeight: '600' },

  // Sheets
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,12,14,0.45)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800' },
  sheetHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  countryLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 44, borderRadius: radius.input, paddingHorizontal: 12,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border, marginBottom: 10,
  },
  searchInput: { flex: 1, color: t.textPrimary, fontSize: 14.5, paddingVertical: 0 },
  pickerChips: { gap: 8, paddingBottom: 12 },
  pickerChip: {
    height: 32, borderRadius: 999, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  pickerChipText: { color: t.textMuted, fontSize: 12.5, fontWeight: '700' },
  instKind: { color: t.textFaint, fontSize: 11.5, marginTop: 1 },
  noResults: { color: t.textMuted, fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  countryText: { color: t.textFaint, fontSize: 12, fontWeight: '600' },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  backBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },
  instRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  instName: { color: t.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  customDivider: { height: 1, backgroundColor: t.borderSoft, marginVertical: 12 },
  customToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44 },
  customToggleText: { color: t.emerald, fontSize: 14, fontWeight: '700' },

  // Fields
  fieldLabel: { ...type.eyebrow, color: t.textFaint, marginBottom: 6, marginTop: 2 },
  input: {
    height: 50, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 15.5, fontWeight: '600',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border, marginBottom: 12,
  },
  dayInput: {
    height: 50, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 20, fontWeight: '700',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border, marginBottom: 12,
    ...type.money,
  },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  typeBtn: {
    flex: 1, height: 44, borderRadius: radius.input, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: t.border,
  },
  typeText: { color: t.textMuted, fontSize: 13.5, fontWeight: '700' },
  swatchRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchSel: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  submit: { height: 50, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { color: t.onEmerald, fontSize: 15, fontWeight: '800' },
});
