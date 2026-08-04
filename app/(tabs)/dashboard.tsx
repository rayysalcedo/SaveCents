// M5 redesign: user-first Home. Structure, top to bottom:
//   1. Balance card carousel: an ATM-style Total Balance card, then one
//      branded card per linked source (GCash, BPI, ...), swipeable with a
//      scale/lift animation and page dots.
//   2. Today strip: Saved today + Needs attention (bills due / maxed budgets).
//   3. Insights carousel (goal trajectory, allocation, savings, top spend).
//   4. Budgets list and Recent activity, restyled.
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../src/components/GlassCard';
import { AvatarBadge } from '../../src/components/Avatar';
import { MoMBars, SegmentedDonut, SpendBars, TrajectoryCurve } from '../../src/components/Charts';
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

// M5.29 (owner: allocation colors blended): eight strongly distinct hues so
// neighboring accounts never read as the same slice.
const ACCOUNT_COLORS = ['#10B981', '#8B5CF6', '#F59E0B', '#3B82F6', '#EC4899', '#F97316', '#6366F1', '#06B6D4'];

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
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.8, 1, 0.8], extrapolate: 'clamp' });
  const lift = scrollX.interpolate({ inputRange, outputRange: [26, 0, 26], extrapolate: 'clamp' });
  const dim = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const tilt = scrollX.interpolate({ inputRange, outputRange: ['6deg', '0deg', '-6deg'], extrapolate: 'clamp' });
  return (
    <Animated.View style={{ width: CARD_W, marginRight: BANK_GAP, opacity: dim, transform: [{ scale }, { translateY: lift }, { rotateZ: tilt }] }}>
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
  // The card in view scales up and casts a deeper shadow; off-screen cards
  // shrink and dim so each swipe lands with a clear highlight.
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.8, 1, 0.8], extrapolate: 'clamp' });
  const lift = scrollX.interpolate({ inputRange, outputRange: [26, 0, 26], extrapolate: 'clamp' });
  const dim = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const tilt = scrollX.interpolate({ inputRange, outputRange: ['6deg', '0deg', '-6deg'], extrapolate: 'clamp' });

  const money = (n: number) => (hideBalance ? '****' : peso(n));
  const isTotal = item.kind === 'total';
  const acct = item.kind === 'account' ? item.account : null;
  const inst = acct ? institutionFor(country, acct.name) : null;
  const base = isTotal ? '#0C5138' : (acct?.color ?? inst?.color ?? ACCOUNT_COLORS[index % ACCOUNT_COLORS.length]);
  const gradient: [string, string, string] = [shade(base, -0.55), shade(base, -0.2), base];
  const kind = inst?.kind === 'wallet' ? 'E-wallet' : inst?.kind === 'bank' ? 'Bank' : inst?.kind === 'cash' ? 'Cash' : 'Account';

  return (
    <Animated.View style={{ width: BANK_CARD_W, marginRight: BANK_GAP, opacity: dim, transform: [{ scale }, { translateY: lift }, { rotateZ: tilt }] }}>
      <View style={styles.bankShadow}>
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bankCard}>
          {/* decorative arcs */}
          <View style={[styles.deco, { width: 220, height: 220, borderRadius: 110, top: -110, right: -60 }]} />
          <View style={[styles.deco, { width: 150, height: 150, borderRadius: 75, bottom: -80, left: -40 }]} />
          <LinearGradient
            colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 0.65, y: 0.85 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.bankTop}>
            <Text style={styles.bankLabel}>{isTotal ? 'Total Balance' : acct!.name}</Text>
            {isTotal ? (
              <Pressable onPress={onToggleHide} hitSlop={10} style={styles.eyeBtn}>
                <Ionicons name={hideBalance ? 'eye-off' : 'eye'} size={15} color="rgba(255,255,255,0.9)" />
              </Pressable>
            ) : (
              <View style={styles.kindTag}>
                <Text style={styles.kindTagText}>{kind}</Text>
              </View>
            )}
          </View>

          <Text style={styles.bankAmount}>{money(isTotal ? totalLiquid : acct!.balance)}</Text>
          {isTotal && (
            <Text style={styles.bankCaption}>Across {accountCount} source{accountCount === 1 ? '' : 's'}</Text>
          )}

          <View style={styles.bankBottom}>
            <View style={styles.chipWrap}>
              <View style={styles.chip}>
                <View style={styles.chipLine} />
                <View style={[styles.chipLine, { top: 12 }]} />
                <View style={styles.chipLineV} />
              </View>
              <Ionicons name="wifi" size={15} color="rgba(255,255,255,0.75)" style={{ transform: [{ rotate: '90deg' }] }} />
            </View>
            <Text style={styles.bankHolder}>{holder.toUpperCase()}</Text>
            <Text style={styles.bankMask}>****</Text>
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
      <Pressable onPress={onLink} hitSlop={8}>
        <Text style={styles.sectionLink}>{link}</Text>
      </Pressable>
    ) : null}
  </View>
);

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

  const goal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) ?? goals[0],
    [goals, selectedGoalId],
  );
  const [goalMenu, setGoalMenu] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const toggleHide = React.useCallback(() => setHideBalance((v) => !v), []);

  const totalLiquid = accounts.reduce((a, x) => a + x.balance, 0);
  const totalLimit = categories.reduce((a, c) => a + c.limit, 0);
  const totalSpent = categories.reduce((a, c) => a + c.spent, 0);

  // ── Today strip data ──────────────────────────────────────────────────
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  // M5.17 (owner): the old single net number read as nonsense ("Saved today"
  // in red). The card now shows BOTH sides of the day: what went out, and
  // what is left of today's money after spending (never negative).
  const todayTx = transactions.filter((x) => x.timestamp >= startOfDay.getTime());
  const earnedToday = todayTx.reduce((a, x) => a + (x.isIncome ? x.amount : 0), 0);
  const spentToday = todayTx.reduce((a, x) => a + (x.isIncome ? 0 : x.amount), 0);
  const savedToday = Math.max(earnedToday - spentToday, 0);

  // Needs attention: nearest due budget first, then maxed, then near-limit.
  const attention = useMemo(() => {
    const due = categories
      .filter((c) => c.dueDate)
      .sort((a, b) => (a.dueDate! - b.dueDate!))[0];
    if (due) {
      const remaining = Math.max(due.limit - due.spent, 0);
      const d = dueLabel(due.dueDate!);
      return { kind: 'due' as const, name: due.name, line: d.text, amount: remaining, urgent: d.urgent, icon: due.icon };
    }
    const maxed = categories.find((c) => c.spent >= c.limit);
    if (maxed) return { kind: 'maxed' as const, name: maxed.name, line: 'Budget fully used', amount: 0, urgent: true, icon: maxed.icon };
    const near = categories.find((c) => c.limit > 0 && c.spent / c.limit >= 0.85);
    if (near) return { kind: 'near' as const, name: near.name, line: `${Math.round((near.spent / near.limit) * 100)}% of budget used`, amount: near.limit - near.spent, urgent: false, icon: near.icon };
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
  const insights = [{ key: 'goal' }, { key: 'alloc' }, { key: 'mom' }, { key: 'topspend' }];
  const [savingsPeriod, setSavingsPeriod] = useState<'D' | 'W' | 'M' | 'Y'>('M');
  // M5.6 truth pass: the chart and its note are computed from real
  // transactions (src/utils/stats.ts), no more sample numbers.
  const savingsData = useMemo(() => savingsSeries(transactions, savingsPeriod), [transactions, savingsPeriod]);
  const savingsSub = { D: 'Last 7 days', W: 'Last 5 weeks', M: 'Last 5 months', Y: 'Last 5 years' }[savingsPeriod];
  const savingsNote = useMemo(() => buildSavingsNote(savingsData, savingsPeriod), [savingsData, savingsPeriod]);

  const txIconFor = (categoryId: string, isIncome: boolean): keyof typeof Ionicons.glyphMap => {
    if (isIncome) return 'trending-up';
    const cat = categories.find((c) => c.name === categoryId);
    return (cat?.icon as any) || 'pricetag';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greetingFor()}</Text>
            <Text style={styles.username}>{profile.nickname?.trim() || profile.name}</Text>
          </View>
          <Pressable onPress={() => router.push('/profile')} hitSlop={8}>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <AvatarBadge avatarId={profile.avatarId} name={profile.name} size={40} />
              </View>
            </LinearGradient>
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
          style={{ marginHorizontal: -24, marginVertical: -44 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 44 }}
          renderItem={({ item, index }) => (
            <BalanceCard
              item={item} index={index} scrollX={bankScrollX} styles={styles}
              country={country} hideBalance={hideBalance} onToggleHide={toggleHide}
              totalLiquid={totalLiquid} accountCount={accounts.length} holder={profile.name}
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
        <Section styles={styles} title="Insights" />
        <Animated.FlatList
          data={insights}
          keyExtractor={(i) => i.key}
          horizontal
          snapToInterval={STEP}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: insightScrollX } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          style={{ marginHorizontal: -24, marginVertical: -30 }}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 30 }}
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
                    <Text style={styles.goalTarget}>Target {peso(goal.target)} by {goal.date}</Text>

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
                    <Text style={styles.trajPct}>on track for {goal.date}</Text>
                  </View>
                </GlassCard>
              )}

              {item.key === 'alloc' && (
                <GlassCard style={styles.insightCard}>
                  <CardHeader styles={styles} t={t} icon="wallet" title="Allocation" sub="Across your money sources" />
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
                    <LinearGradient
                      colors={maxedCount > 0 ? [t.red, '#FF7A7A'] : [t.forest, t.emerald]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%` }]}
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
              <View style={[styles.txIcon, tx.isIncome && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                <Ionicons name={txIconFor(tx.categoryId, tx.isIncome)} size={16} color={tx.isIncome ? t.emerald : t.textMuted} />
              </View>
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
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  avatarRing: { width: 48, height: 48, borderRadius: 24, padding: 2 },
  avatarInner: {
    flex: 1, borderRadius: 22, backgroundColor: t.insetBg,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  greeting: { color: t.textMuted, fontSize: 13 },
  username: { color: t.textPrimary, fontSize: 20, fontWeight: '700' },

  // Balance carousel
  bankShadow: {
    borderRadius: 28,
    shadowColor: t.mode === 'dark' ? '#03130C' : '#0B3A2E',
    shadowOpacity: t.mode === 'dark' ? 0.5 : 0.22,
    shadowRadius: t.mode === 'dark' ? 28 : 22,
    shadowOffset: { width: 0, height: t.mode === 'dark' ? 16 : 12 },
    elevation: 16,
  },
  bankCard: { borderRadius: 28, padding: 24, height: 204, overflow: 'hidden', justifyContent: 'space-between' },
  deco: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.06)' },
  bankTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bankLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, fontWeight: '600' },
  eyeBtn: {
    width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  kindTag: {
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  kindTagText: { color: 'rgba(255,255,255,0.9)', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 },
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
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '700' },
  sectionLink: { color: t.emerald, fontSize: 13, fontWeight: '700' },

  // Insight cards
  insightCard: { minHeight: 264 },
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
  legendVal: { color: t.textPrimary, fontSize: 13, fontWeight: '700' },

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
  txIcon: {
    width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  // M5.27: unified list type scale (matches the Analytics ledger rows).
  txName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  txCat: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  txAmount: { color: t.textPrimary, fontSize: 15.5, fontWeight: '800', ...type.money },
});
