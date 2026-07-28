// M5: Analytics tab — data visualization, transaction search, and CSV/PDF export.
// Charts here are computed from REAL transactions (first slice of the M5
// "truth & polish" work — no mocked series on this screen).
import React, { useMemo, useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { GlassCard } from '../../src/components/GlassCard';
import { MoMBars, SpendBars } from '../../src/components/Charts';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { Transaction, peso } from '../../src/models/types';

type Filter = 'all' | 'income' | 'expense';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expenses' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AnalyticsScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { transactions, categories, currency } = useFinance();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [exporting, setExporting] = useState<null | 'csv' | 'pdf'>(null);

  // ---- Search + filter ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filter === 'income' && !tx.isIncome) return false;
      if (filter === 'expense' && tx.isIncome) return false;
      if (!q) return true;
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.categoryId.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
      );
    });
  }, [transactions, query, filter]);

  // ---- Real computed insights ----
  const totals = useMemo(() => {
    const income = filtered.filter((x) => x.isIncome).reduce((a, x) => a + x.amount, 0);
    const spent = filtered.filter((x) => !x.isIncome).reduce((a, x) => a + x.amount, 0);
    return { income, spent, net: income - spent };
  }, [filtered]);

  // Net savings per month over the last 5 months, from real transactions.
  const monthlySeries = useMemo(() => {
    const nowD = new Date();
    const out: { label: string; value: number }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
      const next = new Date(nowD.getFullYear(), nowD.getMonth() - i + 1, 1);
      const inMonth = transactions.filter((x) => x.timestamp >= d.getTime() && x.timestamp < next.getTime());
      const net = inMonth.reduce((a, x) => a + (x.isIncome ? x.amount : -x.amount), 0);
      out.push({ label: MONTHS[d.getMonth()], value: Math.max(net, 0) });
    }
    return out;
  }, [transactions]);
  const hasMonthlyData = monthlySeries.some((m) => m.value > 0);

  // Group visible transactions by day for the list.
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of filtered) {
      const key = dayLabel(tx.timestamp);
      const arr = map.get(key) ?? [];
      arr.push(tx);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // ---- Export ----
  const exportCSV = async () => {
    try {
      setExporting('csv');
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
      const csv = [header, ...rows].join('\n');
      const uri = `${FileSystem.cacheDirectory}savecents-transactions-${Date.now()}.csv`;
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
      const { uri } = await Print.printToFileAsync({ html: buildPdfHtml(filtered, totals, currency) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Export transactions (PDF)' });
      } else {
        Alert.alert('Saved', `PDF written to:\n${uri}`);
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
            <Text style={styles.title}>Analytics</Text>
            <Text style={styles.subtitle}>See where your money really goes</Text>
          </View>
          <View style={styles.titleBadge}>
            <Ionicons name="stats-chart" size={22} color={t.emerald} />
          </View>
        </View>

        {/* Summary strip */}
        <View style={styles.statRow}>
          <StatPill styles={styles} t={t} icon="arrow-down-circle" label="In" value={peso(totals.income)} color={t.emerald} />
          <StatPill styles={styles} t={t} icon="arrow-up-circle" label="Out" value={peso(totals.spent)} color={t.red} />
          <StatPill styles={styles} t={t} icon="leaf" label="Net" value={peso(totals.net)} color={totals.net >= 0 ? t.emerald : t.red} />
        </View>

        {/* Charts */}
        {hasMonthlyData && (
          <GlassCard style={{ marginBottom: 14 }}>
            <CardHeader styles={styles} t={t} icon="stats-chart" title="Net saved by month" sub="Computed from your real transactions" />
            <MoMBars data={monthlySeries} height={100} />
          </GlassCard>
        )}
        {categories.length > 0 && (
          <GlassCard style={{ marginBottom: 20 }}>
            <CardHeader styles={styles} t={t} icon="flame" title="Spend by budget" sub="This month" />
            <SpendBars data={categories.map((c) => ({ name: c.name, spent: c.spent, limit: c.limit }))} />
          </GlassCard>
        )}

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

        {/* Grouped list */}
        {grouped.length === 0 ? (
          <GlassCard style={{ marginBottom: 20 }}>
            <View style={styles.empty}>
              <View style={styles.emptyBadge}>
                <Ionicons name="search" size={26} color={t.emerald} />
              </View>
              <Text style={styles.emptyTitle}>Nothing here</Text>
              <Text style={styles.emptyText}>
                {query ? `No transactions match "${query}".` : 'Log an expense with Cents and it will show up here.'}
              </Text>
            </View>
          </GlassCard>
        ) : (
          grouped.map(([day, txs]) => (
            <View key={day} style={{ marginBottom: 14 }}>
              <Text style={styles.dayLabel}>{day}</Text>
              <GlassCard pad={8}>
                {txs.map((tx, i, arr) => (
                  <View key={tx.id} style={[styles.txRow, i < arr.length - 1 && styles.txDivider]}>
                    <View style={[styles.txIcon, tx.isIncome && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                      <Ionicons
                        name={tx.isIncome ? 'trending-up' : 'pricetag'}
                        size={16}
                        color={tx.isIncome ? t.emerald : t.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txName}>{tx.description}</Text>
                      <Text style={styles.txCat}>{tx.categoryId}</Text>
                    </View>
                    <Text style={[styles.txAmount, tx.isIncome && { color: t.emerald }]}>
                      {tx.isIncome ? '+' : '-'}{peso(tx.amount)}
                    </Text>
                  </View>
                ))}
              </GlassCard>
            </View>
          ))
        )}

        {/* Export */}
        <Text style={styles.eyebrow}>EXPORT</Text>
        <View style={styles.exportRow}>
          <Pressable style={{ flex: 1 }} onPress={exportCSV} disabled={exporting !== null}>
            <View style={[styles.exportBtn, exporting === 'csv' && { opacity: 0.6 }]}>
              <Ionicons name="grid-outline" size={18} color={t.emerald} />
              <Text style={styles.exportText}>{exporting === 'csv' ? 'Preparing…' : 'CSV'}</Text>
            </View>
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={exportPDF} disabled={exporting !== null}>
            <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.exportBtnSolid, exporting === 'pdf' && { opacity: 0.7 }]}>
              <Ionicons name="document-text" size={18} color={t.onEmerald} />
              <Text style={[styles.exportText, { color: t.onEmerald }]}>{exporting === 'pdf' ? 'Preparing…' : 'PDF report'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.exportHint}>Exports follow your current search and filters ({filtered.length} transaction{filtered.length === 1 ? '' : 's'}).</Text>

        <View style={{ height: 140 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatPill({ styles, t, icon, label, value, color }: any) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={15} color={color} />
      <View>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={[styles.statValue, { color }]} numberOfLines={1}>{value}</Text>
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
) {
  const fmt = (n: number) => currency + n.toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const rows = txs
    .map(
      (tx) => `<tr>
        <td>${new Date(tx.timestamp).toLocaleDateString()}</td>
        <td>${escapeHtml(tx.description)}</td>
        <td>${escapeHtml(tx.categoryId)}</td>
        <td class="${tx.isIncome ? 'in' : 'out'}">${tx.isIncome ? '+' : '-'}${fmt(tx.amount)}</td>
      </tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #163023; padding: 28px; }
    h1 { color: #0B6E4F; margin: 0 0 2px; font-size: 22px; }
    .sub { color: #6b8a7a; font-size: 12px; margin-bottom: 18px; }
    .totals { display: flex; gap: 12px; margin-bottom: 18px; }
    .pill { background: #EDF5EF; border-radius: 12px; padding: 10px 16px; font-size: 13px; }
    .pill b { display: block; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; color: #6b8a7a; font-weight: 600; padding: 8px 6px; border-bottom: 2px solid #DCE9DF; }
    td { padding: 8px 6px; border-bottom: 1px solid #EDF3EE; }
    .in { color: #0B9E6E; font-weight: 700; } .out { color: #C0392B; font-weight: 700; }
  </style></head><body>
  <h1>SaveCents Transaction Report</h1>
  <div class="sub">Generated ${new Date().toLocaleString()} · ${txs.length} transactions</div>
  <div class="totals">
    <div class="pill">Income <b>${fmt(totals.income)}</b></div>
    <div class="pill">Spent <b>${fmt(totals.spent)}</b></div>
    <div class="pill">Net <b>${fmt(totals.net)}</b></div>
  </div>
  <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
  <tbody>${rows}</tbody></table>
  </body></html>`;
}

const makeStyles = (t: Palette) => StyleSheet.create({
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
  txName: { color: t.textPrimary, fontSize: 14, fontWeight: '600' },
  txCat: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  txAmount: { color: t.textPrimary, fontSize: 14, fontWeight: '700', ...type.money },
  empty: { alignItems: 'center', padding: 18, gap: 10 },
  emptyTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptyText: { color: t.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  exportRow: { flexDirection: 'row', gap: 12 },
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
