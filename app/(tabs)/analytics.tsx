// M5: Analytics tab — data visualization, transaction search, and CSV/PDF export.
// Charts here are computed from REAL transactions (first slice of the M5
// "truth & polish" work — no mocked series on this screen).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { GlassCard } from '../../src/components/GlassCard';
import { TrendChart, TrendPoint } from '../../src/components/TrendChart';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { Category, Transaction, peso } from '../../src/models/types';
import { BUDGET_CATEGORIES } from '../../src/data/countries';

type Filter = 'all' | 'income' | 'expense';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expenses' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


// M5.6: tap a transaction to edit or delete it. Module scope per HANDOFF
// rule 3.1. The store reverses the old effects and applies the new ones, so
// account balances and budget spent stay truthful either way.

// v5.45: the editor's budget picker - the last chip list in the app becomes
// the house searchable dropdown, with "make this a budget" built in: any
// transaction (an unassigned Jollibee, say) can mint its budget right here,
// prefilled from the description, without leaving the sheet.
function TxBudgetSelect({ t, styles, categories, value, onPick, seedName, onCreate }: {
  t: Palette; styles: any;
  categories: Category[];
  value: string;
  onPick: (name: string) => void;
  seedName: string; // tx description, prefills the create form
  onCreate: (name: string, limit: number, icon: string, base: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBase, setNewBase] = useState<string | null>(null);
  const [newLimit, setNewLimit] = useState('');
  const picked = categories.find((c) => c.name.toLowerCase() === value.toLowerCase()) ?? null;
  const ql = q.trim().toLowerCase();
  const list = ql
    ? categories.filter((c) => c.name.toLowerCase().includes(ql) || (c.category ?? '').toLowerCase().includes(ql))
    : categories;
  const reset = () => { setQ(''); setCreating(false); setNewName(''); setNewBase(null); setNewLimit(''); };
  const choose = (name: string) => { onPick(name); Keyboard.dismiss(); reset(); setOpen(false); };
  const limitNum = parseFloat(newLimit);
  const canCreate = !!newBase && !Number.isNaN(limitNum) && limitNum > 0;
  const submitCreate = () => {
    if (!canCreate || !newBase) return;
    const preset = BUDGET_CATEGORIES.find((c) => c.name === newBase);
    const name = newName.trim() || newBase;
    onCreate(name, limitNum, preset?.icon ?? 'pricetag', newBase);
    choose(name);
  };
  return (
    <View>
      <Pressable
        style={[styles.txbSelect, open && { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint }]}
        onPress={() => { Keyboard.dismiss(); if (open) reset(); setOpen(!open); }}
      >
        <View style={styles.txbIcon}>
          <Ionicons name={(picked?.icon as any) || 'pricetag-outline'} size={14} color={picked ? t.emerald : t.textMuted} />
        </View>
        <Text style={[styles.txbSelectText, !picked && { color: t.textMuted }]} numberOfLines={1}>
          {picked?.name ?? value ?? 'Choose a budget'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={t.emerald} />
      </Pressable>
      {open && !creating && (
        <View style={styles.txbMenu}>
          <View style={styles.txbSearchRow}>
            <Ionicons name="search" size={14} color={t.textMuted} />
            <TextInput
              style={styles.txbSearchInput}
              placeholder="Search budgets"
              placeholderTextColor={t.textMuted}
              value={q}
              onChangeText={setQ}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {list.map((c) => (
              <Pressable key={c.id} style={[styles.txbRow, styles.txbDivider]} onPress={() => choose(c.name)}>
                <View style={styles.txbIcon}>
                  <Ionicons name={(c.icon as any) || 'pricetag'} size={14} color={t.emerald} />
                </View>
                <Text style={styles.txbRowText} numberOfLines={1}>{c.name}</Text>
                {value.toLowerCase() === c.name.toLowerCase() && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
              </Pressable>
            ))}
            {list.length === 0 && <Text style={styles.txbEmpty}>Nothing matches "{q.trim()}".</Text>}
          </ScrollView>
          <Pressable
            style={styles.txbCreateRow}
            onPress={() => { setNewName(seedName.trim()); setNewBase(null); setNewLimit(''); setCreating(true); }}
          >
            <View style={styles.txbCreateIcon}>
              <Ionicons name="add" size={14} color={t.emerald} />
            </View>
            <Text style={styles.txbCreateText}>Make this a budget</Text>
          </Pressable>
        </View>
      )}
      {open && creating && (
        <View style={[styles.txbMenu, { padding: 12, gap: 9 }]}>
          <Text style={styles.txbCreateTitle}>NEW BUDGET</Text>
          <TextInput
            style={styles.txbCreateInput}
            placeholder="Name"
            placeholderTextColor={t.textMuted}
            value={newName}
            onChangeText={setNewName}
            returnKeyType="done"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="always">
            {BUDGET_CATEGORIES.map((c) => {
              const on = newBase === c.name;
              return (
                <Pressable key={c.name} style={[styles.txbBaseChip, on && { backgroundColor: t.emerald, borderColor: t.emerald }]} onPress={() => setNewBase(c.name)}>
                  <Ionicons name={c.icon as any} size={12} color={on ? t.onEmerald : t.emerald} />
                  <Text style={[styles.txbBaseText, on && { color: t.onEmerald }]}>{c.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <TextInput
            style={styles.txbCreateInput}
            placeholder="Monthly limit"
            placeholderTextColor={t.textMuted}
            value={newLimit}
            onChangeText={(v) => setNewLimit(v.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={styles.txbCancel} onPress={() => setCreating(false)}>
              <Text style={styles.txbCancelText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.txbGo, { backgroundColor: canCreate ? t.emerald : t.inputFill }]}
              disabled={!canCreate}
              onPress={submitCreate}
            >
              <Text style={[styles.txbGoText, !canCreate && { color: t.textMuted }]}>Create and use</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function TxEditor({ t, styles, tx, categories, accounts, onSave, onDelete, onClose, onCreateBudget }: {
  t: Palette; styles: any; tx: Transaction;
  categories: Category[];
  accounts: { id: string; name: string }[];
  onCreateBudget: (name: string, limit: number, icon: string, base: string) => void;
  onSave: (patch: { amount?: number; description?: string; categoryId?: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const sheetDrag = useDragToDismiss(onClose);
  const [amount, setAmount] = useState(String(tx.amount));
  const [description, setDescription] = useState(tx.description);
  const [categoryId, setCategoryId] = useState(tx.categoryId);

  const save = () => {
    const v = parseFloat(amount.replace(/,/g, ''));
    if (Number.isNaN(v) || v <= 0) {
      Alert.alert('Check the amount', 'Enter an amount greater than zero.');
      return;
    }
    onSave({ amount: v, description, categoryId });
  };

  const confirmDelete = () =>
    Alert.alert('Delete this transaction', 'Balances and budgets will be adjusted back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.editScrim} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editKav} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: sheetDrag.drag }] }}>
          <Pressable style={styles.editSheet} onPress={() => Keyboard.dismiss()}>
            <View style={styles.grabZone} {...sheetDrag.panHandlers}>
              <View style={styles.editHandle} />
            </View>
            {/* M5.26: receipt format - the transaction's story at a glance,
                with the name and amount editable in place. */}
            <Text style={styles.rcptKicker}>
              {tx.goalId ? 'SAVINGS MOVE' : tx.isIncome ? 'INCOME' : 'EXPENSE'}
            </Text>
            <TextInput
              style={styles.rcptName}
              value={description}
              onChangeText={setDescription}
              placeholder="What was this?"
              placeholderTextColor={t.textFaint}
              textAlign="center"
            />
            <View style={styles.rcptAmountRow}>
              <Text style={[styles.rcptAmountSign, { color: tx.isIncome ? t.emerald : t.textPrimary }]}>
                {tx.isIncome ? '+' : '-'} ₱
              </Text>
              <TextInput
                style={[styles.rcptAmount, tx.isIncome && { color: t.emerald }]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={t.textFaint}
              />
            </View>

            <View style={styles.rcptCard}>
              <View style={styles.rcptRow}>
                <Text style={styles.rcptRowLabel}>Date</Text>
                <Text style={styles.rcptRowValue}>
                  {new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
              <View style={styles.rcptRowDivider} />
              <View style={styles.rcptRow}>
                <Text style={styles.rcptRowLabel}>Time</Text>
                <Text style={styles.rcptRowValue}>
                  {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
              <View style={styles.rcptRowDivider} />
              <View style={styles.rcptRow}>
                <Text style={styles.rcptRowLabel}>{tx.isIncome ? 'Paid into' : 'Paid from'}</Text>
                <Text style={styles.rcptRowValue}>
                  {accounts.find((a) => a.id === tx.accountId)?.name ?? 'No source set'}
                </Text>
              </View>
              <View style={styles.rcptRowDivider} />
              <View style={styles.rcptRow}>
                <Text style={styles.rcptRowLabel}>{tx.goalId ? 'Savings' : 'Budget'}</Text>
                <Text style={styles.rcptRowValue}>
                  {tx.goalId ? (tx.isIncome ? 'Out of savings' : 'Into savings') : tx.categoryId}
                </Text>
              </View>
            </View>

            {!tx.isIncome && !tx.goalId && (
              <>
                <Text style={styles.editLabel}>Budget</Text>
                <TxBudgetSelect
                  t={t} styles={styles}
                  categories={categories}
                  value={categoryId}
                  onPick={setCategoryId}
                  seedName={description || tx.description}
                  onCreate={onCreateBudget}
                />
              </>
            )}

            <Pressable onPress={save} style={({ pressed }) => [styles.editSaveWrap, pressed && { opacity: 0.9 }]}>
              <View style={[styles.editSave, { backgroundColor: t.emerald }]}>
                <Text style={styles.editSaveText}>Save changes</Text>
              </View>
            </Pressable>
            <Pressable onPress={confirmDelete} style={styles.editDelete}>
              <Ionicons name="trash-outline" size={15} color={t.red} />
              <Text style={styles.editDeleteText}>Delete transaction</Text>
            </Pressable>
          </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

export default function AnalyticsScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { transactions, categories, currency, profile, accounts, updateTransaction, removeTransaction } = useFinance();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // v5.43 (chunk 2): budget + source filters, applied via floating pickers.
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [acctFilter, setAcctFilter] = useState<string | null>(null);
  const [catMenu, setCatMenu] = useState(false);
  const [acctMenu, setAcctMenu] = useState(false);
  // v5.43: Cents can arm these filters ("show my Grab expenses") - consume
  // whatever is waiting and clear it.
  const addBudget = useFinance((s2) => s2.addBudget);
  const ledgerFilter = useFinance((s2) => s2.ledgerFilter);
  const setLedgerFilter = useFinance((s2) => s2.setLedgerFilter);
  useEffect(() => {
    if (!ledgerFilter) return;
    setQuery(ledgerFilter.query ?? '');
    setCatFilter(ledgerFilter.categoryName ?? null);
    setAcctFilter(null);
    setFilter('all');
    setLedgerFilter(null);
  }, [ledgerFilter, setLedgerFilter]);
  const [exporting, setExporting] = useState<null | 'csv' | 'pdf'>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [spendShowAll, setSpendShowAll] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  // M5.27: long ledgers page instead of scrolling forever.

  // ---- Search + filter ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filter === 'income' && !tx.isIncome) return false;
      if (filter === 'expense' && tx.isIncome) return false;
      if (catFilter && tx.categoryId.toLowerCase() !== catFilter.toLowerCase()) return false;
      if (acctFilter && tx.accountId !== acctFilter) return false;
      if (!q) return true;
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.categoryId.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
      );
    });
  }, [transactions, query, filter, catFilter, acctFilter]);

  // ---- Real computed insights ----
  const totals = useMemo(() => {
    const income = filtered.filter((x) => x.isIncome).reduce((a, x) => a + x.amount, 0);
    const spent = filtered.filter((x) => !x.isIncome).reduce((a, x) => a + x.amount, 0);
    return { income, spent, net: income - spent };
  }, [filtered]);

  // Net savings series, selectable D/W/M/Y like the dashboard's Savings
  // insight — but computed from REAL transactions (this screen's rule).
  // v5.39 (transactions tab redesign, chunk 1): the crypto-style trend
  // chart. Calendar periods (this week / month / year), an anchor timestamp
  // the chevrons and the month/year dropdown move, and a scrub index the
  // chart reports so the header swaps to the pinned day. Values are HONEST:
  // no Math.max clamp - a negative net day dips below the dashed zero line.
  const [trendMetric, setTrendMetric] = useState<'net' | 'spent'>('net');
  const [trendRange, setTrendRange] = useState<'W' | 'M' | 'Y'>('W');
  const [trendAnchor, setTrendAnchor] = useState<number>(() => Date.now());
  const [trendScrub, setTrendScrub] = useState<number | null>(null);
  const [periodMenu, setPeriodMenu] = useState(false);
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayStartTs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const weekStartOf = (ts: number) => {
    const d = new Date(ts);
    const monIdx = (d.getDay() + 6) % 7; // Mon = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - monIdx);
  };

  const trend = useMemo(() => {
    const now = new Date();
    const todayStart = dayStartTs(now);
    const flowBetween = (from: number, to: number) => {
      let inc = 0, exp = 0;
      for (const x of transactions) {
        if (x.timestamp < from || x.timestamp >= to) continue;
        if (x.isIncome) inc += x.amount; else exp += x.amount;
      }
      return { net: inc - exp, spent: exp };
    };
    const pointsFor = (anchor: number) => {
      const pts: (TrendPoint & { ghost: number })[] = [];
      const push = (from: number, to: number, label: string, sub: string) => {
        const f = flowBetween(from, to);
        pts.push({
          label, sub,
          value: trendMetric === 'net' ? f.net : f.spent,
          ghost: trendMetric === 'net' ? f.spent : f.net,
        });
      };
      if (trendRange === 'W') {
        const ws = weekStartOf(anchor);
        for (let i = 0; i < 7; i++) {
          const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
          const from = d.getTime();
          if (from > todayStart) break; // the future has no data yet
          push(from, from + 86_400_000, DAY_SHORT[i],
            d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
        }
      } else if (trendRange === 'M') {
        const a = new Date(anchor);
        const mStart = new Date(a.getFullYear(), a.getMonth(), 1);
        const lastDay = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
        const cap = mStart.getFullYear() === now.getFullYear() && mStart.getMonth() === now.getMonth()
          ? now.getDate() : lastDay;
        for (let day = 1; day <= cap; day++) {
          const from = new Date(a.getFullYear(), a.getMonth(), day).getTime();
          // v5.40: wheel mode shows EVERY day number - no more compressed
          // colliding ticks; the user swipes through the month instead.
          push(from, from + 86_400_000, String(day),
            new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }
      } else {
        const a = new Date(anchor);
        const cap = a.getFullYear() === now.getFullYear() ? now.getMonth() : 11;
        for (let m = 0; m <= cap; m++) {
          const from = new Date(a.getFullYear(), m, 1).getTime();
          const to = new Date(a.getFullYear(), m + 1, 1).getTime();
          // v5.40: full month names - the wheel gives them room.
          push(from, to, MONTHS[m],
            `${MONTHS[m]} ${a.getFullYear()}`);
        }
      }
      return pts;
    };
    const pts = pointsFor(trendAnchor);
    const total = pts.reduce((acc, x) => acc + x.value, 0);
    // Previous FULL period for the change chip.
    const a = new Date(trendAnchor);
    const prevAnchor = trendRange === 'W'
      ? trendAnchor - 7 * 86_400_000
      : trendRange === 'M'
        ? new Date(a.getFullYear(), a.getMonth() - 1, 15).getTime()
        : new Date(a.getFullYear() - 1, 6, 1).getTime();
    const prevTotal = pointsFor(prevAnchor).reduce((acc, x) => acc + x.value, 0);
    const changePct = prevTotal !== 0 ? ((total - prevTotal) / Math.abs(prevTotal)) * 100 : null;
    // Period label + whether the forward chevron has anywhere to go.
    const ws = weekStartOf(trendAnchor);
    const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isCurrent = trendRange === 'W'
      ? weekStartOf(Date.now()).getTime() === ws.getTime()
      : trendRange === 'M'
        ? a.getFullYear() === now.getFullYear() && a.getMonth() === now.getMonth()
        : a.getFullYear() === now.getFullYear();
    const periodLabel = trendRange === 'W'
      ? (isCurrent ? 'This week' : `${fmtShort(ws)} – ${fmtShort(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6))}`)
      : trendRange === 'M'
        ? `${['January','February','March','April','May','June','July','August','September','October','November','December'][a.getMonth()]} ${a.getFullYear()}`
        : String(a.getFullYear());
    // v5.43: period bounds so the In/Out/Net chips sync to this view.
    const from = trendRange === 'W'
      ? weekStartOf(trendAnchor).getTime()
      : trendRange === 'M'
        ? new Date(a.getFullYear(), a.getMonth(), 1).getTime()
        : new Date(a.getFullYear(), 0, 1).getTime();
    const to = trendRange === 'W'
      ? from + 7 * 86_400_000
      : trendRange === 'M'
        ? new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime()
        : new Date(a.getFullYear() + 1, 0, 1).getTime();
    return { pts, total, changePct, periodLabel, isCurrent, from, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, trendMetric, trendRange, trendAnchor]);

  // v5.40: the back chevron stops at the earliest transaction's period -
  // no time-traveling into empty years the dropdown doesn't even list.
  const earliestTs = useMemo(
    () => (transactions.length
      ? transactions.reduce((a2, x) => Math.min(a2, x.timestamp), Number.MAX_SAFE_INTEGER)
      : Date.now()),
    [transactions],
  );
  const canGoBack = useMemo(() => {
    const a = new Date(trendAnchor);
    const e = new Date(earliestTs);
    if (trendRange === 'W') return weekStartOf(trendAnchor).getTime() > weekStartOf(earliestTs).getTime();
    if (trendRange === 'M') {
      return a.getFullYear() > e.getFullYear()
        || (a.getFullYear() === e.getFullYear() && a.getMonth() > e.getMonth());
    }
    return a.getFullYear() > e.getFullYear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendAnchor, trendRange, earliestTs]);

  const shiftPeriod = (dir: -1 | 1) => {
    setTrendScrub(null);
    setPeriodMenu(false);
    const a = new Date(trendAnchor);
    if (trendRange === 'W') setTrendAnchor(trendAnchor + dir * 7 * 86_400_000);
    else if (trendRange === 'M') setTrendAnchor(new Date(a.getFullYear(), a.getMonth() + dir, 15).getTime());
    else setTrendAnchor(new Date(a.getFullYear() + dir, 6, 1).getTime());
  };
  const pickRange = (r: 'W' | 'M' | 'Y') => {
    setTrendRange(r); setTrendAnchor(Date.now()); setTrendScrub(null); setPeriodMenu(false);
  };
  // Dropdown options: every month (or year) from the earliest transaction to
  // now, newest first, so "view a specific month/year" is one tap.
  const periodOptions = useMemo(() => {
    const now = new Date();
    const earliest = transactions.length
      ? transactions.reduce((a2, x) => Math.min(a2, x.timestamp), Number.MAX_SAFE_INTEGER)
      : Date.now();
    const e = new Date(earliest);
    const out: { label: string; ts: number }[] = [];
    if (trendRange === 'M') {
      const cur = new Date(now.getFullYear(), now.getMonth(), 1);
      const stop = new Date(e.getFullYear(), e.getMonth(), 1);
      const d = new Date(cur);
      while (d.getTime() >= stop.getTime() && out.length < 36) {
        out.push({
          label: `${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`,
          ts: new Date(d.getFullYear(), d.getMonth(), 15).getTime(),
        });
        d.setMonth(d.getMonth() - 1);
      }
    } else if (trendRange === 'Y') {
      for (let y = now.getFullYear(); y >= e.getFullYear() && out.length < 12; y--) {
        out.push({ label: String(y), ts: new Date(y, 6, 1).getTime() });
      }
    }
    return out;
  }, [transactions, trendRange]);
  // v5.41 (owner's #3): Cents reads the visible period and says what it
  // sees - same quiet deterministic voice as the Home and Wallet strips.
  const trendNote = useMemo(() => {
    const pts = trend.pts;
    if (!pts.length || pts.every((x) => x.value === 0 && x.ghost === 0)) return null;
    const unit = trendRange === 'W' ? 'week' : trendRange === 'M' ? 'month' : 'year';
    const where = trend.isCurrent ? `this ${unit}` : trendRange === 'Y' ? `in ${trend.periodLabel}` : `that ${unit}`;
    const p = trend.changePct;
    // v5.42: the comparison clause knows whether you're in the red - "40%
    // ahead, keep the pace" while negative read like a bad joke.
    const pctBit = (inRed: boolean) => {
      if (p == null || !Number.isFinite(p)) return '';
      const far = Math.abs(p) > 999;
      const amt = far ? '' : `${Math.abs(p).toFixed(0)}% `;
      if (trendMetric === 'spent') {
        return p >= 0
          ? ` That's ${far ? 'far ' : amt}more than the previous ${unit} - worth a peek at what changed.`
          : ` That's ${amt}less than the previous ${unit}. Nice trim, keep it going.`;
      }
      if (inRed) {
        return p >= 0
          ? ` Still, that's ${far ? 'well ' : amt}better than the previous ${unit} - you're climbing out.`
          : ` And it's ${amt}deeper than the previous ${unit} - a small course-correct now beats a big one later.`;
      }
      return p >= 0
        ? ` That's ${far ? 'well ' : amt}ahead of the previous ${unit}. Keep the pace.`
        : ` That's ${amt}behind the previous ${unit} - a small course-correct now beats a big one later.`;
    };
    if (trendMetric === 'spent') {
      const peak = pts.reduce((a2, b) => (b.value > a2.value ? b : a2), pts[0]);
      const peakBit = peak.value > 0 ? `, ${peak.sub} was the biggest at ${peso(peak.value)}` : '';
      return `You've spent ${peso(trend.total)} ${where}${peakBit}.${pctBit(false)}`;
    }
    if (trend.total < 0) {
      const worst = pts.reduce((a2, b) => (b.value < a2.value ? b : a2), pts[0]);
      const worstBit = worst.value < 0 ? ` ${worst.sub} took the biggest bite (${peso(Math.abs(worst.value))}).` : '';
      return `You're ${peso(Math.abs(trend.total))} in the red ${where}.${worstBit}${pctBit(true)}`;
    }
    const best = pts.reduce((a2, b) => (b.value > a2.value ? b : a2), pts[0]);
    const bestBit = best.value > 0 ? `, ${best.sub} did the heavy lifting (+${peso(best.value)})` : '';
    return `You're ${peso(trend.total)} up ${where}${bestBit}.${pctBit(false)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, trendMetric, trendRange]);

  // v5.43 (owner decision a): the In/Out/Net chips read the SAME period the
  // Trends chart is showing - one tab, one story. Exports keep mirroring the
  // active filter via `totals`, unchanged.
  const periodTotals = useMemo(() => {
    let income = 0, spent = 0;
    for (const x of transactions) {
      if (x.timestamp < trend.from || x.timestamp >= trend.to) continue;
      if (x.isIncome) income += x.amount; else spent += x.amount;
    }
    return { income, spent, net: income - spent };
  }, [transactions, trend.from, trend.to]);

  const scrubbed = trendScrub != null && trendScrub < trend.pts.length ? trend.pts[trendScrub] : null;
  const hasNetData = transactions.length > 0;

  // v5.44 (owner call): long ledgers PAGE - the ‹ 1 2 3 4 5 › pager from
  // M5.27 stays, now over the redesigned timeline.
  const PAGE_SIZE = 15;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageSlice = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filtered, safePage],
  );
  useEffect(() => { setPage(0); }, [filter, query, catFilter, acctFilter]);
  // v5.45 (owner): the pager scales with the list - first and last page
  // always visible, a window around the current one, ellipsis for the gaps:
  // 1 … 6 7 8 … 23. Seven or fewer pages just show them all.
  const pageItems = useMemo<(number | 'gap')[]>(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    const items: (number | 'gap')[] = [0];
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages - 2, safePage + 1);
    if (start > 1) items.push('gap');
    for (let i = start; i <= end; i++) items.push(i);
    if (end < totalPages - 2) items.push('gap');
    items.push(totalPages - 1);
    return items;
  }, [safePage, totalPages]);

  // Group the visible page by day for the list.
  // v5.43: the timeline - day groups carrying their net, with month
  // dividers (label + that month's spend from the FULL filtered set) when
  // scrolling crosses into an older month.
  const timeline = useMemo(() => {
    const monthSpent = new Map<string, number>();
    for (const tx of filtered) {
      if (tx.isIncome) continue;
      const d = new Date(tx.timestamp);
      const mk = `${d.getFullYear()}-${d.getMonth()}`;
      monthSpent.set(mk, (monthSpent.get(mk) ?? 0) + tx.amount);
    }
    type Item =
      | { type: 'month'; key: string; label: string; spent: number }
      | { type: 'day'; key: string; label: string; net: number; txs: Transaction[] };
    const items: Item[] = [];
    let curMonth: string | null = null;
    let firstMonth: string | null = null;
    let curDay: string | null = null;
    for (const tx of pageSlice) {
      const d = new Date(tx.timestamp);
      const mk = `${d.getFullYear()}-${d.getMonth()}`;
      if (firstMonth === null) firstMonth = mk;
      if (mk !== curMonth) {
        curMonth = mk;
        curDay = null;
        if (mk !== firstMonth) {
          items.push({
            type: 'month', key: `m-${mk}`,
            label: `${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`,
            spent: monthSpent.get(mk) ?? 0,
          });
        }
      }
      const dk = dayLabel(tx.timestamp);
      if (dk !== curDay) {
        curDay = dk;
        items.push({ type: 'day', key: `d-${mk}-${dk}`, label: dk, net: 0, txs: [] });
      }
      const day = items[items.length - 1] as Extract<Item, { type: 'day' }>;
      day.txs.push(tx);
      day.net += tx.isIncome ? tx.amount : -tx.amount;
    }
    return items;
  }, [pageSlice, filtered]);

  // ---- Export ----
  // Files are named SAVECENTS-{REPORT|INCOME|EXPENSES}-DD-MM-YYYY.{ext}
  // (mirrors the active filter; no more random cache-timestamp names).
  const exportFileName = (ext: 'csv' | 'pdf') => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const scope = filter === 'income' ? 'INCOME' : filter === 'expense' ? 'EXPENSES' : 'REPORT';
    return `SAVECENTS-${scope}-${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}.${ext}`;
  };
  const preparedFor = profile.name || profile.nickname || 'SaveCents user';

  const exportCSV = async () => {
    try {
      setExporting('csv');
      const meta = [
        'SaveCents Report',
        `Prepared for,${csvCell(preparedFor)}`,
        `Generated,${new Date().toLocaleString()}`,
        `Scope,${filter === 'all' ? 'All transactions' : filter === 'income' ? 'Income only' : 'Expenses only'}${query ? ` (search: ${csvCell(query)})` : ''}`,
        '',
      ];
      const header = 'Date,Description,Category,Type,Amount';
      const rows = filtered.map((tx) =>
        [
          new Date(tx.timestamp).toISOString().slice(0, 10),
          csvCell(tx.description),
          csvCell(tx.categoryId),
          tx.isIncome ? 'Income' : 'Expense',
          tx.amount.toFixed(2),
        ].join(','),
      );
      const csv = [...meta, header, ...rows].join('\n');
      const uri = `${FileSystem.cacheDirectory}${exportFileName('csv')}`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export transactions (CSV)' });
      } else {
        Alert.alert('Saved', `CSV written to:\n${uri}`);
      }
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Could not create the CSV.');
    } finally {
      setExporting(null);
    }
  };

  const exportPDF = async () => {
    try {
      setExporting('pdf');
      const { uri } = await Print.printToFileAsync({
        html: buildPdfHtml(filtered, totals, currency, preparedFor, filter, query),
      });
      // expo-print writes to a random UUID path — move it to a proper name
      // so the shared/saved file reads SAVECENTS-…-DD-MM-YYYY.pdf.
      const dest = `${FileSystem.cacheDirectory}${exportFileName('pdf')}`;
      await FileSystem.deleteAsync(dest, { idempotent: true });
      await FileSystem.moveAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Export transactions (PDF)' });
      } else {
        Alert.alert('Saved', `PDF written to:\n${dest}`);
      }
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Could not create the PDF.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Transactions</Text>
            <Text style={styles.subtitle}>See where your money really goes</Text>
          </View>
          <Pressable style={styles.titleBadge} onPress={() => setExportMenu(true)} accessibilityLabel="Export">
            <Ionicons name="download-outline" size={21} color={t.emerald} />
          </Pressable>
        </View>
        {/* v5.44 (chunk 3): export lives in the header now */}
        <Modal visible={exportMenu} transparent animationType="fade" onRequestClose={() => setExportMenu(false)}>
          <Pressable style={styles.trendMenuScrim} onPress={() => setExportMenu(false)}>
            <Pressable style={styles.trendMenuPop} onPress={() => {}}>
              <Text style={styles.trendMenuTitle}>Export</Text>
              <Pressable
                style={[styles.trendMenuItem, styles.trendMenuDivider]}
                disabled={exporting !== null}
                onPress={() => { setExportMenu(false); exportCSV(); }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="grid-outline" size={16} color={t.emerald} />
                  <Text style={styles.trendMenuText}>{exporting === 'csv' ? 'Preparing…' : 'CSV spreadsheet'}</Text>
                </View>
              </Pressable>
              <Pressable
                style={styles.trendMenuItem}
                disabled={exporting !== null}
                onPress={() => { setExportMenu(false); exportPDF(); }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="document-text" size={16} color={t.emerald} />
                  <Text style={styles.trendMenuText}>{exporting === 'pdf' ? 'Preparing…' : 'PDF report'}</Text>
                </View>
              </Pressable>
              <Text style={styles.exportMenuHint}>
                Follows your current search and filters ({filtered.length} transaction{filtered.length === 1 ? '' : 's'}).
              </Text>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Summary strip */}
        <View style={styles.statRow}>
          <StatPill styles={styles} t={t} icon="arrow-down-circle" label="In" value={peso(periodTotals.income)} color={t.emerald} />
          <StatPill styles={styles} t={t} icon="arrow-up-circle" label="Out" value={peso(periodTotals.spent)} color={t.red} />
          <StatPill styles={styles} t={t} icon="leaf" label="Net" value={peso(periodTotals.net)} color={periodTotals.net >= 0 ? t.emerald : t.red} />
        </View>

        {/* Charts */}
        {hasNetData && (
          <>
            {/* v5.43: Cents reads the graph - ABOVE the card, standalone,
                exactly like the Home strip sits above its content. */}
            {!!trendNote && (
              <View style={styles.trendCentsBlock}>
                <View style={styles.trendCentsHead}>
                  <Image source={require('../../assets/cents-mark.png')} style={{ width: 13, height: 13 }} resizeMode="contain" />
                  <Text style={styles.trendCentsEyebrow}>CENTS</Text>
                </View>
                <Text style={styles.trendCentsMsg}>{trendNote}</Text>
              </View>
            )}
          <GlassCard style={{ marginBottom: 14 }}>
            {/* v5.40: rebuilt metric switcher - sized to its labels, nothing
                clips or overlaps. */}
            <View style={styles.trendTopRow}>
              <Text style={styles.trendEyebrow}>TRENDS</Text>
              <View style={styles.trendSwitch}>
                {([['net', 'Net saved'], ['spent', 'Spent']] as const).map(([k, lbl]) => (
                  <Pressable
                    key={k}
                    style={[styles.trendSwitchBtn, trendMetric === k && styles.trendSwitchBtnActive]}
                    onPress={() => { setTrendMetric(k); setTrendScrub(null); }}
                  >
                    <Text style={[styles.trendSwitchText, trendMetric === k && { color: t.onEmerald }]} numberOfLines={1}>
                      {lbl}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {/* Hero: period total + change chip; swaps to the pinned day
                while a scrub selection is live. */}
            <View style={styles.trendHero}>
              {scrubbed ? (
                <>
                  <Text style={[styles.trendAmount, scrubbed.value < 0 && { color: t.red }]}>
                    {scrubbed.value < 0 ? `-${peso(Math.abs(scrubbed.value))}` : peso(scrubbed.value)}
                  </Text>
                  <View style={styles.trendChipNeutral}>
                    <Text style={styles.trendChipNeutralText}>{scrubbed.sub}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.trendAmount, trend.total < 0 && { color: t.red }]}>
                    {trend.total < 0 ? `-${peso(Math.abs(trend.total))}` : peso(trend.total)}
                  </Text>
                  {trend.changePct != null && Number.isFinite(trend.changePct) && (() => {
                    // v5.41 (owner's #2): direction is not virtue. Spending
                    // going UP is bad news and reads red; on Net saved, up
                    // is genuinely good. Silly percents cap at >999%.
                    const up = trend.changePct >= 0;
                    const good = trendMetric === 'net' ? up : !up;
                    const pctText = Math.abs(trend.changePct) > 999
                      ? `${up ? '+' : '-'}999%+`
                      : `${up ? '+' : ''}${trend.changePct.toFixed(1)}%`;
                    return (
                      <View style={[styles.trendChip, { backgroundColor: good ? t.emeraldTint : t.redTint }]}>
                        <Ionicons name={up ? 'trending-up' : 'trending-down'} size={12} color={good ? t.emerald : t.red} />
                        <Text style={[styles.trendChipText, { color: good ? t.emerald : t.red }]}>{pctText}</Text>
                      </View>
                    );
                  })()}
                </>
              )}
            </View>
            {/* Period stepper: ‹ label › — the label opens the month/year
                picker on those ranges. */}
            <View style={styles.trendNavRow}>
              <Pressable
                style={[styles.trendNavBtn, !canGoBack && { opacity: 0.3 }]}
                onPress={() => shiftPeriod(-1)}
                disabled={!canGoBack}
                hitSlop={6}
              >
                <Ionicons name="chevron-back" size={16} color={t.emerald} />
              </Pressable>
              <Pressable
                style={[styles.trendPeriodLabelWrap, periodMenu && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}
                disabled={trendRange === 'W'}
                onPress={() => setPeriodMenu((v) => !v)}
              >
                <Text style={styles.trendPeriodLabel}>{trend.periodLabel}</Text>
                {trendRange !== 'W' && (
                  <Ionicons name={periodMenu ? 'chevron-up' : 'chevron-down'} size={13} color={t.emerald} />
                )}
              </Pressable>
              <Pressable
                style={[styles.trendNavBtn, trend.isCurrent && { opacity: 0.3 }]}
                onPress={() => shiftPeriod(1)}
                disabled={trend.isCurrent}
                hitSlop={6}
              >
                <Ionicons name="chevron-forward" size={16} color={t.emerald} />
              </Pressable>
            </View>
            {/* v5.40: the picker FLOATS - tap-outside closes, the chart
                never moves underneath it. */}
            <Modal visible={periodMenu} transparent animationType="fade" onRequestClose={() => setPeriodMenu(false)}>
              <Pressable style={styles.trendMenuScrim} onPress={() => setPeriodMenu(false)}>
                <Pressable style={styles.trendMenuPop} onPress={() => {}}>
                  <Text style={styles.trendMenuTitle}>
                    {trendRange === 'M' ? 'Jump to a month' : 'Jump to a year'}
                  </Text>
                  <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator>
                    {periodOptions.map((o, i) => (
                      <Pressable
                        key={o.ts}
                        style={[styles.trendMenuItem, i < periodOptions.length - 1 && styles.trendMenuDivider]}
                        onPress={() => { setTrendAnchor(o.ts); setTrendScrub(null); setPeriodMenu(false); }}
                      >
                        <Text style={styles.trendMenuText}>{o.label}</Text>
                        {trend.periodLabel === o.label && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
                      </Pressable>
                    ))}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
            <TrendChart
              points={trend.pts}
              ghost={trend.pts.map((x) => x.ghost)}
              height={150}
              color={trendMetric === 'spent' ? t.red : t.emerald}
              onScrub={setTrendScrub}
              pointGap={trendRange === 'M' ? 48 : trendRange === 'Y' ? 58 : undefined}
              resetKey={`${trendMetric}-${trendRange}-${trend.periodLabel}`}
            />
            {/* Range pills, bottom center like the reference */}
            <View style={styles.trendRangeRow}>
              {([['W', 'Weekly'], ['M', 'Monthly'], ['Y', 'Yearly']] as const).map(([k, lbl]) => (
                <Pressable
                  key={k}
                  style={[styles.trendRangeBtn, trendRange === k && styles.trendRangeBtnActive]}
                  onPress={() => pickRange(k)}
                >
                  <Text style={[styles.trendRangeText, trendRange === k && { color: t.onEmerald }]}>{lbl}</Text>
                </Pressable>
              ))}
            </View>
          </GlassCard>
          </>
        )}
        {categories.length > 0 && (() => {
          // v5.44 (owner decision b): the card respects the bill/envelope
          // split. A PAID bill is a win (emerald, "Paid" chip) - red is
          // reserved for genuinely over-limit SPENDING envelopes. Tapping a
          // row filters the ledger below to that budget.
          const bills = categories
            .filter((c) => !!c.dueDate || !!c.creditAccountId)
            .sort((a, b) => b.spent - a.spent);
          const envs = categories
            .filter((c) => !c.dueDate && !c.creditAccountId)
            .sort((a, b) => b.spent - a.spent);
          const topEnv = envs[0];
          const CAP = 5;
          const showBills = spendShowAll ? bills : bills.slice(0, CAP);
          const showEnvs = spendShowAll ? envs : envs.slice(0, CAP);
          const hiddenCount = (bills.length - showBills.length) + (envs.length - showEnvs.length);
          const row = (c: Category, kind: 'bill' | 'env') => {
            const pct = c.limit > 0 ? Math.min(c.spent / c.limit, 1) : 0;
            const settled = kind === 'bill' && c.limit > 0 && c.spent >= c.limit;
            const over = kind === 'env' && c.limit > 0 && c.spent >= c.limit;
            const barColor = over ? t.red : t.emerald;
            const active = catFilter === c.name;
            return (
              <Pressable
                key={c.id}
                style={[styles.spendRow, active && { backgroundColor: t.emeraldTint, borderRadius: 12 }]}
                onPress={() => setCatFilter(active ? null : c.name)}
              >
                <View style={styles.spendTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={styles.spendName} numberOfLines={1}>{c.name}</Text>
                    {settled && (
                      <View style={styles.spendPaidChip}>
                        <Text style={styles.spendPaidText}>Paid</Text>
                      </View>
                    )}
                    {kind === 'env' && topEnv && c.id === topEnv.id && topEnv.spent > 0 && (
                      <View style={styles.spendTopChip}>
                        <Ionicons name="flame" size={9} color={t.red} />
                        <Text style={styles.spendTopText}>TOP</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.spendAmt, over && { color: t.red }]}>
                    {peso(c.spent)} / {peso(c.limit)}
                  </Text>
                </View>
                <View style={styles.spendTrack}>
                  <View style={[styles.spendFill, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: barColor }]} />
                </View>
              </Pressable>
            );
          };
          return (
            <GlassCard style={{ marginBottom: 20 }}>
              <CardHeader styles={styles} t={t} icon="flame" title="Spend by budget" sub="This month · tap a row to filter the ledger" />
              {showBills.length > 0 && (
                <>
                  <View style={styles.spendSectionHead}>
                    <Text style={styles.spendSectionLabel}>BILLS</Text>
                    <Text style={styles.spendSectionTotal}>
                      {peso(bills.reduce((a, c) => a + c.spent, 0))} of {peso(bills.reduce((a, c) => a + c.limit, 0))} paid
                    </Text>
                  </View>
                  {showBills.map((c) => row(c, 'bill'))}
                </>
              )}
              {showEnvs.length > 0 && (
                <>
                  <View style={[styles.spendSectionHead, showBills.length > 0 && { marginTop: 10 }]}>
                    <Text style={styles.spendSectionLabel}>SPENDING</Text>
                    <Text style={styles.spendSectionTotal}>
                      {peso(envs.reduce((a, c) => a + c.spent, 0))} of {peso(envs.reduce((a, c) => a + c.limit, 0))} spent
                    </Text>
                  </View>
                  {showEnvs.map((c) => row(c, 'env'))}
                </>
              )}
              {(hiddenCount > 0 || spendShowAll) && (
                <Pressable style={styles.spendMoreBtn} onPress={() => setSpendShowAll((v) => !v)}>
                  <Text style={styles.spendMoreText}>
                    {spendShowAll ? 'Show less' : `Show all · ${hiddenCount} more`}
                  </Text>
                  <Ionicons name={spendShowAll ? 'chevron-up' : 'chevron-down'} size={13} color={t.emerald} />
                </Pressable>
              )}
            </GlassCard>
          );
        })()}

        {/* Search + filters */}
        <Text style={styles.eyebrow}>TRANSACTIONS</Text>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={t.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search description, category, amount…"
            placeholderTextColor={t.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={t.textMuted} />
            </Pressable>
          )}
        </View>
        <Text style={styles.syncNote}>{trend.periodLabel} · synced with the chart</Text>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, active && { color: t.onEmerald }]}>{f.label}</Text>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          <Text style={styles.countText}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</Text>
        </View>
        {/* v5.43: budget + source pickers (floating, house pattern) */}
        <View style={styles.pickerRow}>
          <Pressable
            style={[styles.pickerChip, catFilter != null && styles.pickerChipOn]}
            onPress={() => setCatMenu(true)}
          >
            <Ionicons name="pricetag-outline" size={13} color={catFilter != null ? t.onEmerald : t.emerald} />
            <Text style={[styles.pickerChipText, catFilter != null && { color: t.onEmerald }]} numberOfLines={1}>
              {catFilter ?? 'All budgets'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={catFilter != null ? t.onEmerald : t.emerald} />
          </Pressable>
          <Pressable
            style={[styles.pickerChip, acctFilter != null && styles.pickerChipOn]}
            onPress={() => setAcctMenu(true)}
          >
            <Ionicons name="wallet-outline" size={13} color={acctFilter != null ? t.onEmerald : t.emerald} />
            <Text style={[styles.pickerChipText, acctFilter != null && { color: t.onEmerald }]} numberOfLines={1}>
              {acctFilter ? (accounts.find((a) => a.id === acctFilter)?.name ?? 'Source') : 'All sources'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={acctFilter != null ? t.onEmerald : t.emerald} />
          </Pressable>
        </View>
        <Modal visible={catMenu} transparent animationType="fade" onRequestClose={() => setCatMenu(false)}>
          <Pressable style={styles.trendMenuScrim} onPress={() => setCatMenu(false)}>
            <Pressable style={styles.trendMenuPop} onPress={() => {}}>
              <Text style={styles.trendMenuTitle}>Filter by budget</Text>
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator>
                <Pressable style={[styles.trendMenuItem, styles.trendMenuDivider]} onPress={() => { setCatFilter(null); setCatMenu(false); }}>
                  <Text style={styles.trendMenuText}>All budgets</Text>
                  {catFilter == null && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
                </Pressable>
                {categories.map((c, i) => (
                  <Pressable
                    key={c.id}
                    style={[styles.trendMenuItem, i < categories.length - 1 && styles.trendMenuDivider]}
                    onPress={() => { setCatFilter(c.name); setCatMenu(false); }}
                  >
                    <Text style={styles.trendMenuText}>{c.name}</Text>
                    {catFilter === c.name && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        <Modal visible={acctMenu} transparent animationType="fade" onRequestClose={() => setAcctMenu(false)}>
          <Pressable style={styles.trendMenuScrim} onPress={() => setAcctMenu(false)}>
            <Pressable style={styles.trendMenuPop} onPress={() => {}}>
              <Text style={styles.trendMenuTitle}>Filter by source</Text>
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator>
                <Pressable style={[styles.trendMenuItem, styles.trendMenuDivider]} onPress={() => { setAcctFilter(null); setAcctMenu(false); }}>
                  <Text style={styles.trendMenuText}>All sources</Text>
                  {acctFilter == null && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
                </Pressable>
                {accounts.map((a, i) => (
                  <Pressable
                    key={a.id}
                    style={[styles.trendMenuItem, i < accounts.length - 1 && styles.trendMenuDivider]}
                    onPress={() => { setAcctFilter(a.id); setAcctMenu(false); }}
                  >
                    <Text style={styles.trendMenuText}>{a.nickname ? `${a.name} ${a.nickname}` : a.name}</Text>
                    {acctFilter === a.id && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* v5.43: the timeline - month dividers, day nets, upgraded rows */}
        {timeline.length === 0 ? (
          <GlassCard style={{ marginBottom: 20 }}>
            <View style={styles.empty}>
              <View style={styles.emptyBadge}>
                <Ionicons name="search" size={26} color={t.emerald} />
              </View>
              <Text style={styles.emptyTitle}>Nothing here</Text>
              <Text style={styles.emptyText}>
                {query || catFilter || acctFilter ? 'Nothing matches these filters.' : 'Log an expense with Cents and it will show up here.'}
              </Text>
            </View>
          </GlassCard>
        ) : (
          timeline.map((item) => item.type === 'month' ? (
            <View key={item.key} style={styles.monthHead}>
              <Text style={styles.monthLabel}>{item.label}</Text>
              <Text style={styles.monthTotal}>spent {peso(item.spent)}</Text>
            </View>
          ) : (
            <View key={item.key} style={{ marginBottom: 14 }}>
              <View style={styles.dayHead}>
                <Text style={styles.dayLabel}>{item.label}</Text>
                <Text style={[styles.dayNet, { color: item.net >= 0 ? t.emerald : t.textMuted }]}>
                  {item.net >= 0 ? '+' : '-'}{peso(Math.abs(item.net))}
                </Text>
              </View>
              <GlassCard pad={8}>
                {item.txs.map((tx, i, arr) => {
                  const cat = categories.find((c) => c.name.toLowerCase() === tx.categoryId.toLowerCase());
                  const isBillPay = !tx.isIncome && !!cat?.creditAccountId;
                  const icon = tx.isIncome ? 'trending-up' : tx.goalId ? 'flag' : ((cat?.icon as any) || 'pricetag');
                  return (
                    <Pressable
                      key={tx.id}
                      onPress={() => setEditing(tx)}
                      style={({ pressed }) => [styles.txRow, i < arr.length - 1 && styles.txDivider, pressed && { backgroundColor: t.inputFill }]}
                    >
                      <View style={[styles.txIcon, (tx.isIncome || tx.goalId) && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                        <Ionicons name={icon} size={16} color={tx.isIncome || tx.goalId ? t.emerald : t.textMuted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txName} numberOfLines={1}>{tx.description}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {isBillPay && <Ionicons name="card" size={11} color={t.emerald} />}
                          <Text style={styles.txCat} numberOfLines={1}>
                            {tx.isIncome ? 'Income' : tx.categoryId}
                            {' · '}
                            {accounts.find((a) => a.id === tx.accountId)?.name ?? 'No source'}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.txAmount, tx.isIncome && { color: t.emerald }]}>
                          {tx.isIncome ? '+' : '-'}{peso(tx.amount)}
                        </Text>
                        <Text style={styles.txTime}>
                          {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </GlassCard>
            </View>
          ))
        )}

        {totalPages > 1 && (
          <View style={styles.pagerRow}>
            <Pressable
              style={[styles.pagerBtn, safePage === 0 && { opacity: 0.35 }]}
              onPress={() => safePage > 0 && setPage(safePage - 1)}
            >
              <Ionicons name="chevron-back" size={15} color={t.textMuted} />
            </Pressable>
            {pageItems.map((n, idx) => n === 'gap' ? (
              <Text key={`gap-${idx}`} style={styles.pagerGap}>…</Text>
            ) : (
              <Pressable
                key={n}
                style={[styles.pagerBtn, n === safePage && styles.pagerBtnOn]}
                onPress={() => setPage(n)}
              >
                <Text style={[styles.pagerText, n === safePage && styles.pagerTextOn]}>{n + 1}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.pagerBtn, safePage === totalPages - 1 && { opacity: 0.35 }]}
              onPress={() => safePage < totalPages - 1 && setPage(safePage + 1)}
            >
              <Ionicons name="chevron-forward" size={15} color={t.textMuted} />
            </Pressable>
          </View>
        )}

        {/* Export */}
        <View style={{ height: 140 }} />
      </ScrollView>

      {editing && (
        <TxEditor
          t={t}
          onCreateBudget={(name, limit, icon, base) => addBudget(name, limit, icon, base)}
          styles={styles}
          tx={editing}
          categories={categories}
          accounts={accounts}
          onSave={(patch) => { updateTransaction(editing.id, patch); setEditing(null); }}
          onDelete={() => { removeTransaction(editing.id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  );
}

function StatPill({ styles, t, icon, label, value, color }: any) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={15} color={color} />
      {/* flex:1 + minWidth:0 lets the column actually shrink inside the pill;
          adjustsFontSizeToFit steps the amount down instead of overflowing. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text
          style={[styles.statValue, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function CardHeader({ styles, t, icon, title, sub }: any) {
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderIcon}>
        <Ionicons name={icon} size={16} color={t.emerald} />
      </View>
      <View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
    </View>
  );
}

function dayLabel(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  const date = new Date(ts);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function escapeHtml(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPdfHtml(
  txs: Transaction[],
  totals: { income: number; spent: number; net: number },
  currency: string,
  preparedFor: string,
  filter: 'all' | 'income' | 'expense',
  query: string,
) {
  const fmt = (n: number) => currency + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateFmt = (ts: number) =>
    new Date(ts).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

  // Date range covered by this export.
  const stamps = txs.map((x) => x.timestamp);
  const range = stamps.length
    ? `${dateFmt(Math.min(...stamps))} – ${dateFmt(Math.max(...stamps))}`
    : 'No transactions';
  const scope =
    filter === 'all' ? 'All transactions' : filter === 'income' ? 'Income only' : 'Expenses only';

  // Per-category totals (expenses), largest first — the "where did it go" view.
  const byCat = new Map<string, number>();
  for (const tx of txs) {
    if (tx.isIncome) continue;
    byCat.set(tx.categoryId, (byCat.get(tx.categoryId) ?? 0) + tx.amount);
  }
  const catRows = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, amt]) => `<tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${fmt(amt)}</td>
        <td class="num muted">${totals.spent > 0 ? ((amt / totals.spent) * 100).toFixed(1) : '0.0'}%</td>
      </tr>`,
    )
    .join('');

  const rows = txs
    .map(
      (tx) => `<tr>
        <td class="muted">${dateFmt(tx.timestamp)}</td>
        <td>${escapeHtml(tx.description)}</td>
        <td class="muted">${escapeHtml(tx.categoryId)}</td>
        <td class="num ${tx.isIncome ? 'in' : 'out'}">${tx.isIncome ? '+' : '−'}${fmt(tx.amount)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #163023; padding: 34px 38px; font-size: 12px; }
    .brandbar { display: flex; justify-content: space-between; align-items: flex-end;
      border-bottom: 3px solid #0B9E6E; padding-bottom: 14px; margin-bottom: 18px; }
    .wordmark { font-size: 24px; font-weight: 800; color: #0B6E4F; letter-spacing: -0.5px; }
    .wordmark span { color: #0B9E6E; }
    .doctype { font-size: 11px; color: #6b8a7a; text-transform: uppercase; letter-spacing: 1.5px; }
    .meta { display: flex; gap: 34px; margin-bottom: 20px; }
    .meta div { font-size: 11px; color: #6b8a7a; }
    .meta b { display: block; font-size: 13px; color: #163023; margin-top: 2px; font-weight: 700; }
    .totals { display: flex; gap: 12px; margin-bottom: 24px; }
    .pill { flex: 1; border: 1px solid #DCE9DF; background: #F4FAF6; border-radius: 12px; padding: 12px 16px; font-size: 11px; color: #6b8a7a; }
    .pill b { display: block; font-size: 17px; margin-top: 3px; color: #163023; }
    .pill.net b { color: ${totals.net >= 0 ? '#0B9E6E' : '#C0392B'}; }
    h2 { font-size: 13px; color: #0B6E4F; text-transform: uppercase; letter-spacing: 1px; margin: 22px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { text-align: left; color: #6b8a7a; font-weight: 700; padding: 8px 8px; border-bottom: 2px solid #DCE9DF; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; }
    td { padding: 8px 8px; border-bottom: 1px solid #EDF3EE; }
    tbody tr:nth-child(even) td { background: #F8FBF9; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .in { color: #0B9E6E; font-weight: 700; } .out { color: #C0392B; font-weight: 700; }
    .muted { color: #6b8a7a; }
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #DCE9DF; color: #9AB3A6; font-size: 10px; display: flex; justify-content: space-between; }
  </style></head><body>
  <div class="brandbar">
    <div class="wordmark">Save<span>Cents</span></div>
    <div class="doctype">Financial report</div>
  </div>
  <div class="meta">
    <div>Prepared for<b>${escapeHtml(preparedFor)}</b></div>
    <div>Period covered<b>${range}</b></div>
    <div>Scope<b>${scope}${query ? ` · search “${escapeHtml(query)}”` : ''}</b></div>
    <div>Generated<b>${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</b></div>
  </div>
  <div class="totals">
    <div class="pill">Money in<b>${fmt(totals.income)}</b></div>
    <div class="pill">Money out<b>${fmt(totals.spent)}</b></div>
    <div class="pill net">Net saved<b>${fmt(totals.net)}</b></div>
  </div>
  ${catRows ? `<h2>Spending by category</h2>
  <table><thead><tr><th>Category</th><th class="num">Spent</th><th class="num">Share</th></tr></thead>
  <tbody>${catRows}</tbody></table>` : ''}
  <h2>Transactions (${txs.length})</h2>
  <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="foot">
    <span>SaveCents · generated for ${escapeHtml(preparedFor)}</span>
    <span>${new Date().toLocaleString()}</span>
  </div>
  </body></html>`;
}

const makeStyles = (t: Palette) => StyleSheet.create({
  editScrim: { flex: 1, backgroundColor: 'rgba(3,12,8,0.45)', justifyContent: 'flex-end' },
  editKav: { justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34,
  },
  editHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, marginBottom: 12 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  editTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 14 },
  editLabel: { color: t.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  editInput: {
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, borderRadius: radius.input,
    paddingHorizontal: 14, height: 47, color: t.textPrimary, fontSize: 15, marginBottom: 12,
  },
  editChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  editChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.chip,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  editChipOn: { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
  editChipText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  editChipTextOn: { color: t.emerald },
  editSaveWrap: { borderRadius: radius.chip, marginTop: 12, },
  editSave: { height: 50, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  editSaveText: { color: t.onEmerald, fontSize: 15, fontWeight: '800' },
  editDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  editDeleteText: { color: t.red, fontSize: 13, fontWeight: '700' },
  safe: { flex: 1 },
  scroll: { padding: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
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
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10,
  },
  statLabel: { color: t.textMuted, fontSize: 10, fontWeight: '700' },
  statValue: { fontSize: 13, fontWeight: '800', ...type.money },
  cardHeader: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 14 },
  cardHeaderIcon: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: '600' },
  cardSub: { color: t.textMuted, fontSize: 12 },
  // D/W/M/Y selector — identical to the dashboard's Savings insight styles.
  insightHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  periodSeg: {
    flexDirection: 'row', gap: 3, padding: 3, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  periodBtn: { width: 28, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  periodBtnActive: { backgroundColor: t.emerald },
  periodText: { color: t.textMuted, fontSize: 11, fontWeight: '800' },
  chartFootnote: { color: t.textFaint, fontSize: 11, marginTop: 10 },
  // v5.39: trend card
  trendTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  trendEyebrow: { ...type.eyebrow, color: t.textFaint },
  trendHero: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  trendAmount: { color: t.textPrimary, fontSize: 30, fontWeight: '800', ...type.money },
  trendChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  trendChipText: { fontSize: 12, fontWeight: '800' },
  trendChipNeutral: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  trendChipNeutralText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },
  trendNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  trendNavBtn: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  trendPeriodLabelWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12,
    borderWidth: 1, borderColor: 'transparent',
  },
  trendPeriodLabel: { color: t.textPrimary, fontSize: 13.5, fontWeight: '800' },
  // v5.41: Cents strip (mirrors the dashboard centsBlock)
  trendCentsBlock: {
    marginBottom: 14, borderRadius: 16, padding: 14,
    backgroundColor: t.mode === 'dark' ? 'rgba(46,158,91,0.10)' : t.sageSoft,
  },
  trendCentsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  trendCentsEyebrow: { ...type.eyebrow, fontSize: 10, color: t.textFaint },
  trendCentsMsg: { color: t.textMuted, fontSize: 12.5, lineHeight: 18 },
  // v5.40: metric switcher sized to its labels
  trendSwitch: {
    flexDirection: 'row', gap: 4, padding: 3, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  trendSwitchBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999 },
  trendSwitchBtnActive: { backgroundColor: t.emerald },
  trendSwitchText: { color: t.textMuted, fontSize: 12.5, fontWeight: '800' },
  // v5.40: floating month/year picker
  trendMenuScrim: {
    flex: 1, backgroundColor: 'rgba(10,14,12,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  trendMenuPop: {
    alignSelf: 'stretch', maxWidth: 420, borderRadius: 20,
    backgroundColor: t.menuBg, borderWidth: 1, borderColor: t.border,
    paddingVertical: 6, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  trendMenuTitle: {
    ...type.eyebrow, color: t.textFaint,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6,
  },
  trendMenuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  trendMenuDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  trendMenuText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700' },
  trendRangeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  trendRangeBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  trendRangeBtnActive: { backgroundColor: t.emerald, borderColor: t.emerald },
  trendRangeText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    height: 48, borderRadius: 16, paddingHorizontal: 14,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: t.textPrimary, fontSize: 14 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  filterChip: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  filterChipActive: { backgroundColor: t.emerald, borderColor: t.emerald },
  filterText: { color: t.textMuted, fontSize: 12, fontWeight: '800' },
  countText: { color: t.textFaint, fontSize: 11 },
  dayLabel: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  txDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  txIcon: {
    width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  // M5.27 pager
  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2, marginBottom: 22 },
  pagerBtn: {
    minWidth: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, paddingHorizontal: 8,
  },
  pagerBtnOn: { backgroundColor: t.emerald, borderColor: t.emerald },
  pagerText: { color: t.textMuted, fontSize: 13.5, fontWeight: '700' },
  pagerGap: { color: t.textFaint, fontSize: 13.5, fontWeight: '700', paddingHorizontal: 2 },
  pagerTextOn: { color: t.onEmerald },

  // M5.26 receipt sheet
  rcptKicker: { color: t.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 2, textAlign: 'center', marginBottom: 6 },
  rcptName: { color: t.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center', paddingVertical: 4 },
  rcptAmountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2, marginBottom: 16 },
  rcptAmountSign: { fontSize: 24, fontWeight: '800', ...type.money },
  rcptAmount: { color: t.textPrimary, fontSize: 36, fontWeight: '800', minWidth: 80, textAlign: 'center', ...type.money },
  rcptCard: { backgroundColor: t.inputFill, borderRadius: 16, borderWidth: 1, borderColor: t.border, paddingHorizontal: 16, marginBottom: 16 },
  rcptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  rcptRowLabel: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  rcptRowValue: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700' },
  rcptRowDivider: { height: 1, backgroundColor: t.border },

  txName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  txCat: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  txAmount: { color: t.textPrimary, fontSize: 15.5, fontWeight: '800', ...type.money },
  // v5.43: timeline
  txTime: { color: t.textFaint, fontSize: 10.5, marginTop: 2 },
  syncNote: { color: t.textFaint, fontSize: 11, textAlign: 'right', marginTop: -6, marginBottom: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 2 },
  dayNet: { fontSize: 12, fontWeight: '800', ...type.money },
  monthHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 6, marginBottom: 12, paddingTop: 12, paddingHorizontal: 2,
    borderTopWidth: 1, borderTopColor: t.borderSoft,
  },
  monthLabel: { ...type.eyebrow, color: t.textFaint },
  monthTotal: { color: t.textMuted, fontSize: 11.5, fontWeight: '700', ...type.money },
  pickerRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  pickerChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  pickerChipOn: { backgroundColor: t.emerald, borderColor: t.emerald },
  pickerChipText: { color: t.emerald, fontSize: 12, fontWeight: '800', maxWidth: 120 },
  showMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, marginBottom: 20,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  showMoreText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  empty: { alignItems: 'center', padding: 18, gap: 10 },
  emptyTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptyText: { color: t.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  exportRow: { flexDirection: 'row', gap: 12 },
  exportMenuHint: { color: t.textFaint, fontSize: 11, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  // v5.45: TxEditor budget dropdown
  txbSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  txbSelectText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  txbIcon: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  txbMenu: {
    marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
  },
  txbSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: t.borderSoft,
  },
  txbSearchInput: { flex: 1, height: 38, color: t.textPrimary, fontSize: 13 },
  txbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  txbDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  txbRowText: { color: t.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
  txbEmpty: { color: t.textMuted, fontSize: 12, padding: 12 },
  txbCreateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: t.borderSoft, backgroundColor: t.emeraldTint,
  },
  txbCreateIcon: {
    width: 22, height: 22, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.emeraldBorder,
  },
  txbCreateText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  txbCreateTitle: { ...type.eyebrow, fontSize: 10, color: t.textFaint },
  txbCreateInput: {
    height: 42, borderRadius: 12, paddingHorizontal: 12, color: t.textPrimary, fontSize: 13,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  txbBaseChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 999, backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  txbBaseText: { color: t.emerald, fontSize: 11.5, fontWeight: '700' },
  txbCancel: {
    paddingHorizontal: 14, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  txbCancelText: { color: t.textMuted, fontSize: 12.5, fontWeight: '700' },
  txbGo: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txbGoText: { color: t.onEmerald, fontSize: 12.5, fontWeight: '800' },
  // v5.44: spend by budget sections
  spendSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 2 },
  spendSectionLabel: { ...type.eyebrow, fontSize: 10, color: t.textFaint },
  spendSectionTotal: { color: t.textMuted, fontSize: 11, fontWeight: '700', ...type.money },
  spendRow: { paddingVertical: 8, paddingHorizontal: 4 },
  spendTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 },
  spendName: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  spendAmt: { color: t.textMuted, fontSize: 12, fontWeight: '700', ...type.money },
  spendTrack: { height: 7, borderRadius: 4, backgroundColor: t.trackBg, overflow: 'hidden' },
  spendFill: { height: '100%', borderRadius: 4 },
  spendPaidChip: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  spendPaidText: { color: t.emerald, fontSize: 9.5, fontWeight: '800' },
  spendTopChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: t.redTint,
  },
  spendTopText: { color: t.red, fontSize: 9.5, fontWeight: '800' },
  spendMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 10 },
  spendMoreText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  exportBtn: {
    height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  exportBtnSolid: {
    height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  exportText: { color: t.emerald, fontSize: 14, fontWeight: '800' },
  exportHint: { color: t.textFaint, fontSize: 11, textAlign: 'center', marginTop: 10 },
});