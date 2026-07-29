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
  const { transactions, categories, currency, profile } = useFinance();

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

  // Net savings series, selectable D/W/M/Y like the dashboard's Savings
  // insight — but computed from REAL transactions (this screen's rule).
  const [netPeriod, setNetPeriod] = useState<'D' | 'W' | 'M' | 'Y'>('M');
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const netSeries = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const netBetween = (from: number, to: number) =>
      transactions
        .filter((x) => x.timestamp >= from && x.timestamp < to)
        .reduce((a, x) => a + (x.isIncome ? x.amount : -x.amount), 0);
    const out: { label: string; value: number }[] = [];
    if (netPeriod === 'D') {
      // Last 7 days, oldest → newest.
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        out.push({ label: DAY_NAMES[d.getDay()], value: Math.max(netBetween(startOfDay(d), startOfDay(d) + 86_400_000), 0) });
      }
    } else if (netPeriod === 'W') {
      // Last 5 seven-day windows ending today.
      const todayEnd = startOfDay(now) + 86_400_000;
      for (let i = 4; i >= 0; i--) {
        const to = todayEnd - i * 7 * 86_400_000;
        out.push({ label: `W${5 - i}`, value: Math.max(netBetween(to - 7 * 86_400_000, to), 0) });
      }
    } else if (netPeriod === 'M') {
      for (let i = 4; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        out.push({ label: MONTHS[d.getMonth()], value: Math.max(netBetween(d.getTime(), next.getTime()), 0) });
      }
    } else {
      for (let i = 4; i >= 0; i--) {
        const y = now.getFullYear() - i;
        out.push({ label: String(y), value: Math.max(netBetween(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()), 0) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, netPeriod]);
  const netSub = { D: 'Last 7 days', W: 'Last 5 weeks', M: 'Last 5 months', Y: 'Last 5 years' }[netPeriod];
  const hasNetData = netSeries.some((m) => m.value > 0);

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
        {hasNetData && (
          <GlassCard style={{ marginBottom: 14 }}>
            <View style={styles.insightHead}>
              <CardHeader styles={styles} t={t} icon="stats-chart" title="Net saved" sub={netSub} />
              <View style={styles.periodSeg}>
                {(['D', 'W', 'M', 'Y'] as const).map((p) => (
                  <Pressable
                    key={p}
                    style={[styles.periodBtn, netPeriod === p && styles.periodBtnActive]}
                    onPress={() => setNetPeriod(p)}
                  >
                    <Text style={[styles.periodText, netPeriod === p && { color: t.onEmerald }]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <MoMBars key={netPeriod} data={netSeries} height={100} />
            <Text style={styles.chartFootnote}>Computed from your real transactions</Text>
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