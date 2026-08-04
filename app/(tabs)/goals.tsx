import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { GlassCard } from '../../src/components/GlassCard';
import { MoneyInput } from '../../src/components/MoneyInput';
import { TrajectoryCurve } from '../../src/components/Charts';
import { Palette, radius, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { paceLabel, weeklySavingsRate } from '../../src/utils/stats';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { peso } from '../../src/models/types';
import { BUDGET_CATEGORIES } from '../../src/data/countries';

const CARD_W = Dimensions.get('window').width - 48;
const TABS = ['Goals', 'Budgets'] as const;

export default function GoalsScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { goals, addGoal, removeGoal, addToGoal, accounts, categories, addBudget, updateBudget, removeBudget, transactions } = useFinance();
  const weeklyRate = useMemo(() => weeklySavingsRate(transactions), [transactions]);

  const [tab, setTab] = useState<0 | 1>(0);
  const [segW, setSegW] = useState(0);
  const segAnim = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Deep link support: Home's Manage button opens the Budgets tab directly.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (tabParam === 'budgets' && tab !== 1) switchTab(1);
    if (tabParam === 'goals' && tab !== 0) switchTab(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const switchTab = (next: 0 | 1) => {
    if (next === tab) return;
    Animated.timing(segAnim, { toValue: next, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
    setTimeout(() => setTab(next), 110);
  };

  // Goal sheet state
  const [goalSheet, setGoalSheet] = useState(false);
  const [gName, setGName] = useState('');
  const [gAmount, setGAmount] = useState('');
  const [gDate, setGDate] = useState<Date>(new Date(Date.now() + 180 * 86400000));
  const [showPicker, setShowPicker] = useState(false);

  // Session A: contribution sheet state. savingGoalId doubles as visibility.
  // sourceId null = track only (no account debit).
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);
  const [saveAmount, setSaveAmount] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const saveDrag = useDragToDismiss(() => setSavingGoalId(null));
  const savingGoal = goals.find((g) => g.id === savingGoalId);
  const sourceAcct = sourceId ? accounts.find((a) => a.id === sourceId) : undefined;
  const saveVal = parseFloat(saveAmount) || 0;

  const openAddSavings = (goalId: string) => {
    setSaveAmount('');
    setSourceId(null);
    setSavingGoalId(goalId);
  };

  const submitSavings = () => {
    if (!savingGoalId || !(saveVal > 0)) return;
    addToGoal(savingGoalId, saveVal, sourceId ?? undefined);
    setSavingGoalId(null);
  };

  // Budget sheet state: category + custom name + limit + optional due date.
  const [budgetSheet, setBudgetSheet] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickedCat, setPickedCat] = useState<string | null>(null);
  const goalDrag = useDragToDismiss(() => setGoalSheet(false));
  const budgetDrag = useDragToDismiss(() => setBudgetSheet(false));
  const [bName, setBName] = useState('');
  const [bLimit, setBLimit] = useState('');
  const [bHasDue, setBHasDue] = useState(false);
  const [bDate, setBDate] = useState<Date>(new Date(Date.now() + 14 * 86400000));
  const [showBPicker, setShowBPicker] = useState(false);

  const openNewBudget = () => {
    setEditingId(null); setPickedCat(null); setBName(''); setBLimit('');
    setBHasDue(false); setBDate(new Date(Date.now() + 14 * 86400000)); setShowBPicker(false);
    setBudgetSheet(true);
  };
  const openEditBudget = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setEditingId(id);
    const base = c.category ?? (BUDGET_CATEGORIES.some((b) => b.name === c.name) ? c.name : 'Others');
    setPickedCat(base);
    setBName(c.name);
    setBLimit(String(c.limit));
    setBHasDue(!!c.dueDate);
    setBDate(c.dueDate ? new Date(c.dueDate) : new Date(Date.now() + 14 * 86400000));
    setShowBPicker(false);
    setBudgetSheet(true);
  };

  // Owner feedback (v30): picking a category must NEVER touch the name
  // field. The category sets the icon and grouping; the name belongs to the
  // user ("Netflix" under Subscriptions). A blank name falls back to the
  // category name at submit (submitBudget already does this).
  const pickCategory = (name: string) => setPickedCat(name);

  const submitGoal = () => {
    const v = parseFloat(gAmount);
    if (!gName.trim() || !v || v <= 0) return;
    const dateStr = gDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    addGoal(gName.trim(), v, dateStr);
    setGName(''); setGAmount(''); setShowPicker(false);
    setGoalSheet(false);
  };

  const submitBudget = () => {
    const v = parseFloat(bLimit);
    const cat = BUDGET_CATEGORIES.find((c) => c.name === pickedCat);
    if (!cat || !v || v <= 0) return;
    const name = bName.trim() || cat.name;
    const due = bHasDue ? bDate.getTime() : undefined;
    if (editingId) updateBudget(editingId, name, v, cat.icon, cat.name, due);
    else addBudget(name, v, cat.icon, cat.name, due);
    setBudgetSheet(false);
  };

  const taken = new Set(categories.map((c) => c.category ?? c.name));

  // Budgets grouped under their base category, in first-seen order, so a
  // "Netflix" budget files visually under SUBSCRIPTIONS (and "Meralco" under
  // UTILITIES) instead of reading like its own top-level category.
  const budgetGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, typeof categories>();
    for (const c of categories) {
      const parent = c.category ?? c.name;
      if (!map.has(parent)) {
        map.set(parent, []);
        order.push(parent);
      }
      map.get(parent)!.push(c);
    }
    return order.map((parent) => ({ parent, items: map.get(parent)! }));
  }, [categories]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Goals and Budgets</Text>
            <Text style={styles.subtitle}>Set your financial targets</Text>
          </View>
          <Pressable onPress={() => (tab === 0 ? setGoalSheet(true) : openNewBudget())}>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.addBtn}>
              <Ionicons name="add" size={20} color={t.onEmerald} />
            </LinearGradient>
          </Pressable>
        </View>

        {/* Smooth Goals | Budgets switch */}
        <View style={styles.segWrap} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
          {segW > 0 && (
            <Animated.View
              style={[
                styles.segIndicator,
                {
                  width: (segW - 8) / 2,
                  transform: [{
                    translateX: segAnim.interpolate({ inputRange: [0, 1], outputRange: [0, (segW - 8) / 2] }),
                  }],
                },
              ]}
            >
              <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 999 }} />
            </Animated.View>
          )}
          {TABS.map((label, i) => (
            <Pressable key={label} style={styles.segBtn} onPress={() => switchTab(i as 0 | 1)}>
              <Text style={[styles.segText, tab === i && { color: t.onEmerald }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Animated.View style={{ opacity: fade }}>
          {tab === 0 ? (
            <View style={{ gap: 16, paddingBottom: 132 }}>
              {goals.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No goals yet</Text>
                  <Text style={styles.emptySub}>Name what you are saving for and Cents will defend it against impulse purchases.</Text>
                  <Pressable onPress={() => setGoalSheet(true)}>
                    <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.emptyBtn}>
                      <Ionicons name="flag" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Create a goal</Text>
                    </LinearGradient>
                  </Pressable>
                </GlassCard>
              )}
              {goals.map((g) => {
                const pct = Math.min(g.current / g.target, 1);
                const reached = g.current >= g.target;
                // M5.6 truth pass: pace from the real 28-day savings rate.
                const pace = paceLabel(g.target, g.current, weeklyRate);
                return (
                  <GlassCard key={g.id} glow={pct >= 0.8}>
                    <View style={styles.goalHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.goalName}>{g.name}</Text>
                        <Text style={styles.goalDate}>Target date · {g.date}</Text>
                      </View>
                      {reached ? (
                        <View style={styles.reachedChip}>
                          <Ionicons name="checkmark-circle" size={13} color={t.emerald} />
                          <Text style={styles.reachedChipText}>Reached</Text>
                        </View>
                      ) : (
                        <Text style={styles.goalPct}>{Math.round(pct * 100)}%</Text>
                      )}
                      <Pressable style={styles.trash} onPress={() => removeGoal(g.id)}>
                        <Ionicons name="trash-outline" size={15} color={t.red} />
                      </Pressable>
                    </View>
                    <TrajectoryCurve width={CARD_W - 40} progress={pct} />
                    <View style={styles.goalFooter}>
                      <View>
                        <Text style={styles.statLabel}>Saved</Text>
                        <Text style={styles.statValue}>{peso(g.current)}</Text>
                      </View>
                      <View>
                        <Text style={styles.statLabel}>Target</Text>
                        <Text style={styles.statValue}>{peso(g.target)}</Text>
                      </View>
                      <View>
                        <Text style={styles.statLabel}>At current pace</Text>
                        <Text style={[styles.statValue, { color: t.mint }]}>{pace}</Text>
                      </View>
                    </View>
                    <Pressable style={styles.addSavingsBtn} onPress={() => openAddSavings(g.id)}>
                      <Ionicons name="add-circle" size={16} color={t.emerald} />
                      <Text style={styles.addSavingsText}>Add savings</Text>
                    </Pressable>
                  </GlassCard>
                );
              })}
            </View>
          ) : (
            <View style={{ gap: 12, paddingBottom: 132 }}>
              {categories.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No budgets yet</Text>
                  <Text style={styles.emptySub}>Pick a category and give every peso a job.</Text>
                  <Pressable onPress={openNewBudget}>
                    <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.emptyBtn}>
                      <Ionicons name="wallet" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Create a budget</Text>
                    </LinearGradient>
                  </Pressable>
                </GlassCard>
              )}
              {budgetGroups.map(({ parent, items }) => {
                // Header only when the group is a real family: multiple
                // budgets, or one whose name differs from its base category
                // (e.g. "Netflix" under SUBSCRIPTIONS). A plain "Gaming"
                // budget stays a single clean card, exactly as before.
                const showHeader = items.length > 1 || items[0].name !== parent;
                const groupSpent = items.reduce((a, c) => a + c.spent, 0);
                const groupLimit = items.reduce((a, c) => a + c.limit, 0);
                return (
                  <View key={parent} style={{ gap: 10 }}>
                    {showHeader && (
                      <View style={styles.groupHead}>
                        <Text style={styles.groupName}>{parent.toUpperCase()}</Text>
                        <Text style={styles.groupTotals}>{peso(groupSpent)} of {peso(groupLimit)}</Text>
                      </View>
                    )}
                    {items.map((c) => {
                      const pct = Math.min(c.spent / c.limit, 1);
                      const maxed = pct >= 1;
                      return (
                        <Pressable key={c.id} onPress={() => openEditBudget(c.id)}>
                          <GlassCard pad={16}>
                            <View style={styles.budgetRow}>
                              <View style={[styles.budgetIcon, maxed && { backgroundColor: t.redTint, borderColor: 'rgba(255,77,77,0.35)' }]}>
                                <Ionicons name={(c.icon as any) || 'pricetag'} size={18} color={maxed ? t.red : t.emerald} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.budgetName}>{c.name}</Text>
                                <Text style={styles.budgetSub}>
                                  {peso(c.spent)} of {peso(c.limit)} monthly
                                  {c.dueDate ? ` · due ${new Date(c.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                                </Text>
                              </View>
                              <Text style={[styles.budgetLeft, maxed && { color: t.red }]}>
                                {maxed ? 'Maxed' : `${peso(c.limit - c.spent)} left`}
                              </Text>
                              <Pressable style={styles.trash} onPress={() => removeBudget(c.id)}>
                                <Ionicons name="trash-outline" size={15} color={t.red} />
                              </Pressable>
                            </View>
                            <View style={styles.track}>
                              <LinearGradient
                                colors={maxed ? [t.red, '#FF8A8A'] : [t.forest, t.emerald]}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                                style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%` }]}
                              />
                            </View>
                          </GlassCard>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Goal sheet */}
      <Modal visible={goalSheet} transparent animationType="slide" onRequestClose={() => setGoalSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setGoalSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: goalDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...goalDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.sheetTitle}>New goal</Text>
              <TextInput style={styles.input} placeholder="Goal name (e.g. Japan Trip)" placeholderTextColor={t.textMuted} value={gName} onChangeText={setGName} returnKeyType="done" />
              <MoneyInput value={gAmount} onChangeText={setGAmount} placeholder="Target amount" />
              <Pressable
                style={styles.dateRow}
                onPress={() => { Keyboard.dismiss(); setShowPicker((v) => !v); }}
              >
                <Ionicons name="calendar" size={17} color={t.emerald} />
                <Text style={styles.dateText}>
                  {gDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Ionicons name={showPicker ? 'chevron-up' : 'chevron-down'} size={15} color={t.textMuted} />
              </Pressable>
              {showPicker && (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={gDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    themeVariant={t.mode}
                    onChange={(_, d) => {
                      if (Platform.OS !== 'ios') setShowPicker(false);
                      if (d) setGDate(d);
                    }}
                  />
                </View>
              )}
              <Pressable onPress={submitGoal}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Create goal</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
            </Animated.View>
        </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Session A: Add savings sheet. Amount + optional source account.
          "Track only" leaves balances alone; picking a source debits it with
          the app-wide clamp at zero. Drag responder on the grab zone ONLY. */}
      <Modal visible={!!savingGoal} transparent animationType="slide" onRequestClose={() => setSavingGoalId(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setSavingGoalId(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: saveDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...saveDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.sheetTitle}>Add savings</Text>
              <Text style={styles.sheetSub}>
                {savingGoal ? `Move money toward ${savingGoal.name}. ${peso(savingGoal.current)} of ${peso(savingGoal.target)} saved so far.` : ''}
              </Text>
              <MoneyInput value={saveAmount} onChangeText={setSaveAmount} placeholder="Amount to set aside" autoFocus />
              <Text style={styles.sourceLabel}>TAKE IT FROM</Text>
              <View style={styles.sourceGrid}>
                <Pressable
                  style={[styles.sourceChip, sourceId === null && styles.sourceChipSel]}
                  onPress={() => setSourceId(null)}
                >
                  <Ionicons name="create-outline" size={14} color={sourceId === null ? t.onEmerald : t.emerald} />
                  <Text style={[styles.sourceChipText, sourceId === null && { color: t.onEmerald }]}>Track only</Text>
                </Pressable>
                {accounts.map((a) => {
                  const selected = sourceId === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      style={[styles.sourceChip, selected && styles.sourceChipSel]}
                      onPress={() => setSourceId(a.id)}
                    >
                      <Text style={[styles.sourceChipText, selected && { color: t.onEmerald }]}>{a.name}</Text>
                      <Text style={[styles.sourceChipBal, selected && { color: t.onEmerald, opacity: 0.85 }]}>{peso(a.balance)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {sourceAcct && saveVal > sourceAcct.balance && (
                <Text style={styles.sourceWarn}>
                  This is more than {sourceAcct.name} holds. Its balance will stop at zero.
                </Text>
              )}
              {sourceId === null && (
                <Text style={styles.sourceNote}>
                  Track only records the savings without touching an account balance.
                </Text>
              )}
              <Pressable onPress={submitSavings}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Add savings</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Budget sheet: category picker */}
      <Modal visible={budgetSheet} transparent animationType="slide" onRequestClose={() => setBudgetSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setBudgetSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: budgetDrag.drag }] }}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.grabZone} {...budgetDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.sheetTitle}>{editingId ? 'Edit budget' : 'New budget'}</Text>
              <Text style={styles.sheetSub}>
                Pick a category, then name it and set a monthly limit. Cents files expenses into these automatically.
              </Text>
              <View style={styles.catGrid}>
                {BUDGET_CATEGORIES.map((c) => {
                  const selected = pickedCat === c.name;
                  const disabled = !selected && taken.has(c.name) && (!editingId || (categories.find((x) => x.id === editingId)?.category ?? categories.find((x) => x.id === editingId)?.name) !== c.name);
                  return (
                    <Pressable
                      key={c.name}
                      disabled={disabled}
                      onPress={() => pickCategory(c.name)}
                      style={[styles.catChip, selected && styles.catChipSel, disabled && { opacity: 0.35 }]}
                    >
                      <Ionicons name={c.icon as any} size={14} color={selected ? t.onEmerald : t.emerald} />
                      <Text style={[styles.catChipText, selected && { color: t.onEmerald }]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={styles.input}
                placeholder={pickedCat ? `Budget name (${pickedCat})` : 'Budget name'}
                placeholderTextColor={t.textMuted}
                value={bName}
                onChangeText={setBName}
                returnKeyType="done"
              />
              <MoneyInput value={bLimit} onChangeText={setBLimit} placeholder="Monthly limit" />
              <View style={styles.dueToggleRow}>
                <Pressable
                  style={[styles.dueToggle, bHasDue && styles.dueToggleOn]}
                  onPress={() => { setBHasDue((v) => !v); setShowBPicker(false); }}
                >
                  <Ionicons name={bHasDue ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={bHasDue ? t.onEmerald : t.textMuted} />
                  <Text style={[styles.dueToggleText, bHasDue && { color: t.onEmerald }]}>Has a due date</Text>
                </Pressable>
                {bHasDue && (
                  <Pressable style={styles.dueDateBtn} onPress={() => { Keyboard.dismiss(); setShowBPicker((v) => !v); }}>
                    <Ionicons name="calendar" size={14} color={t.emerald} />
                    <Text style={styles.dueDateText}>
                      {bDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                    </Text>
                  </Pressable>
                )}
              </View>
              {bHasDue && showBPicker && (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={bDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    themeVariant={t.mode}
                    onChange={(_, d) => {
                      if (Platform.OS !== 'ios') setShowBPicker(false);
                      if (d) setBDate(d);
                    }}
                  />
                </View>
              )}
              <Pressable onPress={submitBudget}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>{editingId ? 'Save changes' : 'Create budget'}</Text>
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
  dueToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dueToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  dueToggleOn: { backgroundColor: t.emerald, borderColor: t.emerald },
  dueToggleText: { color: t.textMuted, fontSize: 13, fontWeight: '700' },
  dueDateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  dueDateText: { color: t.emerald, fontSize: 13, fontWeight: '800' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: t.textMuted, fontSize: 13, marginTop: 3 },
  groupHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, marginTop: 6, marginBottom: -2,
  },
  groupName: { color: t.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  groupTotals: { color: t.textMuted, fontSize: 11, fontWeight: '700' },
  addBtn: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    shadowColor: t.emerald, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  segWrap: {
    flexDirection: 'row', padding: 4, borderRadius: 999, marginBottom: 20,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  segIndicator: { position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: 999 },
  segBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  segText: { color: t.textMuted, fontSize: 13, fontWeight: '800' },
  emptyTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySub: { color: t.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  goalName: { color: t.textPrimary, fontSize: 18, fontWeight: '800' },
  goalDate: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  goalPct: { color: t.emerald, fontSize: 22, fontWeight: '800' },
  goalFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  statLabel: { color: t.textMuted, fontSize: 11 },
  statValue: { color: t.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 2 },
  reachedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  reachedChipText: { color: t.emerald, fontSize: 12, fontWeight: '800' },
  addSavingsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 44, borderRadius: radius.input, marginTop: 14,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  addSavingsText: { color: t.emerald, fontSize: 14, fontWeight: '800' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 46, borderRadius: radius.input, marginTop: 16,
  },
  emptyBtnText: { color: t.onEmerald, fontSize: 14, fontWeight: '800' },
  sourceLabel: { color: t.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, paddingHorizontal: 2 },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  sourceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
  },
  sourceChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  sourceChipText: { color: t.textPrimary, fontSize: 13, fontWeight: '700' },
  sourceChipBal: { color: t.textMuted, fontSize: 11.5, fontWeight: '700' },
  sourceWarn: { color: t.amber, fontSize: 12, lineHeight: 17, marginBottom: 12, paddingHorizontal: 2 },
  sourceNote: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12, paddingHorizontal: 2 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  budgetIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  // M5.27: unified list type scale (matches the Analytics ledger rows).
  budgetName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  budgetSub: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  budgetLeft: { color: t.mint, fontSize: 12, fontWeight: '800' },
  track: { height: 7, borderRadius: 4, backgroundColor: t.trackBg, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  trash: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },

  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  sheetSub: { color: t.textMuted, fontSize: 12, marginBottom: 14, lineHeight: 17 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
  },
  catChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  catChipText: { color: t.textPrimary, fontSize: 12, fontWeight: '700' },
  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 52, borderRadius: radius.input, paddingHorizontal: 14, marginBottom: 12,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  dateText: { color: t.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  pickerWrap: {
    borderRadius: radius.input, marginBottom: 12, overflow: 'hidden',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  input: {
    height: 50, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 15,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, marginBottom: 12,
  },
  submit: { height: 52, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },
});