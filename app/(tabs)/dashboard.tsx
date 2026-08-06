// v4.1 "Grounded Editorial" Home. Structure, top to bottom:
//   1. Header + Cents co-pilot: ranked plain-text insights under the name.
//   2. Balance card carousel: matte Total card, then one card per linked
//      source in the institution's EXACT brand color with its issuer mark.
//   3. Today strip (goal moves count as SAVED) + Needs attention (strict
//      priority: urgent due -> maxed -> near-limit -> far due).
//   4. Insights carousel in USER-CHOSEN order (Reorder link): starred-goal
//      trajectory, flat allocation pie, savings trend, top spend.
//   5. Budgets summary and Recent activity with PH merchant brand marks.
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '../../src/components/GlassCard';
import { AvatarBadge } from '../../src/components/Avatar';
import { BankMark, MerchantBadge, NetworkMark } from '../../src/components/BrandBadge';
import { MoMBars, PieChart, SpendBars, TrajectoryCurve } from '../../src/components/Charts';
import { C, Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { peso } from '../../src/models/types';
import { institutionFor } from '../../src/data/countries';
import { savingsSeries, savingsNote as buildSavingsNote } from '../../src/utils/stats';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - 48;
const BANK_CARD_W = SCREEN_W - 48;   // fills the view: no peek of the next card
const BANK_GAP = 24;
const BANK_STEP = BANK_CARD_W + BANK_GAP;

// v4 editorial: eight EARTHY, still-distinct hues (forest, amber, slate,
// clay, moss, ochre, plum, steel) — no neon.
const ACCOUNT_COLORS = ['#2E9E5B', '#D97706', '#64748B', '#B45309', '#5B8A72', '#A16207', '#6D5A7A', '#4C7A8C'];

// Darken a #RRGGBB color for card gradients.
function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Same swipe treatment as the balance cards: the slide in view scales up and
// brightens, neighbors shrink, sink and dim.
function InsightSlide({ index, scrollX, children }: { index: number; scrollX: Animated.Value; children: React.ReactNode }) {
  const STEP = CARD_W + BANK_GAP;
  const inputRange = [(index - 1) * STEP, index * STEP, (index + 1) * STEP];
  // v4: a calm slide — slight scale + fade only. Tilt/lift theatrics retired.
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.96, 1, 0.96], extrapolate: 'clamp' });
  const dim = scrollX.interpolate({ inputRange, outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' });
  return (
    <Animated.View style={{ width: CARD_W, marginRight: BANK_GAP, opacity: dim, transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}


// Rule 3.1: module scope, NOT inside Dashboard's render body. Inline
// definitions re-create the component type per render, so the FlatList
// REMOUNTED every card on each Home re-render, killing in-flight touches and
// scroll gestures (part of the "tap several times" bug).
type BalanceItem = { id: string; kind: 'total' } | { id: string; kind: 'account'; account: any };
function BalanceCard({ item, index, scrollX, styles, country, hideBalance, onToggleHide, totalLiquid, accountCount, holder }: {
  item: BalanceItem; index: number; scrollX: Animated.Value; styles: any;
  country: string; hideBalance: boolean; onToggleHide: () => void;
  totalLiquid: number; accountCount: number; holder: string;
}) {
  const inputRange = [(index - 1) * BANK_STEP, index * BANK_STEP, (index + 1) * BANK_STEP];
  // v4: calm slide — slight scale + fade. Tilt/lift retired.
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.96, 1, 0.96], extrapolate: 'clamp' });
  const dim = scrollX.interpolate({ inputRange, outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' });

  const money = (n: number) => (hideBalance ? '****' : peso(n));
  const isTotal = item.kind === 'total';
  const acct = item.kind === 'account' ? item.account : null;
  const inst = acct ? institutionFor(country, acct.name) : undefined;
  // v4.1: linked-source cards wear the institution's EXACT brand color,
  // deepened just enough (-30%) that white type passes contrast — the way
  // the real GCash/BPI/BDO cards read. Total keeps the house forest.
  const base = isTotal ? '#165B33' : (inst?.color ?? acct?.color ?? ACCOUNT_COLORS[index % ACCOUNT_COLORS.length]);
  // v4.4: same quiet two-stop brand gradient as the Wallet stack.
  const gradient: [string, string] = isTotal
    ? [shade(base, -0.5), shade(base, 0.12)]
    : [shade(base, -0.55), shade(base, 0.02)];
  const isCredit = acct?.kind === 'credit';
  const network = acct?.network ?? inst?.network;
  const kind = isCredit ? 'Credit'
    : inst?.kind === 'wallet' ? 'E-wallet'
    : inst?.kind === 'digital' ? 'Digital bank'
    : inst?.kind === 'fintech' ? 'Fintech'
    : inst?.kind === 'bank' ? 'Bank'
    : inst?.kind === 'cash' ? 'Cash'
    : 'Account';

  return (
    <Animated.View style={{ width: BANK_CARD_W, marginRight: BANK_GAP, opacity: dim, transform: [{ scale }] }}>
      <View style={styles.bankShadow}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.bankCard, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }]}
        >

          <View style={styles.bankTop}>
            <View style={styles.bankIdRow}>
              {!isTotal && <BankMark inst={inst} name={acct!.name} size={34} />}
              <View>
                <Text style={styles.bankLabel}>{isTotal ? 'Total Balance' : acct!.name}</Text>
                {!isTotal && <Text style={styles.bankKindSub}>{kind}</Text>}
              </View>
            </View>
            {isTotal && (
              <Pressable onPress={onToggleHide} hitSlop={10} style={styles.eyeBtn}>
                <Ionicons name={hideBalance ? 'eye-off' : 'eye'} size={15} color="rgba(255,255,255,0.9)" />
              </Pressable>
            )}
          </View>

          <Text style={styles.bankAmount}>{money(isTotal ? totalLiquid : acct!.balance)}</Text>
          {isTotal && (
            <Text style={styles.bankCaption}>Across {accountCount} source{accountCount === 1 ? '' : 's'}</Text>
          )}
          {isCredit && (acct!.creditLimit ?? 0) > 0 && (
            <Text style={styles.bankCaption}>
              owed of {hideBalance ? '****' : peso(acct!.creditLimit!)} limit
            </Text>
          )}

          <View style={styles.bankBottom}>
            <View style={styles.chipWrap}>
              <View style={styles.chip}>
                <View style={styles.chipLine} />
                <View style={[styles.chipLine, { top: 12 }]} />
                <View style={styles.chipLineV} />
              </View>
            </View>
            <Text style={styles.bankHolder}>{holder.toUpperCase()}</Text>
            {!isTotal && network && network !== 'none'
              ? <View style={{ marginLeft: 12 }}><NetworkMark network={network} height={13} /></View>
              : <Text style={styles.bankMask}>****</Text>}
          </View>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}


// Rule 3.1: module scope (see BalanceCard note above).
const CardHeader = ({ styles, t, icon, title, sub }: { styles: any; t: Palette; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) => (
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

const Section = ({ styles, title, link, onLink }: { styles: any; title: string; link?: string; onLink?: () => void }) => (
  <View style={styles.sectionRow}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {link ? (
      <Pressable
        onPress={onLink}
        hitSlop={10}
        style={({ pressed }) => [styles.sectionLinkHit, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.sectionLink}>{link}</Text>
      </Pressable>
    ) : null}
  </View>
);

// Weeks from now until a goal date like "Nov 2026" (>=0; 0 if unparseable).
function weeksUntil(dateLabel: string): number {
  const parsed = Date.parse(dateLabel.length <= 8 ? `1 ${dateLabel}` : dateLabel);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(Math.round((parsed - Date.now()) / (7 * 86_400_000)), 0);
}

function greetingFor() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 18) return 'Good afternoon,';
  return 'Good evening,';
}

function relDate(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

function dueLabel(dueDate: number) {
  const days = Math.ceil((dueDate - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Due tomorrow', urgent: true };
  if (days <= 7) return { text: `Due in ${days} days`, urgent: true };
  return {
    text: `Due ${new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    urgent: false,
  };
}

export default function Dashboard() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { accounts, categories, goals, transactions, profile, selectedGoalId, selectGoal } = useFinance();

  const rolloverBudgetsIfNeeded = useFinance((st) => st.rolloverBudgetsIfNeeded);
  React.useEffect(() => { rolloverBudgetsIfNeeded(); }, [rolloverBudgetsIfNeeded]);

  // v4.1: the goal shown in Insights is the STARRED goal (set with the star
  // in Goals → Manage); falls back to the first goal.
  const goal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) ?? goals[0],
    [goals, selectedGoalId],
  );
  const [reorderOpen, setReorderOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);

  // v4.2: the Cents note pops in like an incoming message — a beat after
  // mount (opacity + rise + settle spring), origin at the avatar corner.
  const centsAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const id = setTimeout(() => {
      Animated.spring(centsAnim, {
        toValue: 1, useNativeDriver: true, friction: 7, tension: 90,
      }).start();
    }, 450);
    return () => clearTimeout(id);
  }, [centsAnim]);
  const toggleHide = React.useCallback(() => setHideBalance((v) => !v), []);

  // v4.3: credit-card balances are money OWED — they never count as liquid
  // and stay out of the allocation pie.
  const liquidAccounts = useMemo(() => accounts.filter((x) => x.kind !== 'credit'), [accounts]);
  const totalLiquid = liquidAccounts.reduce((a, x) => a + x.balance, 0);
  const totalLimit = categories.reduce((a, c) => a + c.limit, 0);
  const totalSpent = categories.reduce((a, c) => a + c.spent, 0);

  // ── Today strip data ──────────────────────────────────────────────────
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  // M5.17 (owner): the old single net number read as nonsense ("Saved today"
  // in red). The card now shows BOTH sides of the day: what went out, and
  // what is left of today's money after spending (never negative).
  const todayTx = transactions.filter((x) => x.timestamp >= startOfDay.getTime());
  // v4.1 accuracy pass: a transaction with goalId is a SAVINGS MOVE — money
  // set aside (or pulled back), never spending. So:
  //   Spent = real outflows only (no goal moves)
  //   Saved = net moved into goals today + whatever income outlasted spending
  const earnedToday = todayTx.reduce((a, x) => a + (x.isIncome && !x.goalId ? x.amount : 0), 0);
  const spentToday = todayTx.reduce((a, x) => a + (!x.isIncome && !x.goalId ? x.amount : 0), 0);
  const goalMovesToday = todayTx.reduce(
    (a, x) => a + (x.goalId ? (x.isIncome ? -x.amount : x.amount) : 0), 0);
  const savedToday = Math.max(goalMovesToday, 0) + Math.max(earnedToday - spentToday, 0);

  // v4.1 accuracy pass — strict priority so the card always surfaces the
  // MOST pressing thing: ① overdue / due-soon bill → ② maxed budget →
  // ③ near-limit budget (≥85%) → ④ a far-off due date, else all clear.
  const attention = useMemo(() => {
    const dues = categories.filter((c) => c.dueDate).sort((a, b) => a.dueDate! - b.dueDate!);
    const urgentDue = dues.find((c) => dueLabel(c.dueDate!).urgent);
    if (urgentDue) {
      const d = dueLabel(urgentDue.dueDate!);
      const remaining = Math.max(urgentDue.limit - urgentDue.spent, 0);
      return { kind: 'due' as const, name: urgentDue.name, line: `${d.text} · ${peso(remaining)} left`, amount: remaining, urgent: true, icon: urgentDue.icon };
    }
    const maxed = categories.find((c) => c.limit > 0 && c.spent >= c.limit);
    if (maxed) {
      const over = maxed.spent - maxed.limit;
      return { kind: 'maxed' as const, name: maxed.name, line: over > 0 ? `Over budget by ${peso(over)}` : 'Budget fully used', amount: 0, urgent: true, icon: maxed.icon };
    }
    const near = categories
      .filter((c) => c.limit > 0 && c.spent / c.limit >= 0.85 && c.spent < c.limit)
      .sort((a, b) => b.spent / b.limit - a.spent / a.limit)[0];
    if (near) return { kind: 'near' as const, name: near.name, line: `${Math.round((near.spent / near.limit) * 100)}% used · ${peso(near.limit - near.spent)} left`, amount: near.limit - near.spent, urgent: false, icon: near.icon };
    if (dues[0]) {
      const d = dueLabel(dues[0].dueDate!);
      return { kind: 'due' as const, name: dues[0].name, line: d.text, amount: Math.max(dues[0].limit - dues[0].spent, 0), urgent: false, icon: dues[0].icon };
    }
    return null;
  }, [categories]);

  // ── Balance card carousel ─────────────────────────────────────────────
  const bankScrollX = useRef(new Animated.Value(0)).current;
  const balanceCards = useMemo(
    () => [{ id: 'total', kind: 'total' as const }, ...accounts.map((a) => ({ id: a.id, kind: 'account' as const, account: a }))],
    [accounts],
  );
  const country = useFinance((s) => s.country);

  const money = (n: number) => (hideBalance ? '****' : peso(n));


  // ── Insights carousel (unchanged data, restyled shell) ────────────────
  const insightScrollX = useRef(new Animated.Value(0)).current;
  const STEP = CARD_W + BANK_GAP; // identical step to the balance carousel
  // v4.1: user-ordered insight cards (Reorder link beside the section title).
  const insightOrder = useFinance((st) => st.insightOrder);
  const setInsightOrder = useFinance((st) => st.setInsightOrder);
  const INSIGHT_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
    goal: { label: 'Goal trajectory', icon: 'flag' },
    alloc: { label: 'Allocation', icon: 'pie-chart' },
    mom: { label: 'Savings trend', icon: 'stats-chart' },
    topspend: { label: 'Top spend', icon: 'flame' },
  };
  const DEFAULT_ORDER = ['goal', 'alloc', 'mom', 'topspend'];
  const order = useMemo(() => {
    const saved = (insightOrder ?? []).filter((k) => DEFAULT_ORDER.includes(k));
    return [...saved, ...DEFAULT_ORDER.filter((k) => !saved.includes(k))];
  }, [insightOrder]);
  const insights = useMemo(() => order.map((key) => ({ key })), [order]);
  const moveInsight = (key: string, dir: -1 | 1) => {
    const i = order.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setInsightOrder(next);
  };
  const [savingsPeriod, setSavingsPeriod] = useState<'D' | 'W' | 'M' | 'Y'>('M');
  // M5.6 truth pass: the chart and its note are computed from real
  // transactions (src/utils/stats.ts), no more sample numbers.
  const savingsData = useMemo(() => savingsSeries(transactions, savingsPeriod), [transactions, savingsPeriod]);
  const savingsSub = { D: 'Last 7 days', W: 'Last 5 weeks', M: 'Last 5 months', Y: 'Last 5 years' }[savingsPeriod];
  const savingsNote = useMemo(() => buildSavingsNote(savingsData, savingsPeriod), [savingsData, savingsPeriod]);

  // v4.1: Cents speaks in ranked, ACTIONABLE observations — a warning first
  // if something needs a decision, then a concrete suggestion. Max two lines
  // so the co-pilot stays quiet.
  const centsNotes = useMemo(() => {
    const notes: { icon: keyof typeof Ionicons.glyphMap; tone: 'warn' | 'ok'; text: string }[] = [];
    const maxed = categories.filter((c) => c.limit > 0 && c.spent >= c.limit);
    if (maxed.length > 0) {
      const worst = maxed.sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit))[0];
      const over = worst.spent - worst.limit;
      notes.push({
        icon: 'alert-circle-outline', tone: 'warn',
        text: over > 0
          ? `Your ${worst.name} budget is ${peso(over)} over its limit. Maybe ease up there, or bump the limit in Goals.`
          : `Your ${worst.name} budget just hit its limit. Anything more spills into next month.`,
      });
    }
    const dueSoon = categories
      .filter((c) => c.dueDate && dueLabel(c.dueDate!).urgent)
      .sort((a, b) => a.dueDate! - b.dueDate!)[0];
    if (dueSoon) {
      const remaining = Math.max(dueSoon.limit - dueSoon.spent, 0);
      notes.push({
        icon: 'calendar-outline', tone: 'warn',
        text: `Your ${dueSoon.name} bill is ${dueLabel(dueSoon.dueDate!).text.toLowerCase()}. Keep ${peso(remaining)} ready for it.`,
      });
    }
    if (goal && goal.target > goal.current) {
      const weeks = Math.max(weeksUntil(goal.date), 1);
      const perWeek = Math.ceil((goal.target - goal.current) / weeks / 50) * 50;
      notes.push({
        icon: 'flag-outline', tone: 'ok',
        text: `Tucking away ${peso(perWeek)} a week keeps ${goal.name} on track for ${goal.date}.`,
      });
    }
    if (savingsNote) notes.push({ icon: 'trending-up-outline', tone: 'ok', text: savingsNote });
    return notes.slice(0, 2);
  }, [categories, goal, savingsNote]);

  const txIconFor = (categoryId: string, isIncome: boolean): keyof typeof Ionicons.glyphMap => {
    if (isIncome) return 'trending-up';
    const cat = categories.find((c) => c.name === categoryId);
    return (cat?.icon as any) || 'pricetag';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header — zIndex keeps it ABOVE the carousel's padded touch area
            (the old overlap swallowed the first taps on the avatar). */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greetingFor()}</Text>
            <Text style={styles.username}>{profile.nickname?.trim() || profile.name}</Text>
          </View>
          <Pressable
            onPress={() => router.push('/profile')}
            hitSlop={12}
            style={({ pressed }) => [styles.avatarHit, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Open profile"
          >
            <View style={[styles.avatarRing, { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }]}>
              <View style={styles.avatarInner}>
                <AvatarBadge avatarId={profile.avatarId} name={profile.name} size={40} />
              </View>
            </View>
          </Pressable>
        </View>

        {/* 1 — Balance card carousel */}
        <Animated.FlatList
          data={balanceCards}
          keyExtractor={(c) => c.id}
          horizontal
          snapToInterval={BANK_STEP}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: bankScrollX } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          style={{ marginHorizontal: -24, marginVertical: -14 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 14 }}
          renderItem={({ item, index }) => (
            <BalanceCard
              item={item} index={index} scrollX={bankScrollX} styles={styles}
              country={country} hideBalance={hideBalance} onToggleHide={toggleHide}
              totalLiquid={totalLiquid} accountCount={liquidAccounts.length} holder={profile.name}
            />
          )}
        />
        <View style={styles.dots}>
          {balanceCards.map((_, i) => {
            // scaleX instead of width so the whole carousel can run on the
            // native driver (width is not a native-animatable prop).
            const scaleX = bankScrollX.interpolate({
              inputRange: [(i - 1) * BANK_STEP, i * BANK_STEP, (i + 1) * BANK_STEP],
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            const opacity = bankScrollX.interpolate({
              inputRange: [(i - 1) * BANK_STEP, i * BANK_STEP, (i + 1) * BANK_STEP],
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            return <Animated.View key={i} style={[styles.dot, { opacity, transform: [{ scaleX }] }]} />;
          })}
        </View>

        {/* Cents co-pilot: one compact chat-style note, popping in above
            the Today strip. Never more than two lines. */}
        {centsNotes.length > 0 && (
          <Animated.View
            style={[
              styles.centsPing,
              {
                opacity: centsAnim,
                transform: [
                  { translateY: centsAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                  { scale: centsAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              },
            ]}
          >
            <View style={styles.centsAvatar}>
              <Image source={require('../../assets/cents-mark.png')} style={{ width: 15, height: 15 }} resizeMode="contain" />
            </View>
            <View style={styles.centsBubble}>
              <Text style={styles.centsMsg} numberOfLines={2}>{centsNotes[0].text}</Text>
            </View>
          </Animated.View>
        )}

        {/* 2 — Today strip */}
        <View style={styles.todayRow}>
          <View style={styles.todayCard}>
            <View style={[styles.todayIcon, { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
              <Ionicons name="leaf" size={16} color={t.emerald} />
            </View>
            <Text style={styles.todayLabel}>Today</Text>
            <View style={styles.todayStatRow}>
              <View style={styles.todayStatKey}>
                <View style={[styles.todayStatDot, { backgroundColor: t.emerald }]} />
                <Text style={styles.todayStatLabel}>Saved</Text>
              </View>
              <Text style={[styles.todayStatValue, { color: t.emerald }]} numberOfLines={1}>
                {hideBalance ? '****' : peso(savedToday)}
              </Text>
            </View>
            <View style={styles.todayStatRow}>
              <View style={styles.todayStatKey}>
                <View style={[styles.todayStatDot, { backgroundColor: t.red }]} />
                <Text style={styles.todayStatLabel}>Spent</Text>
              </View>
              <Text style={[styles.todayStatValue, spentToday > 0 && { color: t.red }]} numberOfLines={1}>
                {hideBalance ? '****' : peso(spentToday)}
              </Text>
            </View>
          </View>

          <Pressable style={styles.todayCard} onPress={() => router.push({ pathname: '/(tabs)/goals', params: { tab: 'budgets' } })}>
            <View style={[
              styles.todayIcon,
              attention?.urgent
                ? { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.4)' }
                : { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
            ]}>
              <Ionicons
                name={attention ? 'alert-circle' : 'checkmark-circle'}
                size={16}
                color={attention?.urgent ? t.amber : t.emerald}
              />
            </View>
            <Text style={styles.todayLabel}>Needs attention</Text>
            {attention ? (
              <>
                <Text style={styles.todayValue} numberOfLines={1}>{attention.name}</Text>
                <Text style={[styles.todayCaption, attention.urgent && { color: t.amber, fontWeight: '700' }]} numberOfLines={1}>
                  {attention.line}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.todayValue}>All clear</Text>
                <Text style={styles.todayCaption}>No bills due, budgets healthy</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* 3 — Insights */}
        <Section styles={styles} title="Insights" link="Reorder" onLink={() => setReorderOpen(true)} />
        <Animated.FlatList
          data={insights}
          keyExtractor={(i) => i.key}
          horizontal
          snapToInterval={STEP}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: insightScrollX } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          style={{ marginHorizontal: -24, marginVertical: -14 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 14 }}
          renderItem={({ item, index }) => (
            <InsightSlide index={index} scrollX={insightScrollX}>
              {/* M5.6 empty state: the slide used to render blank with no goals */}
              {item.key === 'goal' && !goal && (
                <GlassCard style={styles.insightCard}>
                  <CardHeader styles={styles} t={t} icon="flag" title="No goal yet" sub="Trajectory appears here" />
                  <Text style={styles.emptyLine}>
                    Add a goal in the Goals tab and Cents will chart your path to it.
                  </Text>
                </GlassCard>
              )}
              {item.key === 'goal' && goal && (
                <GlassCard style={styles.insightCard}>
                  {/* v4.1: the dropdown is gone — this card always shows the
                      STARRED goal; picking a different one lives in Goals. */}
                  <View style={styles.goalHeader}>
                    <View style={styles.goalTitleWrap}>
                      <Ionicons name="star" size={13} color={t.amber} />
                      <Text style={styles.goalTitleText} numberOfLines={1}>{goal.name}</Text>
                      <View style={styles.goalPctBadge}>
                        <Text style={styles.goalPctText}>{Math.round((goal.current / goal.target) * 100)}%</Text>
                      </View>
                    </View>
                    <Pressable
                      hitSlop={8}
                      onPress={() => router.push({ pathname: '/(tabs)/goals', params: { tab: 'goals' } })}
                      style={({ pressed }) => pressed && { opacity: 0.6 }}
                    >
                      <Text style={styles.manageLink}>Manage goals</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.goalTarget}>Target {peso(goal.target)} by {goal.date}</Text>

                  <View style={{ marginTop: 14 }}>
                    <TrajectoryCurve width={CARD_W - 40} progress={goal.current / goal.target} />
                  </View>
                  <View style={styles.trajFooter}>
                    <Text style={styles.trajNow}>{peso(goal.current)} saved</Text>
                    <Text style={styles.trajPct}>on track for {goal.date}</Text>
                  </View>
                </GlassCard>
              )}

              {item.key === 'alloc' && (
                <GlassCard style={styles.insightCard}>
                  <CardHeader styles={styles} t={t} icon="wallet" title="Allocation" sub="Across your money sources" />
                  {/* v4.1: simple flat pie — solid wedges, hairline seams —
                      with amount + share in the legend. */}
                  <View style={styles.donutRow}>
                    <PieChart
                      size={116}
                      seam={t.surface}
                      segments={liquidAccounts.map((a, i) => ({ value: a.balance, color: a.color ?? ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }))}
                    />
                    <View style={{ flex: 1, gap: 9 }}>
                      {[...liquidAccounts]
                        .map((a, i) => ({ a, color: a.color ?? ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }))
                        .sort((x, y) => y.a.balance - x.a.balance)
                        .slice(0, 5)
                        .map(({ a, color }) => (
                          <View key={a.id} style={styles.legendRow}>
                            <View style={[styles.legendDot, { backgroundColor: color }]} />
                            <Text style={styles.legendName} numberOfLines={1}>{a.name}</Text>
                            <Text style={styles.legendAmt}>{hideBalance ? '****' : peso(a.balance)}</Text>
                            <Text style={styles.legendVal}>
                              {totalLiquid > 0 ? Math.round((a.balance / totalLiquid) * 100) : 0}%
                            </Text>
                          </View>
                        ))}
                      {liquidAccounts.length > 5 && (
                        <Text style={styles.legendMore}>+{liquidAccounts.length - 5} more in Wallet</Text>
                      )}
                    </View>
                  </View>
                </GlassCard>
              )}

              {item.key === 'mom' && (
                <GlassCard style={styles.insightCard}>
                  <View style={styles.insightHead}>
                    <CardHeader styles={styles} t={t} icon="stats-chart" title="Savings" sub={savingsSub} />
                    <View style={styles.periodSeg}>
                      {(['D', 'W', 'M', 'Y'] as const).map((p) => (
                        <Pressable
                          key={p}
                          style={[styles.periodBtn, savingsPeriod === p && styles.periodBtnActive]}
                          onPress={() => setSavingsPeriod(p)}
                        >
                          <Text style={[styles.periodText, savingsPeriod === p && { color: t.onEmerald }]}>{p}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <MoMBars key={savingsPeriod} data={savingsData} height={104} />
                  <Text style={styles.insightNote}>{savingsNote}</Text>
                </GlassCard>
              )}
              {item.key === 'topspend' && (
                <GlassCard style={styles.insightCard}>
                  <CardHeader styles={styles} t={t} icon="flame" title="Top spend" sub="This month, by budget" />
                  <SpendBars data={categories.map((c) => ({ name: c.name, spent: c.spent, limit: c.limit }))} />
                </GlassCard>
              )}
            </InsightSlide>
          )}
        />
        <View style={styles.dots}>
          {insights.map((_, i) => {
            // scaleX instead of width so the whole carousel can run on the
            // native driver (width is not a native-animatable prop).
            const scaleX = insightScrollX.interpolate({
              inputRange: [(i - 1) * STEP, i * STEP, (i + 1) * STEP],
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            const opacity = insightScrollX.interpolate({
              inputRange: [(i - 1) * STEP, i * STEP, (i + 1) * STEP],
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            return <Animated.View key={i} style={[styles.dot, { opacity, transform: [{ scaleX }] }]} />;
          })}
        </View>

        {/* 4 — Budgets */}
        <Section styles={styles} title="Budgets" link="Manage" onLink={() => router.push({ pathname: '/(tabs)/goals', params: { tab: 'budgets' } })} />
        {/* M5.27 (owner): the dashboard shows ONE compact budgets summary;
            the full list lives in Goals and Budgets (Manage / tap routes there). */}
        <GlassCard pad={8} style={{ marginBottom: 24 }}>
          {categories.length === 0 ? (
            <Text style={styles.emptyLine}>No budgets yet. Create one from the Goals tab.</Text>
          ) : (() => {
            const limit = categories.reduce((a, c) => a + c.limit, 0);
            const spent = categories.reduce((a, c) => a + c.spent, 0);
            const maxedCount = categories.filter((c) => c.limit > 0 && c.spent >= c.limit).length;
            const pct = limit > 0 ? Math.min(spent / limit, 1) : 0;
            return (
              <Pressable
                style={({ pressed }) => [styles.budgetRow, pressed && { backgroundColor: t.inputFill }]}
                onPress={() => router.push({ pathname: '/(tabs)/goals', params: { tab: 'budgets' } })}
              >
                <View style={[styles.budgetIcon, maxedCount > 0 && { backgroundColor: t.redTint, borderColor: 'rgba(255,77,77,0.35)' }]}>
                  <Ionicons name="pie-chart" size={17} color={maxedCount > 0 ? t.red : t.emerald} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.budgetTop}>
                    <Text style={styles.budgetName} numberOfLines={1}>
                      {categories.length} budget{categories.length === 1 ? '' : 's'}
                    </Text>
                    <Text style={[styles.budgetLeft, maxedCount > 0 && { color: t.red }]}>
                      {maxedCount > 0 ? `${maxedCount} maxed` : 'All healthy'}
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View
                      style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: maxedCount > 0 ? t.red : t.emerald }]}
                    />
                  </View>
                  <Text style={styles.budgetSub}>{peso(spent)} of {peso(limit)} this month · Tap to manage</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={t.textFaint} />
              </Pressable>
            );
          })()}
        </GlassCard>

        {/* 5 — Recent activity */}
        <Section styles={styles} title="Recent activity" link="View all" onLink={() => router.push('/(tabs)/analytics')} />
        <GlassCard pad={8} style={{ marginBottom: 132 }}>
          {transactions.length === 0 && (
            <Text style={styles.emptyLine}>Nothing logged yet. Tap Cents to add your first one.</Text>
          )}
          {/* M5.6: rows route to Analytics, where the tap-to-edit editor lives. */}
          {transactions.slice(0, 6).map((tx, i, arr) => (
            <Pressable
              key={tx.id}
              onPress={() => router.push('/(tabs)/analytics')}
              style={({ pressed }) => [styles.txRow, i < arr.length - 1 && styles.rowDivider, pressed && { backgroundColor: t.inputFill }]}
            >
              {/* v4.1: known PH merchants wear their brand mark; unknown
                  ones keep the category icon; goal moves get a green flag. */}
              <MerchantBadge
                description={tx.description}
                fallbackIcon={txIconFor(tx.categoryId, tx.isIncome)}
                isIncome={tx.isIncome}
                isGoalMove={!!tx.goalId}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.txName} numberOfLines={1}>{tx.description}</Text>
                <Text style={styles.txCat}>{tx.categoryId} · {relDate(tx.timestamp)}</Text>
              </View>
              <Text style={[styles.txAmount, tx.isIncome && { color: t.emerald }]}>
                {tx.isIncome ? '+' : '-'}{hideBalance ? '****' : peso(tx.amount)}
              </Text>
            </Pressable>
          ))}
        </GlassCard>
      </ScrollView>

      {/* Insight reorder sheet */}
      <Modal visible={reorderOpen} transparent animationType="fade" onRequestClose={() => setReorderOpen(false)}>
        <Pressable style={styles.reorderScrim} onPress={() => setReorderOpen(false)}>
          <Pressable style={styles.reorderSheet} onPress={() => {}}>
            <Text style={styles.reorderTitle}>Insight order</Text>
            <Text style={styles.reorderSub}>The first card is what you see when the dashboard opens.</Text>
            {order.map((key, i) => (
              <View key={key} style={[styles.reorderRow, i < order.length - 1 && styles.rowDivider]}>
                <Text style={styles.reorderIndex}>{i + 1}</Text>
                <Ionicons name={INSIGHT_META[key].icon} size={16} color={t.textMuted} />
                <Text style={styles.reorderLabel}>{INSIGHT_META[key].label}</Text>
                <Pressable
                  hitSlop={6}
                  disabled={i === 0}
                  onPress={() => moveInsight(key, -1)}
                  style={({ pressed }) => [styles.reorderBtn, i === 0 && { opacity: 0.25 }, pressed && { backgroundColor: t.emeraldTint }]}
                >
                  <Ionicons name="chevron-up" size={16} color={t.textPrimary} />
                </Pressable>
                <Pressable
                  hitSlop={6}
                  disabled={i === order.length - 1}
                  onPress={() => moveInsight(key, 1)}
                  style={({ pressed }) => [styles.reorderBtn, i === order.length - 1 && { opacity: 0.25 }, pressed && { backgroundColor: t.emeraldTint }]}
                >
                  <Ionicons name="chevron-down" size={16} color={t.textPrimary} />
                </Pressable>
              </View>
            ))}
            <Pressable style={[styles.reorderDone, { backgroundColor: t.emerald }]} onPress={() => setReorderOpen(false)}>
              <Text style={styles.reorderDoneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 0 },
  // zIndex lifts the header above the carousel's padded touch plane so the
  // avatar always takes the FIRST tap (the old 44px overlap ate taps).
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, zIndex: 10 },
  avatarHit: { padding: 4, margin: -4 },

  // Cents chat-ping: a compact incoming-message row — small forest avatar
  // wearing the yellow mark, matte bubble with a tucked tail corner.
  centsPing: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 },
  centsAvatar: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.forest, marginBottom: 1,
  },
  // Open bubble: no fill, just the same 1px border the cards wear.
  centsBubble: {
    flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border,
    borderRadius: 14, borderBottomLeftRadius: 4,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  centsMsg: { color: t.textMuted, fontSize: 12.5, lineHeight: 17 },
  avatarRing: { width: 48, height: 48, borderRadius: 24, padding: 2 },
  avatarInner: {
    flex: 1, borderRadius: 22, backgroundColor: t.insetBg,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  greeting: { color: t.textMuted, fontSize: 13 },
  username: { color: t.textPrimary, fontSize: 20, fontWeight: '700' },

  // Balance carousel — v4: matte card, whisper of a neutral shadow only
  bankShadow: {
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOpacity: t.mode === 'dark' ? 0.20 : 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  bankCard: { borderRadius: 18, padding: 24, height: 204, overflow: 'hidden', justifyContent: 'space-between' },
  bankTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bankLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, fontWeight: '600' },
  eyeBtn: {
    width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bankIdRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  bankKindSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },
  bankAmount: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', ...type.money },
  bankCaption: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: -6 },
  bankBottom: { flexDirection: 'row', alignItems: 'center' },
  chipWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  chip: {
    width: 32, height: 23, borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  chipLine: { position: 'absolute', top: 6, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  chipLineV: { position: 'absolute', left: 15, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  bankHolder: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontWeight: '700', letterSpacing: 1.4 },
  bankMask: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginLeft: 10 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', marginVertical: 14, height: 8 },
  dot: { width: 20, height: 6, borderRadius: 3, backgroundColor: t.emerald },

  // Today strip
  todayRow: { flexDirection: 'row', gap: 12, marginBottom: 22 },
  todayCard: {
    flex: 1, borderRadius: 22, padding: 16, gap: 3,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
  },
  todayIcon: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 7,
  },
  todayLabel: { color: t.textMuted, fontSize: 12, fontWeight: '600' },
  todayValue: { color: t.textPrimary, fontSize: 18, fontWeight: '800', ...type.money },
  todayCaption: { color: t.textFaint, fontSize: 11 },
  todayStatRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', marginTop: 5,
  },
  todayStatKey: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  todayStatDot: { width: 6, height: 6, borderRadius: 3 },
  todayStatLabel: { color: t.textMuted, fontSize: 12, fontWeight: '600' },
  todayStatValue: { color: t.textPrimary, fontSize: 15, fontWeight: '800', flexShrink: 1, ...type.money },

  // Sections
  // zIndex keeps section links above the carousels' padded touch planes
  // (same fix as the header avatar: overlap was eating first taps).
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, zIndex: 10 },
  sectionLinkHit: { paddingVertical: 8, paddingHorizontal: 8, marginVertical: -8, marginRight: -8 },
  sectionTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '700' },
  sectionLink: { color: t.emerald, fontSize: 13, fontWeight: '700' },

  // Insight cards
  insightCard: { minHeight: 264 },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  goalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  goalTitleText: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  goalPctBadge: {
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  goalPctText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  manageLink: { color: t.emerald, fontSize: 13, fontWeight: '700' },
  goalTarget: { color: t.textMuted, fontSize: 12, marginTop: 8 },
  trajFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  trajNow: { color: t.textPrimary, fontSize: 13, fontWeight: '600' },
  trajPct: { color: t.emerald, fontSize: 13, fontWeight: '600' },
  cardHeader: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 14 },
  cardHeaderIcon: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: '600' },
  cardSub: { color: t.textMuted, fontSize: 12 },
  insightHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  periodSeg: {
    flexDirection: 'row', gap: 3, padding: 3, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  periodBtn: { width: 28, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  periodBtnActive: { backgroundColor: t.emerald },
  periodText: { color: t.textMuted, fontSize: 11, fontWeight: '800' },
  insightNote: { color: t.textMuted, fontSize: 12, marginTop: 12, lineHeight: 17 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { color: t.textMuted, fontSize: 13, flex: 1 },
  legendAmt: { color: t.textPrimary, fontSize: 12.5, fontWeight: '700', ...type.money },
  legendVal: { color: t.textFaint, fontSize: 12, fontWeight: '600', width: 34, textAlign: 'right' },
  legendMore: { color: t.textFaint, fontSize: 11.5, marginTop: 2 },

  // Budgets list
  budgetRow: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'flex-start' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  budgetIcon: {
    width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder, marginTop: 2,
  },
  budgetTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  dueChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: t.inputFill, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3,
  },
  dueChipUrgent: { backgroundColor: 'rgba(245,158,11,0.14)' },
  dueChipText: { color: t.textMuted, fontSize: 10, fontWeight: '700' },
  budgetLeft: { color: t.emerald, fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  track: { height: 6, borderRadius: 3, backgroundColor: t.trackBg, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  budgetSub: { color: t.textMuted, fontSize: 12.5, ...type.money },
  emptyLine: { color: t.textMuted, fontSize: 13, padding: 14 },

  // Activity
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  // M5.27: unified list type scale (matches the Analytics ledger rows).
  txName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  txCat: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  txAmount: { color: t.textPrimary, fontSize: 15.5, fontWeight: '800', ...type.money },

  // Reorder sheet
  reorderScrim: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)', justifyContent: 'center', padding: 28 },
  reorderSheet: {
    backgroundColor: t.sheet, borderRadius: radius.card, borderWidth: 1, borderColor: t.border,
    padding: 20,
    shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  reorderTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '700' },
  reorderSub: { color: t.textMuted, fontSize: 12.5, marginTop: 3, marginBottom: 10 },
  reorderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  reorderIndex: { color: t.textFaint, fontSize: 12, fontWeight: '700', width: 14, ...type.money },
  reorderLabel: { color: t.textPrimary, fontSize: 14.5, fontWeight: '600', flex: 1 },
  reorderBtn: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  reorderDone: { height: 46, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  reorderDoneText: { color: t.onEmerald, fontSize: 14.5, fontWeight: '800' },
});
