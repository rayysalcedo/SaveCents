import React, { useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../src/components/GlassCard';
import { MoMBars, SegmentedDonut, SpendBars, TrajectoryCurve } from '../../src/components/Charts';
import { C, Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { peso } from '../../src/models/types';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - 48;

const ACCOUNT_COLORS = [C.emerald, C.purple, C.amber, C.teal, C.mint];
const CAT_TX_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Income: 'trending-up', Pets: 'paw', 'Giorno Gas': 'car', Gaming: 'game-controller', Dining: 'restaurant',
};

export default function Dashboard() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { accounts, categories, goals, transactions, profile, selectedGoalId, selectGoal } = useFinance();

  const goal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) ?? goals[0],
    [goals, selectedGoalId],
  );
  const [goalMenu, setGoalMenu] = useState(false);

  const totalLiquid = accounts.reduce((a, x) => a + x.balance, 0);
  const totalLimit = categories.reduce((a, c) => a + c.limit, 0);
  const totalSpent = categories.reduce((a, c) => a + c.spent, 0);
  const monthIncome = transactions.filter((t) => t.isIncome).reduce((a, t) => a + t.amount, 0);

  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList>(null);
  const STEP = CARD_W + 12;
  const insights = [{ key: 'goal' }, { key: 'alloc' }, { key: 'mom' }, { key: 'topspend' }];
  const [savingsPeriod, setSavingsPeriod] = useState<'D' | 'W' | 'M' | 'Y'>('M');
  const savingsData = {
    D: [
      { label: 'Sun', value: 60 }, { label: 'Mon', value: 120 }, { label: 'Tue', value: 90 },
      { label: 'Wed', value: 150 }, { label: 'Thu', value: 80 }, { label: 'Fri', value: 40 },
      { label: 'Sat', value: 160 },
    ],
    W: [
      { label: 'W1', value: 380 }, { label: 'W2', value: 520 }, { label: 'W3', value: 410 },
      { label: 'W4', value: 640 }, { label: 'W5', value: 700 },
    ],
    M: [
      { label: 'Mar', value: 1450 }, { label: 'Apr', value: 1100 }, { label: 'May', value: 1900 },
      { label: 'Jun', value: 1990 }, { label: 'Jul', value: 2350 },
    ],
    Y: [
      { label: '2022', value: 8200 }, { label: '2023', value: 11400 }, { label: '2024', value: 15800 },
      { label: '2025', value: 21500 }, { label: '2026', value: 14200 },
    ],
  }[savingsPeriod];
  const savingsSub = { D: 'This week', W: 'Last 5 weeks', M: 'Last 5 months', Y: 'Last 5 years' }[savingsPeriod];
  const savingsNote = {
    D: `${peso(160)} saved today — Saturdays are your strongest day.`,
    W: `${peso(700)} saved this week — trending up 3 weeks straight.`,
    M: `${peso(2350)} saved this month — your best since March.`,
    Y: `${peso(14200)} saved so far in 2026 — on pace to beat last year.`,
  }[savingsPeriod];


  const HeroStat = ({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) => {
  return (
    <View style={styles.heroStat}>
      <View style={styles.heroStatIcon}>
        <Ionicons name={icon} size={11} color="#E7FFF6" />
      </View>
      <View>
        <Text style={styles.heroStatLabel}>{label}</Text>
        <Text style={styles.heroStatValue}>{value}</Text>
      </View>
    </View>
  );
};

  const CardHeader = ({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) => {
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
};

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <Text style={styles.avatarText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            </LinearGradient>
            <View>
              <Text style={styles.greeting}>Good day,</Text>
              <Text style={styles.username}>{profile.name}</Text>
            </View>
          </View>
          <Pressable style={styles.bell}>
            <Ionicons name="notifications-outline" size={20} color={t.textPrimary} />
            <View style={styles.bellDot} />
          </Pressable>
        </View>

        {/* Aurora balance hero */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={[...t.heroGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            {/* sheen highlight */}
            <LinearGradient
              colors={[t.sheen, 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.9 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.heroEyebrow}>TOTAL LIQUID BALANCE</Text>
            <Text style={styles.heroValue}>{peso(totalLiquid)}</Text>
            <View style={styles.heroStats}>
              <HeroStat icon="arrow-down" label="Income" value={peso(monthIncome)} />
              <View style={styles.heroDivider} />
              <HeroStat icon="arrow-up" label="Spent" value={peso(totalSpent)} />
              <View style={styles.heroDivider} />
              <HeroStat icon="pie-chart" label="Budgeted" value={peso(totalLimit)} />
            </View>
          </LinearGradient>
        </View>


        {/* Insights carousel */}
        <Text style={styles.eyebrow}>INSIGHTS</Text>
        <FlatList
          ref={listRef}
          data={insights}
          keyExtractor={(i) => i.key}
          horizontal
          pagingEnabled
          snapToInterval={CARD_W + 12}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <View style={{ width: CARD_W }}>
              {item.key === 'goal' && goal && (
                <GlassCard>
                  <View style={{ position: 'relative', zIndex: 20 }}>
                    <View style={styles.goalHeader}>
                      <Pressable
                        style={[styles.goalSelector, goalMenu && styles.goalSelectorOpen]}
                        onPress={() => setGoalMenu((v) => !v)}
                      >
                        <View style={styles.goalSelectorIcon}>
                          <Ionicons name="flag" size={13} color={t.emerald} />
                        </View>
                        <Text style={styles.goalSelectorText} numberOfLines={1}>{goal.name}</Text>
                        <View style={styles.goalChevron}>
                          <Ionicons name={goalMenu ? 'chevron-up' : 'chevron-down'} size={13} color={t.emerald} />
                        </View>
                      </Pressable>
                      <View style={styles.goalPctBadge}>
                        <Text style={styles.goalPctText}>{Math.round((goal.current / goal.target) * 100)}%</Text>
                      </View>
                    </View>
                    <Text style={styles.goalTarget}>Target {peso(goal.target)} · {goal.date}</Text>

                    {goalMenu && (
                      <View style={styles.goalMenu}>
                        {goals.map((g, gi) => {
                          const active = g.id === goal.id;
                          return (
                            <Pressable
                              key={g.id}
                              style={({ pressed }) => [
                                styles.goalMenuItem,
                                gi < goals.length - 1 && styles.goalMenuDivider,
                                pressed && { backgroundColor: t.inputFill },
                              ]}
                              onPress={() => { selectGoal(g.id); setGoalMenu(false); }}
                            >
                              <View style={[styles.goalMenuIcon, active && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                                <Ionicons name="flag" size={12} color={active ? t.emerald : t.textMuted} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.goalMenuText, active && { color: t.emerald }]} numberOfLines={1}>{g.name}</Text>
                                <Text style={styles.goalMenuSub}>{peso(g.current)} of {peso(g.target)}</Text>
                              </View>
                              <View style={styles.goalMenuRing}>
                                <Text style={[styles.goalMenuPct, active && { color: t.emerald }]}>
                                  {Math.round((g.current / g.target) * 100)}%
                                </Text>
                              </View>
                              {active && <Ionicons name="checkmark-circle" size={17} color={t.emerald} />}
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <TrajectoryCurve width={CARD_W - 40} progress={goal.current / goal.target} />
                  </View>
                  <View style={styles.trajFooter}>
                    <Text style={styles.trajNow}>{peso(goal.current)} saved</Text>
                    <Text style={styles.trajPct}>on trajectory for {goal.date}</Text>
                  </View>
                </GlassCard>
              )}

              {item.key === 'alloc' && (
                <GlassCard>
                  <CardHeader icon="wallet" title="Allocation" sub="Across your liquid sources" />
                  <View style={styles.donutRow}>
                    <SegmentedDonut
                      size={124}
                      segments={accounts.map((a, i) => ({ value: a.balance, color: a.color ?? ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }))}
                    />
                    <View style={{ flex: 1, gap: 10 }}>
                      {accounts.map((a, i) => (
                        <View key={a.id} style={styles.legendRow}>
                          <View style={[styles.legendDot, { backgroundColor: a.color ?? ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }]} />
                          <Text style={styles.legendName}>{a.name}</Text>
                          <Text style={styles.legendVal}>
                            {totalLiquid > 0 ? Math.round((a.balance / totalLiquid) * 100) : 0}%
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </GlassCard>
              )}

              {item.key === 'mom' && (
                <GlassCard>
                  <View style={styles.insightHead}>
                    <CardHeader icon="stats-chart" title="Savings" sub={savingsSub} />
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
                <GlassCard>
                  <CardHeader icon="flame" title="Top spend" sub="This month, by budget" />
                  <SpendBars data={categories.map((c) => ({ name: c.name, spent: c.spent, limit: c.limit }))} />
                </GlassCard>
              )}
            </View>
          )}
        />
        <View style={styles.dots}>
          {insights.map((_, i) => {
            const width = scrollX.interpolate({
              inputRange: [(i - 1) * STEP, i * STEP, (i + 1) * STEP],
              outputRange: [7, 22, 7],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange: [(i - 1) * STEP, i * STEP, (i + 1) * STEP],
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });
            const stretch = scrollX.interpolate({
              inputRange: [(i - 0.5) * STEP, i * STEP, (i + 0.5) * STEP],
              outputRange: [1.35, 1, 1.35],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.dropDot,
                  { width, opacity, transform: [{ scaleY: stretch as any }] },
                ]}
              />
            );
          })}
        </View>

        {/* Budgets */}
        <Text style={styles.eyebrow}>BUDGETS</Text>
        <View style={{ gap: 12, marginBottom: 24 }}>
          {categories.map((c) => {
            const pct = Math.min(c.spent / c.limit, 1);
            const maxed = pct >= 1;
            return (
              <GlassCard key={c.id} pad={16}>
                <View style={styles.catRow}>
                  <View style={[styles.catIcon, maxed && { backgroundColor: t.redTint, borderColor: 'rgba(255,77,77,0.35)' }]}>
                    <Ionicons name={(c.icon as any) || 'pricetag'} size={18} color={maxed ? t.red : t.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catName}>{c.name}</Text>
                    <Text style={styles.catSub}>{peso(c.spent)} of {peso(c.limit)}</Text>
                  </View>
                  <Text style={[styles.catRemaining, maxed && { color: t.red }]}>
                    {maxed ? 'Maxed' : `${peso(c.limit - c.spent)} left`}
                  </Text>
                </View>
                <View style={styles.track}>
                  <LinearGradient
                    colors={maxed ? [t.red, '#FF7A7A'] : [t.forest, t.emerald]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%` }]}
                  />
                </View>
              </GlassCard>
            );
          })}
        </View>

        {/* Activity */}
        <Text style={styles.eyebrow}>RECENT ACTIVITY</Text>
        <GlassCard pad={8} style={{ marginBottom: 132 }}>
          {transactions.slice(0, 6).map((tx, i, arr) => (
            <View key={tx.id} style={[styles.txRow, i < arr.length - 1 && styles.txDivider]}>
              <View style={[styles.txIcon, tx.isIncome && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                <Ionicons
                  name={CAT_TX_ICONS[tx.categoryId] ?? (tx.isIncome ? 'trending-up' : 'pricetag')}
                  size={16}
                  color={tx.isIncome ? t.emerald : t.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txName}>{tx.description}</Text>
                <Text style={styles.txCat}>{tx.categoryId} · {relDate(tx.timestamp)}</Text>
              </View>
              <Text style={[styles.txAmount, tx.isIncome && { color: t.emerald }]}>
                {tx.isIncome ? '+' : '-'}{peso(tx.amount)}
              </Text>
            </View>
          ))}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

function relDate(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}



const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarRing: { width: 46, height: 46, borderRadius: 16, padding: 2 },
  avatarInner: {
    flex: 1, borderRadius: 14, backgroundColor: t.insetBg,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: t.emerald, fontSize: 18, fontWeight: '700' },
  greeting: { color: t.textMuted, fontSize: 13 },
  username: { color: t.textPrimary, fontSize: 20, fontWeight: '700' },
  bell: {
    width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
  },
  bellDot: {
    position: 'absolute', top: 11, right: 12, width: 7, height: 7, borderRadius: 4,
    backgroundColor: t.emerald, borderWidth: 1.5, borderColor: t.bg,
  },
  heroWrap: {
    borderRadius: radius.card, marginBottom: 24,
    shadowColor: t.emerald, shadowOpacity: t.mode === 'dark' ? 0.45 : 0.28, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  hero: { borderRadius: radius.card, padding: 24, overflow: 'hidden' },
  heroEyebrow: { ...type.eyebrow, color: 'rgba(231,255,246,0.75)' },
  heroValue: {
    color: '#FFFFFF', fontSize: 42, fontWeight: '800', marginTop: 6, marginBottom: 18,
    ...type.money,
  },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  heroStatIcon: {
    width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroStatLabel: { color: 'rgba(231,255,246,0.7)', fontSize: 10 },
  heroStatValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', ...type.money },
  heroDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.18)' },
  eyebrow: { ...type.eyebrow, color: t.textFaint, marginBottom: 12 },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border,
    borderRadius: radius.chip, paddingLeft: 6, paddingRight: 8, paddingVertical: 6,
  },
  goalSelectorOpen: { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint },
  goalChevron: {
    width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint,
  },
  goalPctBadge: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 10,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  goalPctText: { color: t.emerald, fontSize: 13, fontWeight: '800' },
  goalSelectorIcon: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint,
  },
  goalSelectorText: { color: t.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  goalTarget: { color: t.textMuted, fontSize: 12, marginTop: 8 },
  goalMenu: {
    position: 'absolute', top: 46, left: 0, right: 0, zIndex: 30,
    borderRadius: 18, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  goalMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  goalMenuDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  goalMenuIcon: {
    width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  goalMenuText: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  goalMenuSub: { color: t.textMuted, fontSize: 11, marginTop: 1 },
  goalMenuRing: { marginRight: 2 },
  goalMenuPct: { color: t.textMuted, fontSize: 12, fontWeight: '800' },
  trajFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  trajNow: { color: t.textPrimary, fontSize: 13, fontWeight: '600' },
  trajPct: { color: t.emerald, fontSize: 13, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', marginVertical: 16, height: 12 },
  dropDot: { height: 7, borderRadius: 4, backgroundColor: t.emerald },
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
  deltaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  deltaText: { color: t.emerald, fontSize: 12, fontWeight: '800' },
  insightNote: { color: t.textMuted, fontSize: 12, marginTop: 12, lineHeight: 17 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { color: t.textMuted, fontSize: 13, flex: 1 },
  legendVal: { color: t.textPrimary, fontSize: 13, fontWeight: '700' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  catIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  catName: { color: t.textPrimary, fontSize: 14, fontWeight: '600' },
  catSub: { color: t.textMuted, fontSize: 12, marginTop: 1, ...type.money },
  catRemaining: { color: t.mint, fontSize: 12, fontWeight: '700' },
  track: { height: 7, borderRadius: 4, backgroundColor: t.trackBg, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  txDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  txIcon: {
    width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  txName: { color: t.textPrimary, fontSize: 14, fontWeight: '600' },
  txCat: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  txAmount: { color: t.textPrimary, fontSize: 14, fontWeight: '700', ...type.money },
});
