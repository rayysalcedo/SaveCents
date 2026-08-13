// Planner v1 (hub layout). This tab is no longer "Goals and Budgets": it is
// the user's money PLANNER. A hub of four sections:
//   Goals   · deadline-driven saving (the motivational core of the app)
//   Budgets · monthly envelopes with due dates (resets via rolloverBudgetsIfNeeded)
//   Split   · split a bill with people + email their share      (next build)
//   Lend    · track money lent out, due dates, at-risk total    (next build)
// The route stays `goals` so every existing deep link keeps working; the
// `tab` param now accepts goals | budgets | split | lend.
//
// Goals upgrade in this pass: every goal with a deadline gets a PLAN: the
// real weekly amount needed to make the date, compared to the user's real
// 28-day savings rate (goalPlan in src/utils/stats.ts), plus a suggested
// weekly contribution shortcut in the Add savings sheet. Milestone
// notifications (25/50/75/100) were already wired through addToGoal.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Easing, Image, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, UIManager, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { GlassCard } from '../../src/components/GlassCard';
import { MoneyInput } from '../../src/components/MoneyInput';
import { TrajectoryCurve } from '../../src/components/Charts';
import { Palette, radius, useTheme, type } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { CADENCE_NOUN, cadenceAsk, cadenceRate, goalPlan, paceLabel, weeklySavingsRate } from '../../src/utils/stats';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { Lend, peso, SaveCadence, SplitBill, uid, Category } from '../../src/models/types';
import { openLendMail, payloadFor, sendLendReminder } from '../../src/services/lend';
import {
  createRemoteSplit, fetchRemoteSplitState, openSplitMail, pushRemoteSplitTick, remoteSplitUrl, sendSplitEmail, SplitEmailPayload,
} from '../../src/services/split';
import { BUDGET_CATEGORIES } from '../../src/data/countries';
import { AccountSelect } from '../../src/components/AccountSelect';

const CARD_W = Dimensions.get('window').width - 48;

// Lend rows expand in place with the same easing the Wallet cards use.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Keyboard rule: sheets must always fit the VISIBLE area. A static height
// cap overflows off the top the moment the keyboard opens, cutting off the
// header with no way to scroll to it. This tracks the keyboard as a plain
// number so every sheet can shrink to what is actually on screen.
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'ios') {
      const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
        setH(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY));
      });
      return () => sub.remove();
    }
    const s1 = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const s2 = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => { s1.remove(); s2.remove(); };
  }, []);
  return h;
}

type PlannerView = 'hub' | 'goals' | 'budgets' | 'split' | 'lend';

const SECTION_META: Record<Exclude<PlannerView, 'hub'>, { title: string; subtitle: string }> = {
  goals: { title: 'Goals', subtitle: 'Save toward a deadline' },
  budgets: { title: 'Budgets', subtitle: 'Monthly limits and due dates' },
  split: { title: 'Split a bill', subtitle: 'Share a charge fairly' },
  lend: { title: 'Lend', subtitle: 'Money out, and when it comes back' },
};

export default function PlannerScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  // Keyboard aware sheet cap: 78% of the window normally, and whatever
  // actually fits above the keyboard while typing. The KAV lifts the sheet;
  // this keeps its top ON screen so the inner scroll can reach everything.
  const kbHeight = useKeyboardHeight();
  const winH = Dimensions.get('window').height;
  const sheetCap = {
    maxHeight: kbHeight > 0
      ? Math.max(Math.round(winH - kbHeight - 70), 300)
      : Math.round(winH * 0.78),
  };

  // Perf rule: subscribe to slices, never the whole store. This screen only
  // re-renders when data IT shows changes, not on every chat or sync tick.
  const goals = useFinance((s) => s.goals);
  const accounts = useFinance((s) => s.accounts);
  const country = useFinance((s) => s.country);
  const categories = useFinance((s) => s.categories);
  const transactions = useFinance((s) => s.transactions);
  const selectedGoalId = useFinance((s) => s.selectedGoalId);
  const splits = useFinance((s) => s.splits);
  const profile = useFinance((s) => s.profile);
  // Actions are stable references in zustand; selecting them individually
  // never causes a re-render.
  const addGoal = useFinance((s) => s.addGoal);
  const removeGoal = useFinance((s) => s.removeGoal);
  const addToGoal = useFinance((s) => s.addToGoal);
  const selectGoal = useFinance((s) => s.selectGoal);
  const addBudget = useFinance((s) => s.addBudget);
  const updateBudget = useFinance((s) => s.updateBudget);
  const removeBudget = useFinance((s) => s.removeBudget);
  const addSplit = useFinance((s) => s.addSplit);
  const updateSplit = useFinance((s) => s.updateSplit);
  const removeSplit = useFinance((s) => s.removeSplit);
  const markSplitPersonPaid = useFinance((s) => s.markSplitPersonPaid);
  const unmarkSplitPersonPaid = useFinance((s) => s.unmarkSplitPersonPaid);
  const paySplitMyShare = useFinance((s) => s.paySplitMyShare);
  const unpaySplitMyShare = useFinance((s) => s.unpaySplitMyShare);
  const setSplitRemote = useFinance((s) => s.setSplitRemote);
  const applyRemoteSplitState = useFinance((s) => s.applyRemoteSplitState);
  const markSplitEmailed = useFinance((s) => s.markSplitEmailed);
  const lends = useFinance((s) => s.lends);
  const addLend = useFinance((s) => s.addLend);
  const updateLend = useFinance((s) => s.updateLend);
  const removeLend = useFinance((s) => s.removeLend);
  const markLendRepaid = useFinance((s) => s.markLendRepaid);
  const unmarkLendRepaid = useFinance((s) => s.unmarkLendRepaid);
  // The dashboard's Goal insight follows the starred goal; with nothing
  // starred yet it falls back to the first goal, so mirror that here.
  const starredId = selectedGoalId ?? goals[0]?.id ?? null;
  const weeklyRate = useMemo(() => weeklySavingsRate(transactions), [transactions]);

  // Hub <-> section navigation
  const [view, setView] = useState<PlannerView>('hub');
  const fade = useRef(new Animated.Value(1)).current;

  const go = (next: PlannerView) => {
    if (next === view) return;
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
    setTimeout(() => setView(next), 110);
  };

  // Deep link support: Home's Manage buttons jump straight into a section.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (tabParam === 'budgets' || tabParam === 'goals' || tabParam === 'split' || tabParam === 'lend') {
      if (view !== tabParam) go(tabParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  // Goal sheet state
  const [goalSheet, setGoalSheet] = useState(false);
  const [gName, setGName] = useState('');
  const [gAmount, setGAmount] = useState('');
  const [gDate, setGDate] = useState<Date>(new Date(Date.now() + 180 * 86400000));
  const [gCadence, setGCadence] = useState<SaveCadence>('weekly');
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
  // Planner v1.1: the suggested amount speaks the goal's own rhythm, so a
  // daily saver sees today's number and a monthly saver sees the month's.
  const savingPlan = savingGoal ? goalPlan(savingGoal, weeklyRate) : null;
  const savingCadence: SaveCadence = savingGoal?.cadence ?? 'weekly';
  const savingAsk = savingPlan && savingGoal
    ? cadenceAsk(savingPlan, savingGoal.target - savingGoal.current, savingCadence)
    : null;
  const suggested = savingAsk != null && savingAsk > 0 ? Math.ceil(savingAsk) : null;
  const suggestedLabel = savingCadence === 'daily' ? "Today's save" : savingCadence === 'monthly' ? "This month's save" : "This week's save";

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
  // Planner v2.1: monthly is the default because most bills repeat. Monthly
  // only needs a day of the month; one time gets the full calendar.
  const [bDueMode, setBDueMode] = useState<'monthly' | 'once'>('monthly');
  const [bDueDay, setBDueDay] = useState(15);
  const [bDate, setBDate] = useState<Date>(new Date(Date.now() + 14 * 86400000));
  // Planner v2: 7-3-1 due date reminders, on by default for dated budgets.
  const [bRemind, setBRemind] = useState(true);
  // Planner v2.3: auto-pay for monthly bills, off by default. bAutoAcct is
  // the account that pays.
  const [bAutoPay, setBAutoPay] = useState(false);
  const [bAutoAcct, setBAutoAcct] = useState<string | null>(null);
  const [bError, setBError] = useState<string | null>(null);
  const [showBPicker, setShowBPicker] = useState(false);

  // v5.38: the add button is segment-aware - Bills preset the due toggle
  // on (a bill without a due date is not a bill), Spending preset it off.
  // The sheet's own toggle still lets the user change their mind.
  const openNewBudget = (flavor: 'bills' | 'spending' = 'spending') => {
    setEditingId(null); setPickedCat(null); setBName(''); setBLimit('');
    setBHasDue(flavor === 'bills'); setBDueMode('monthly'); setBDueDay(new Date().getDate());
    setBDate(new Date(Date.now() + 14 * 86400000)); setBRemind(true); setBAutoPay(false); setBAutoAcct(null); setBError(null); setShowBPicker(false);
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
    setBDueMode(c.dueType === 'once' ? 'once' : 'monthly');
    setBDueDay(c.dueDay ?? (c.dueDate ? new Date(c.dueDate).getDate() : new Date().getDate()));
    setBDate(c.dueDate ? new Date(c.dueDate) : new Date(Date.now() + 14 * 86400000));
    setBRemind(c.remind !== false);
    setBAutoPay(!!c.autoPay);
    setBAutoAcct(c.autoPayAccountId ?? null);
    setBError(null);
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
    // Display string keeps the old shape; the real timestamp rides alongside
    // so goalPlan never has to guess.
    const dateStr = gDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    addGoal(gName.trim(), v, dateStr, gDate.getTime(), gCadence);
    setGName(''); setGAmount(''); setGCadence('weekly'); setShowPicker(false);
    setGoalSheet(false);
  };

  // Planner v3.2: split the bill sheet state. Who paid drives everything:
  // 'me' logs the total from an account now and repayments as they land;
  // 'other' mints a private manage link for the payer. sCount includes
  // everyone; the owing rows exclude the payer and (in other mode) the user.
  const [splitSheet, setSplitSheet] = useState(false);
  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);
  const [sTitle, setSTitle] = useState('');
  const [sTotal, setSTotal] = useState('');
  const [sCount, setSCount] = useState(2);
  const [sMode, setSMode] = useState<'me' | 'other'>('me');
  const [sAcct, setSAcct] = useState<string | null>(null);
  const [sPayer, setSPayer] = useState('');
  const [sPayerEmail, setSPayerEmail] = useState('');
  const [sIncludeMe, setSIncludeMe] = useState(true);
  // Planner v5 (owner request): people are not always splitting evenly. In
  // 'custom' each owing person gets their own amount and the payer covers
  // whatever is left of the total.
  const [sKind, setSKind] = useState<'even' | 'custom'>('even');
  const [sMyShare, setSMyShare] = useState('');
  const [sPeople, setSPeople] = useState<{ id: string; name: string; email: string; amount: string }[]>([{ id: uid(), name: '', email: '', amount: '' }]);
  const [sError, setSError] = useState<string | null>(null);
  const splitDrag = useDragToDismiss(() => setSplitSheet(false));
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const myName = profile.nickname || profile.name || 'Me';

  // The receive/pay-my-share account picker.
  const [pickTarget, setPickTarget] = useState<
    { kind: 'receive'; splitId: string; personId: string; personName: string; amount: number } |
    { kind: 'myshare'; splitId: string; amount: number } |
    { kind: 'lendRepaid'; lendId: string; personName: string; amount: number } | null
  >(null);
  const [pickAcct, setPickAcct] = useState<string | null>(null);

  const owingRowsFor = (count: number, mode: 'me' | 'other', includeMe: boolean) =>
    Math.max(count - 1 - (mode === 'other' && includeMe ? 1 : 0), 0);

  const syncRows = (count: number, mode: 'me' | 'other', includeMe: boolean) => {
    const want = owingRowsFor(count, mode, includeMe);
    setSPeople((rows) => {
      if (rows.length === want) return rows;
      if (rows.length < want) return [...rows, ...Array.from({ length: want - rows.length }, () => ({ id: uid(), name: '', email: '', amount: '' }))];
      return rows.slice(0, want);
    });
  };

  const openNewSplit = () => {
    setEditingSplitId(null);
    setSTitle(''); setSTotal(''); setSCount(2); setSMode('me'); setSAcct(null);
    setSPayer(''); setSPayerEmail(''); setSIncludeMe(true);
    setSKind('even'); setSMyShare('');
    setSPeople([{ id: uid(), name: '', email: '', amount: '' }]);
    setSError(null);
    setSplitSheet(true);
  };

  const openEditSplit = (bill: SplitBill) => {
    setEditingSplitId(bill.id);
    setSTitle(bill.title);
    setSTotal(String(bill.total));
    setSCount(bill.headcount);
    const mode = bill.mode === 'other' ? 'other' : 'me';
    setSMode(mode);
    setSAcct(bill.payerAccountId ?? null);
    setSPayer(mode === 'other' ? bill.payerName : '');
    setSPayerEmail(bill.payerEmail ?? '');
    setSIncludeMe(mode === 'other' ? !!bill.myShare?.included : true);
    const custom = bill.splitKind === 'custom';
    setSKind(custom ? 'custom' : 'even');
    setSMyShare(custom && bill.myShareAmount != null ? String(bill.myShareAmount) : '');
    setSPeople(bill.people.map((pp) => ({ id: pp.id, name: pp.name, email: pp.email ?? '', amount: custom ? String(pp.share) : '' })));
    setSError(null);
    setSplitSheet(true);
  };

  const setCount = (n: number) => {
    const next = Math.min(Math.max(n, 2), 12);
    setSCount(next);
    syncRows(next, sMode, sIncludeMe);
  };
  const setMode = (m: 'me' | 'other') => {
    setSMode(m);
    setSError(null);
    syncRows(sCount, m, sIncludeMe);
  };
  const setIncludeMe = (v: boolean) => {
    setSIncludeMe(v);
    syncRows(sCount, sMode, v);
  };

  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // After saving an other-mode split, mint (or refresh) its manage link.
  const mintRemote = async (billId: string, input: {
    title: string; total: number; headcount: number; payerName: string; payerEmail?: string;
    includeMe: boolean; people: { id: string; name: string; share?: number }[];
    even: boolean; myShareAmount?: number;
  }) => {
    const share = Math.round((input.total / input.headcount) * 100) / 100;
    const res = await createRemoteSplit({
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      userName: myName,
      title: input.title,
      totalFmt: peso(input.total),
      shareFmt: peso(share),
      headcount: input.headcount,
      people: input.people.map((p) => ({ id: p.id, name: p.name, shareFmt: peso(p.share ?? share) })),
      includeUser: input.includeMe,
      userLabel: myName,
      userShareFmt: input.includeMe ? peso(input.myShareAmount ?? share) : undefined,
      even: input.even,
    });
    if (res) {
      setSplitRemote(billId, res.token);
      if (input.payerEmail) {
        Alert.alert(
          res.emailed ? 'Link sent' : 'Link ready',
          res.emailed
            ? `${input.payerName} got their tracker link by email.`
            : `The link is ready but the email did not go out. Use the share button on the card to send it yourself.`,
        );
      }
    } else {
      Alert.alert('No link yet', 'Could not create the manage link. Tap "Get manage link" on the card to retry.');
    }
  };

  const submitSplit = () => {
    const total = parseFloat(sTotal) || 0;
    if (!(total > 0)) { setSError('Put in the total that was charged.'); return; }
    if (sMode === 'me' && !sAcct) { setSError('Pick which account this came out of.'); return; }
    const payer = sMode === 'me' ? myName : (sPayer.trim() || 'The payer');
    if (sMode === 'other' && sPayerEmail.trim() && !emailOk(sPayerEmail.trim())) {
      setSError('The payer email does not look right.'); return;
    }
    const rows = sPeople.map((r) => ({ id: r.id, name: r.name.trim(), email: r.email.trim(), amount: parseFloat(r.amount) || 0 }));
    if (rows.some((r) => !r.name)) { setSError('Every person needs at least a name.'); return; }
    const badMail = rows.find((r) => r.email && !emailOk(r.email));
    if (badMail) { setSError(`${badMail.name}'s email does not look right.`); return; }
    // Planner v5: custom shares must be real and must fit inside the total;
    // the payer absorbs whatever is left.
    const custom = sKind === 'custom';
    const myShareNum = parseFloat(sMyShare) || 0;
    if (custom) {
      const noAmount = rows.find((r) => !(r.amount > 0));
      if (noAmount) { setSError(`Put in the amount ${noAmount.name} is paying.`); return; }
      if (sMode === 'other' && sIncludeMe && !(myShareNum > 0)) { setSError('Put in your own share.'); return; }
      const assigned = rows.reduce((a, r) => a + r.amount, 0) + (sMode === 'other' && sIncludeMe ? myShareNum : 0);
      if (assigned > total + 0.005) {
        setSError(`The shares add up to ${peso(assigned)}, more than the ${peso(total)} total.`);
        return;
      }
    }

    const id = editingSplitId ?? uid();
    const input = {
      id,
      title: sTitle.trim() || 'Shared bill',
      total,
      headcount: sCount,
      mode: sMode,
      payerName: payer,
      payerEmail: sMode === 'other' ? sPayerEmail.trim() || undefined : undefined,
      payerAccountId: sMode === 'me' ? sAcct ?? undefined : undefined,
      includeMe: sMode === 'other' ? sIncludeMe : undefined,
      splitKind: sKind,
      myShareAmount: custom && sMode === 'other' && sIncludeMe ? myShareNum : undefined,
      people: rows.map((r) => ({ id: r.id, name: r.name, email: r.email || undefined, share: custom ? r.amount : undefined })),
    };
    if (editingSplitId) updateSplit(editingSplitId, input);
    else addSplit(input);
    setSplitSheet(false);
    if (sMode === 'other') {
      // Fire and forget; failures alert with a retry path on the card.
      mintRemote(id, {
        title: input.title, total, headcount: sCount, payerName: payer, payerEmail: input.payerEmail,
        includeMe: sIncludeMe, people: rows.map((r) => ({ id: r.id, name: r.name, share: custom ? r.amount : undefined })),
        even: !custom, myShareAmount: custom ? myShareNum : undefined,
      });
    }
  };

  // Ticking people. Me mode: money comes IN, so ask which account received
  // it. Other mode: a plain tick, pushed to the payer's page. Legacy: plain.
  const onTickPerson = (bill: SplitBill, personId: string) => {
    const person = bill.people.find((x) => x.id === personId);
    if (!person) return;
    if (!person.paid) {
      if (bill.mode === 'me') {
        setPickAcct(bill.payerAccountId ?? accounts[0]?.id ?? null);
        setPickTarget({ kind: 'receive', splitId: bill.id, personId, personName: person.name, amount: person.share });
      } else {
        markSplitPersonPaid(bill.id, personId);
        if (bill.remoteToken) pushRemoteSplitTick(bill.remoteToken, { pid: personId, paid: true });
      }
    } else {
      unmarkSplitPersonPaid(bill.id, personId);
      if (bill.mode === 'other' && bill.remoteToken) pushRemoteSplitTick(bill.remoteToken, { pid: personId, paid: false });
    }
  };

  const onTickMyShare = (bill: SplitBill) => {
    if (!bill.myShare) return;
    // Planner v5: custom bills store the user's own share explicitly.
    const share = bill.myShareAmount ?? bill.people[0]?.share ?? Math.round((bill.total / bill.headcount) * 100) / 100;
    if (!bill.myShare.paid) {
      setPickAcct(accounts[0]?.id ?? null);
      setPickTarget({ kind: 'myshare', splitId: bill.id, amount: share });
    } else {
      unpaySplitMyShare(bill.id);
      if (bill.remoteToken) pushRemoteSplitTick(bill.remoteToken, { mine: false });
    }
  };

  const confirmPick = () => {
    if (!pickTarget || !pickAcct) return;
    if (pickTarget.kind === 'lendRepaid') {
      markLendRepaid(pickTarget.lendId, pickAcct === 'none' ? undefined : pickAcct);
      setPickTarget(null);
      return;
    }
    const bill = splits.find((b) => b.id === pickTarget.splitId);
    if (pickTarget.kind === 'receive') {
      markSplitPersonPaid(pickTarget.splitId, pickTarget.personId, pickAcct);
    } else {
      paySplitMyShare(pickTarget.splitId, pickAcct);
      if (bill?.remoteToken) pushRemoteSplitTick(bill.remoteToken, { mine: true });
    }
    setPickTarget(null);
  };

  const shareLink = async (bill: SplitBill) => {
    if (!bill.remoteToken) return;
    try {
      await Share.share({ message: `Tick people off as they pay you for ${bill.title}: ${remoteSplitUrl(bill.remoteToken)}` });
    } catch { /* user closed the share sheet, nothing to do */ }
  };

  // Pull the payer's ticks every time the Split section opens.
  useEffect(() => {
    if (view !== 'split') return;
    for (const b of splits) {
      if (b.mode === 'other' && b.remoteToken) {
        fetchRemoteSplitState(b.remoteToken).then((remote) => {
          if (remote) applyRemoteSplitState(b.id, remote);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Send one person their share: worker email first, the user's own mail
  // app as the fallback so it works even before the worker is redeployed.
  const emailShare = async (bill: SplitBill, personId: string) => {
    const person = bill.people.find((x) => x.id === personId);
    if (!person?.email) return;
    const key = `${bill.id}:${personId}`;
    setSendingKey(key);
    const payload: SplitEmailPayload = {
      email: person.email,
      name: person.name,
      userName: myName,
      payerName: bill.mode === 'other' ? bill.payerName : myName,
      title: bill.title,
      totalFmt: peso(bill.total),
      shareFmt: peso(person.share),
      headcount: bill.headcount,
      even: bill.splitKind !== 'custom',
    };
    const result = await sendSplitEmail(payload);
    if (result === 'sent') {
      markSplitEmailed(bill.id, personId);
      Alert.alert('Sent', `${person.name} got their share (${peso(person.share)}) by email.`);
    } else {
      const opened = await openSplitMail(payload);
      if (opened) {
        markSplitEmailed(bill.id, personId);
      } else {
        Alert.alert(
          'Could not send',
          'The email service did not respond and no mail app could open. Check your internet, and make sure the worker is deployed (wrangler deploy in the worker folder), then try again.',
        );
      }
    }
    setSendingKey(null);
  };

  // Planner v4: Lend sheet state. Money out with a name, a due date, and an
  // optional email whose automatic reminders need the consent toggle.
  const [lendSheet, setLendSheet] = useState(false);
  const [editingLendId, setEditingLendId] = useState<string | null>(null);
  const [lName, setLName] = useState('');
  const [lEmail, setLEmail] = useState('');
  const [lConsent, setLConsent] = useState(false);
  const [lAmount, setLAmount] = useState('');
  const [lDate, setLDate] = useState<Date>(new Date(Date.now() + 30 * 86400000));
  const [showLPicker, setShowLPicker] = useState(false);
  const [lAcct, setLAcct] = useState<string | null>(null);
  const [lError, setLError] = useState<string | null>(null);
  const lendDrag = useDragToDismiss(() => setLendSheet(false));
  // Which lend is expanded in place. Tap the row to open, tap again to close.
  const [openLendId, setOpenLendId] = useState<string | null>(null);
  const toggleLendOpen = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    setOpenLendId((cur) => (cur === id ? null : id));
  };

  const openNewLend = () => {
    setEditingLendId(null);
    setLName(''); setLEmail(''); setLConsent(false); setLAmount('');
    setLDate(new Date(Date.now() + 30 * 86400000)); setShowLPicker(false);
    setLAcct(null); setLError(null);
    setLendSheet(true);
  };
  const openEditLend = (l: Lend) => {
    setEditingLendId(l.id);
    setLName(l.name); setLEmail(l.email ?? ''); setLConsent(!!l.consent);
    setLAmount(String(l.amount));
    setLDate(new Date(l.dueDate)); setShowLPicker(false);
    setLAcct(l.accountId ?? null); setLError(null);
    setLendSheet(true);
  };
  const submitLend = () => {
    const amount = parseFloat(lAmount) || 0;
    if (!lName.trim()) { setLError('Who borrowed it? A name is needed.'); return; }
    if (!(amount > 0)) { setLError('Put in the amount they borrowed.'); return; }
    if (lEmail.trim() && !emailOk(lEmail.trim())) { setLError('That email does not look right.'); return; }
    const input = {
      id: editingLendId ?? uid(),
      name: lName.trim(),
      email: lEmail.trim() || undefined,
      amount,
      dueDate: lDate.getTime(),
      accountId: lAcct ?? undefined,
      consent: lEmail.trim() ? lConsent : undefined,
    };
    if (editingLendId) updateLend(editingLendId, input);
    else addLend(input);
    setLendSheet(false);
  };

  const onTickLend = (l: Lend) => {
    if (!l.repaid) {
      setPickAcct(l.accountId ?? accounts[0]?.id ?? null);
      setPickTarget({ kind: 'lendRepaid', lendId: l.id, personName: l.name, amount: l.amount });
    } else {
      unmarkLendRepaid(l.id);
    }
  };

  // Manual nudge from the card: worker email, mail app fallback, and always
  // a clear result either way.
  const nudgeLend = async (l: Lend) => {
    const payload = payloadFor(l, myName);
    if (!payload) return;
    setSendingKey(`lend:${l.id}`);
    const result = await sendLendReminder(payload);
    if (result === 'sent') {
      Alert.alert('Sent', `${l.name} got a friendly reminder about ${peso(l.amount)}.`);
    } else {
      const opened = await openLendMail(payload);
      if (!opened) {
        Alert.alert('Could not send', 'The email service did not respond and no mail app could open. Check your internet and try again.');
      }
    }
    setSendingKey(null);
  };

  // Planner v2.1: monthly dues live on a day of the month.
  // Planner v2.1: monthly dues live on a day of the month. Next occurrence
  // is this month if that day is still ahead, otherwise next month, always
  // clamped so day 31 works in short months.
  const nextMonthlyDue = (day: number) => {
    const now = new Date();
    const build = (y: number, m: number) => {
      const last = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(day, last));
      d.setHours(12, 0, 0, 0);
      return d;
    };
    let d = build(now.getFullYear(), now.getMonth());
    if (d.getTime() <= now.getTime()) d = build(now.getFullYear(), now.getMonth() + 1);
    return d.getTime();
  };

  const submitBudget = () => {
    const v = parseFloat(bLimit);
    const cat = BUDGET_CATEGORIES.find((c) => c.name === pickedCat);
    if (!cat || !v || v <= 0) return;
    const name = bName.trim() || cat.name;
    // Same-name budgets confuse expense filing (it matches by name), so ask
    // for a unique name instead of failing silently like the store would.
    const clash = categories.some((c) => c.id !== editingId && c.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      setBError(`You already have a budget called ${name}. Give this one its own name, like "${name} 2" or something more specific.`);
      return;
    }
    const due = bHasDue ? (bDueMode === 'monthly' ? nextMonthlyDue(bDueDay) : bDate.getTime()) : undefined;
    const remind = bHasDue ? bRemind : undefined;
    const dueType = bHasDue ? bDueMode : undefined;
    const dueDay = bHasDue && bDueMode === 'monthly' ? bDueDay : undefined;
    // Auto-pay only makes sense for monthly dues, and it needs a payer.
    const autoOn = bHasDue && bDueMode === 'monthly' && bAutoPay;
    if (autoOn && !bAutoAcct) {
      setBError('Pick which account pays this automatically, or turn auto-pay off.');
      return;
    }
    const autoPay = autoOn || undefined;
    const autoAcct = autoOn ? bAutoAcct ?? undefined : undefined;
    if (editingId) updateBudget(editingId, name, v, cat.icon, cat.name, due, remind, dueType, dueDay, autoPay, autoAcct);
    else addBudget(name, v, cat.icon, cat.name, due, remind, dueType, dueDay, autoPay, autoAcct);
    setBudgetSheet(false);
  };

  // Budgets grouped under their base category, in first-seen order, so a
  // "Netflix" budget files visually under SUBSCRIPTIONS (and "Meralco" under
  // UTILITIES) instead of reading like its own top-level category.
  // v5.38 (owner decision): the Budgets view splits into two segments.
  // A BILL is a budget with a due date (or a credit card statement, which
  // always gets one) - an obligation where hitting the limit means PAID.
  // SPENDING is the undated envelope - a ceiling where the limit means stop.
  // The due date IS the discriminator: no new data field, so Cents intents,
  // rollover, sync and the statement sweep all keep working untouched, and
  // adding/removing a due date in the editor moves a budget between tabs.
  const billCats = useMemo(
    () => categories
      .filter((c) => !!c.dueDate || !!c.creditAccountId)
      .sort((a, b) => (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER)),
    [categories],
  );
  const spendCats = useMemo(
    () => categories.filter((c) => !c.dueDate && !c.creditAccountId),
    [categories],
  );
  const [budgetSegPick, setBudgetSegPick] = useState<'bills' | 'spending' | null>(null);
  const budgetSeg: 'bills' | 'spending' = budgetSegPick ?? (billCats.length > 0 ? 'bills' : 'spending');

  const budgetGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, typeof categories>();
    for (const c of spendCats) {
      const parent = c.category ?? c.name;
      if (!map.has(parent)) {
        map.set(parent, []);
        order.push(parent);
      }
      map.get(parent)!.push(c);
    }
    return order.map((parent) => ({ parent, items: map.get(parent)! }));
  }, [spendCats]);

  // Hub summaries: live one-liners so the hub reads like a status board
  const starredGoal = goals.find((g) => g.id === starredId);
  // v5.42 (owner request): the planner speaks in the same Cents strip as
  // Home and Trends, above the section cards. Findings first, nudges last.
  const plannerNote = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const openBills = billCats
      .filter((c) => c.dueDate && c.spent < c.limit)
      .sort((a, b) => a.dueDate! - b.dueDate!);
    if (openBills.length > 0) {
      const b = openBills[0];
      const left = peso(Math.max(b.limit - b.spent, 0));
      const days = Math.round((new Date(b.dueDate!).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
      const when = days < 0
        ? `was due ${new Date(b.dueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} and is still open`
        : days === 0 ? 'is due today'
        : days === 1 ? 'is due tomorrow'
        : `is due ${new Date(b.dueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      return `Your ${b.name} bill (${left} left) ${when}. That's the next one to knock out.`;
    }
    if (billCats.length > 0) {
      const maxedEnv = spendCats.find((c) => c.limit > 0 && c.spent >= c.limit);
      if (maxedEnv) return `Bills are all settled, but your ${maxedEnv.name} budget is maxed - anything more spills into next month.`;
      return 'All bills are settled for the month. Breathe easy.';
    }
    const maxedEnv = spendCats.find((c) => c.limit > 0 && c.spent >= c.limit);
    if (maxedEnv) return `Your ${maxedEnv.name} budget just hit its limit. Anything more spills into next month.`;
    if (goals.length === 0) return 'Start with a goal: a name, an amount and a date. Cents plans the saving around it.';
    if (starredGoal) return `Cents is defending ${starredGoal.name}. Everything here feeds that finish line.`;
    return 'Star a goal and Cents will defend it against impulse buys.';
  }, [billCats, spendCats, goals, starredGoal]);

  const goalsSummary = goals.length === 0
    ? 'Set your first target'
    : starredGoal
      ? `${goals.length} active · ${starredGoal.name} ${Math.min(Math.round((starredGoal.current / starredGoal.target) * 100), 100)}% there`
      : `${goals.length} active`;
  const openSplits = splits.filter((b) => b.people.some((pp) => !pp.paid) || (b.myShare?.included && !b.myShare.paid));
  // Money owed to YOU: unpaid shares on bills you covered (other people's
  // bills are their money to chase, not yours).
  const owedToUser = splits
    .filter((b) => b.mode !== 'other')
    .reduce((a, b) => a + b.people.filter((pp) => !pp.paid).reduce((x, pp) => x + pp.share, 0), 0);
  const splitSummary = splits.length === 0
    ? 'Divide a charge, email each share'
    : openSplits.length === 0
      ? 'All settled'
      : owedToUser > 0
        ? `${openSplits.length} open \u00b7 ${peso(owedToUser)} to collect`
        : `${openSplits.length} open`;
  const lendOut = lends.filter((l) => !l.repaid);
  const lendOutstanding = lendOut.reduce((a, l) => a + l.amount, 0);
  const lendOverdue = lendOut.filter((l) => l.dueDate < Date.now()).reduce((a, l) => a + l.amount, 0);
  const lendBack = lends.filter((l) => l.repaid).reduce((a, l) => a + l.amount, 0);
  const lendSummary = lends.length === 0
    ? 'Track money out and due dates'
    : lendOut.length === 0
      ? 'All paid back'
      : `${peso(lendOutstanding)} out${lendOverdue > 0 ? ` \u00b7 ${peso(lendOverdue)} at risk` : ''}`;
  const thisMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const totalSpent = categories.reduce((a, c) => a + c.spent, 0);
  const totalLimit = categories.reduce((a, c) => a + c.limit, 0);
  const billSpent = billCats.reduce((a, c) => a + c.spent, 0);
  const billLimit = billCats.reduce((a, c) => a + c.limit, 0);
  const spendSpent = spendCats.reduce((a, c) => a + c.spent, 0);
  const spendLimit = spendCats.reduce((a, c) => a + c.limit, 0);
  const dueSoon = categories.filter((c) => c.dueDate && c.dueDate > Date.now() && c.dueDate < Date.now() + 7 * 86400000).length;
  const budgetsSummary = categories.length === 0
    ? 'Give every peso a job'
    : `${peso(totalSpent)} of ${peso(totalLimit)} this month${dueSoon > 0 ? ` \u00b7 ${dueSoon} due soon` : ''}`;

  const headerAdd = () => {
    if (view === 'goals') setGoalSheet(true);
    else if (view === 'budgets') openNewBudget(budgetSeg);
    else if (view === 'split') openNewSplit();
    else if (view === 'lend') openNewLend();
  };

  const meta = view === 'hub' ? null : SECTION_META[view];

  // Shared card renderer for both segments (plain function, not a component).
  const renderBudgetCard = (c: Category) => {
    const pct = Math.min(c.spent / c.limit, 1);
    const maxed = pct >= 1;
    // v5.35: a dated budget is a bill - fully spent = PAID, a win, never
    // the red alarm undated envelopes get.
    const paid = maxed && !!c.dueDate;
    const alarm = maxed && !paid;
    return (
      <Pressable key={c.id} onPress={() => openEditBudget(c.id)}>
        <GlassCard pad={16}>
          <View style={styles.budgetRow}>
            <View style={[styles.budgetIcon, alarm && { backgroundColor: t.redTint, borderColor: 'rgba(255,77,77,0.35)' }]}>
              <Ionicons name={(c.icon as any) || 'pricetag'} size={18} color={alarm ? t.red : t.emerald} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={styles.budgetName} numberOfLines={1}>{c.name}</Text>
                {!!c.dueDate && c.remind !== false && (
                  <Ionicons name="notifications" size={12} color={t.textFaint} />
                )}
                {c.autoPay && (
                  <Ionicons name="flash" size={12} color={t.emerald} />
                )}
              </View>
              <Text style={styles.budgetSub}>
                {peso(c.spent)} of {peso(c.limit)} monthly
                {c.dueDate
                  ? c.dueType === 'once'
                    ? ` · due ${new Date(c.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : ` · due every ${ordinal(c.dueDay ?? new Date(c.dueDate).getDate())}`
                  : ''}
              </Text>
              {/* Auto-pay flagged this month but not yet settled: it is
                  waiting on balance. */}
              {c.autoPay && c.autoPayFailNotified === thisMonthKey && c.autoPayLast !== thisMonthKey && (
                <Text style={styles.autoWaitText}>
                  Auto-pay waiting, {accounts.find((a) => a.id === c.autoPayAccountId)?.name ?? 'its account'} cannot cover it yet
                </Text>
              )}
            </View>
            <Text style={[styles.budgetLeft, alarm && { color: t.red }, paid && { color: t.emerald }]}>
              {paid ? 'Paid' : maxed ? 'Maxed' : `${peso(c.limit - c.spent)} left`}
            </Text>
            <Pressable style={styles.trash} onPress={() => removeBudget(c.id)}>
              <Ionicons name="trash-outline" size={15} color={t.red} />
            </Pressable>
          </View>
          <View style={styles.track}>
            <View
              style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: alarm ? t.red : t.emerald }]}
            />
          </View>
        </GlassCard>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" removeClippedSubviews>
        <View style={styles.header}>
          {view !== 'hub' && (
            <Pressable style={styles.backBtn} onPress={() => go('hub')} hitSlop={8} accessibilityLabel="Back to Planner">
              <Ionicons name="chevron-back" size={20} color={t.textPrimary} />
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{meta ? meta.title : 'Planner'}</Text>
            <Text style={styles.subtitle}>{meta ? meta.subtitle : 'Your money, managed in one place'}</Text>
          </View>
          {view !== 'hub' && (
            <Pressable onPress={headerAdd}>
              <View style={[styles.addBtn, { backgroundColor: t.emerald }]}>
                <Ionicons name="add" size={20} color={t.onEmerald} />
              </View>
            </Pressable>
          )}
        </View>

        <Animated.View style={{ opacity: fade }}>
          {view === 'hub' && (
            <View style={{ paddingBottom: 132 }}>
              <View style={styles.plannerCentsBlock}>
                <View style={styles.plannerCentsHead}>
                  <Image source={require('../../assets/cents-mark.png')} style={{ width: 13, height: 13 }} resizeMode="contain" />
                  <Text style={styles.plannerCentsEyebrow}>CENTS</Text>
                </View>
                <Text style={styles.plannerCentsMsg}>{plannerNote}</Text>
              </View>
              <View style={styles.hubGrid}>
                <HubCard
                  styles={styles} t={t}
                  icon="flag" title="Goals" summary={goalsSummary}
                  onPress={() => go('goals')}
                />
                <HubCard
                  styles={styles} t={t}
                  icon="wallet" title="Budgets" summary={budgetsSummary}
                  onPress={() => go('budgets')}
                />
                <HubCard
                  styles={styles} t={t}
                  icon="people" title="Split a bill" summary={splitSummary}
                  onPress={() => go('split')}
                />
                <HubCard
                  styles={styles} t={t}
                  icon="hand-left" title="Lend" summary={lendSummary}
                  onPress={() => go('lend')}
                />
              </View>
            </View>
          )}

          {view === 'goals' && (
            <View style={{ gap: 16, paddingBottom: 132 }}>
              {goals.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No goals yet</Text>
                  <Text style={styles.emptySub}>Name what you are saving for and Cents will defend it against impulse purchases.</Text>
                  <Pressable onPress={() => setGoalSheet(true)}>
                    <View style={[styles.emptyBtn, { backgroundColor: t.emerald }]}>
                      <Ionicons name="flag" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Create a goal</Text>
                    </View>
                  </Pressable>
                </GlassCard>
              )}
              {goals.map((g) => {
                const pct = Math.min(g.current / g.target, 1);
                const reached = g.current >= g.target;
                // M5.6 truth pass: pace from the real 28-day savings rate.
                const pace = paceLabel(g.target, g.current, weeklyRate);
                // Planner v1.1: the plan in the goal's own saving rhythm.
                const plan = goalPlan(g, weeklyRate);
                const cad: SaveCadence = g.cadence ?? 'weekly';
                const ask = cadenceAsk(plan, g.target - g.current, cad);
                const myRate = cadenceRate(weeklyRate, cad);
                const noun = CADENCE_NOUN[cad];
                const planDate = plan.deadline
                  ? new Date(plan.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : null;
                return (
                  <GlassCard key={g.id} glow={pct >= 0.8}>
                    <View style={styles.goalHeader}>
                      {/* v4.1: star = "show this goal on my dashboard".
                          Exactly one goal is starred at a time. */}
                      <Pressable
                        hitSlop={8}
                        onPress={() => selectGoal(g.id)}
                        style={({ pressed }) => [styles.starBtn, pressed && { opacity: 0.6 }]}
                        accessibilityLabel={starredId === g.id ? 'Featured on dashboard' : 'Feature on dashboard'}
                      >
                        <Ionicons
                          name={starredId === g.id ? 'star' : 'star-outline'}
                          size={18}
                          color={starredId === g.id ? t.amber : t.textFaint}
                        />
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.goalName}>{g.name}</Text>
                        <Text style={styles.goalDate}>
                          {starredId === g.id ? 'On your dashboard · ' : ''}Target date · {g.date}
                        </Text>
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

                    {/* Planner v1.1: THE PLAN. The honest ask in the rhythm
                        the user picked, with an on track or behind verdict
                        from their real 28 day rate. This line is the whole
                        reason the Goals section exists. */}
                    {plan.status === 'onTrack' && ask != null && (
                      <View style={[styles.planRow, { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}>
                        <Ionicons name="trending-up" size={15} color={t.emerald} />
                        <Text style={[styles.planText, { color: t.emerald }]}>
                          On track. Keep putting in {peso(Math.ceil(ask))} {noun} and you'll make it by {planDate}.
                        </Text>
                      </View>
                    )}
                    {plan.status === 'behind' && ask != null && (
                      <View style={[styles.planRow, { backgroundColor: 'rgba(217,119,6,0.10)', borderColor: 'rgba(217,119,6,0.30)' }]}>
                        <Ionicons name="alert-circle" size={15} color={t.amber} />
                        <Text style={[styles.planText, { color: t.amber }]}>
                          Needs {peso(Math.ceil(ask))} {noun} to hit {planDate}. Right now you're averaging {myRate > 0 ? `${peso(Math.round(myRate))} ${noun}` : 'nothing yet'}.
                        </Text>
                      </View>
                    )}
                    {plan.status === 'pastDue' && (
                      <View style={[styles.planRow, { backgroundColor: t.redTint, borderColor: 'rgba(220,38,38,0.30)' }]}>
                        <Ionicons name="time" size={15} color={t.red} />
                        <Text style={[styles.planText, { color: t.red }]}>
                          Deadline passed with {peso(g.target - g.current)} to go. It still counts, keep adding.
                        </Text>
                      </View>
                    )}

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
          )}

          {view === 'budgets' && (
            <View style={{ gap: 12, paddingBottom: 132 }}>
              {/* v5.38 (owner decision): Bills and Spending are different
                  animals - obligations vs ceilings - so they get their own
                  segments instead of one mixed list. */}
              <View style={styles.segRow}>
                <Pressable
                  style={[styles.segChip, budgetSeg === 'bills' && styles.segChipSel]}
                  onPress={() => setBudgetSegPick('bills')}
                >
                  <Ionicons name="calendar" size={14} color={budgetSeg === 'bills' ? t.onEmerald : t.emerald} />
                  <Text style={[styles.segText, budgetSeg === 'bills' && { color: t.onEmerald }]}>Bills</Text>
                  {billCats.length > 0 && (
                    <Text style={[styles.segCount, budgetSeg === 'bills' && { color: t.onEmerald, opacity: 0.85 }]}>{billCats.length}</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.segChip, budgetSeg === 'spending' && styles.segChipSel]}
                  onPress={() => setBudgetSegPick('spending')}
                >
                  <Ionicons name="wallet" size={14} color={budgetSeg === 'spending' ? t.onEmerald : t.emerald} />
                  <Text style={[styles.segText, budgetSeg === 'spending' && { color: t.onEmerald }]}>Spending</Text>
                  {spendCats.length > 0 && (
                    <Text style={[styles.segCount, budgetSeg === 'spending' && { color: t.onEmerald, opacity: 0.85 }]}>{spendCats.length}</Text>
                  )}
                </Pressable>
              </View>

              {budgetSeg === 'bills' && billCats.length > 0 && (() => {
                const pct = billLimit > 0 ? Math.min(billSpent / billLimit, 1) : 1;
                const done = billLimit > 0 && billSpent >= billLimit;
                return (
                  <GlassCard pad={16} glow={done}>
                    <View style={styles.totalsHead}>
                      <Text style={styles.totalsTitle}>THIS MONTH</Text>
                      <Text style={styles.totalsPct}>
                        {billLimit > 0 ? `${Math.round((billSpent / billLimit) * 100)}%` : ''}
                      </Text>
                    </View>
                    <Text style={styles.totalsLine}>
                      <Text style={styles.totalsPaid}>{peso(billSpent)}</Text>
                      <Text style={styles.totalsOf}> paid of </Text>
                      <Text style={styles.totalsBudgeted}>{peso(billLimit)}</Text>
                      <Text style={styles.totalsOf}> in bills</Text>
                    </Text>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: t.emerald }]} />
                    </View>
                    <Text style={styles.totalsSub}>
                      {done ? 'All bills paid for the month. Breathe easy.' : `${peso(billLimit - billSpent)} left to pay`}
                    </Text>
                  </GlassCard>
                );
              })()}
              {budgetSeg === 'spending' && spendCats.length > 0 && (() => {
                const over = spendSpent > spendLimit;
                const pct = spendLimit > 0 ? Math.min(spendSpent / spendLimit, 1) : 1;
                return (
                  <GlassCard pad={16}>
                    <View style={styles.totalsHead}>
                      <Text style={styles.totalsTitle}>THIS MONTH</Text>
                      <Text style={[styles.totalsPct, over && { color: t.red }]}>
                        {spendLimit > 0 ? `${Math.round((spendSpent / spendLimit) * 100)}%` : ''}
                      </Text>
                    </View>
                    <Text style={styles.totalsLine}>
                      <Text style={[styles.totalsPaid, over && { color: t.red }]}>{peso(spendSpent)}</Text>
                      <Text style={styles.totalsOf}> spent of </Text>
                      <Text style={styles.totalsBudgeted}>{peso(spendLimit)}</Text>
                      <Text style={styles.totalsOf}> planned</Text>
                    </Text>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: over ? t.red : t.emerald }]} />
                    </View>
                    <Text style={styles.totalsSub}>
                      {over
                        ? `${peso(spendSpent - spendLimit)} over the plan`
                        : `${peso(spendLimit - spendSpent)} left to spend`}
                    </Text>
                  </GlassCard>
                );
              })()}

              {budgetSeg === 'bills' && billCats.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No bills yet</Text>
                  <Text style={styles.emptySub}>Rent, utilities, subscriptions - anything with a deadline. A credit card with a billing day lands its statement here on its own.</Text>
                  <Pressable onPress={() => openNewBudget('bills')}>
                    <View style={[styles.emptyBtn, { backgroundColor: t.emerald }]}>
                      <Ionicons name="calendar" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Add your first bill</Text>
                    </View>
                  </Pressable>
                </GlassCard>
              )}
              {budgetSeg === 'spending' && spendCats.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No spending budgets yet</Text>
                  <Text style={styles.emptySub}>Pick a category and give every peso a job.</Text>
                  <Pressable onPress={() => openNewBudget('spending')}>
                    <View style={[styles.emptyBtn, { backgroundColor: t.emerald }]}>
                      <Ionicons name="wallet" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Create a budget</Text>
                    </View>
                  </Pressable>
                </GlassCard>
              )}

              {budgetSeg === 'bills' && billCats.map((c) => renderBudgetCard(c))}
              {budgetSeg === 'spending' && budgetGroups.map(({ parent, items }) => {
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
                    {items.map((c) => renderBudgetCard(c))}
                  </View>
                );
              })}

            </View>
          )}

          {view === 'split' && (
            <View style={{ gap: 16, paddingBottom: 132 }}>
              {splits.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>No splits yet</Text>
                  <Text style={styles.emptySub}>Total, who paid, how many people. Everyone gets emailed their share.</Text>
                  <Pressable onPress={openNewSplit}>
                    <View style={[styles.emptyBtn, { backgroundColor: t.emerald }]}>
                      <Ionicons name="people" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Split a bill</Text>
                    </View>
                  </Pressable>
                </GlassCard>
              )}
              {splits.map((b) => {
                const myRow = b.mode === 'other' && b.myShare?.included ? 1 : 0;
                const settled = b.people.filter((pp) => pp.paid).length + (myRow && b.myShare?.paid ? 1 : 0);
                const totalRows = b.people.length + myRow;
                const allDone = totalRows > 0 && settled === totalRows;
                const custom = b.splitKind === 'custom';
                const share = b.people[0]?.share ?? Math.round((b.total / b.headcount) * 100) / 100;
                const myShareAmt = b.myShareAmount ?? share;
                const paidLine = b.mode === 'me'
                  ? `you paid from ${accounts.find((a) => a.id === b.payerAccountId)?.name ?? 'your account'}`
                  : `${b.payerName} paid`;
                return (
                  <GlassCard key={b.id} glow={allDone}>
                    <View style={styles.goalHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.goalName}>{b.title}</Text>
                        <Text style={styles.goalDate}>
                          {custom
                            ? `${peso(b.total)} · custom shares · ${paidLine}`
                            : `${peso(b.total)} ÷ ${b.headcount} = ${peso(share)} each · ${paidLine}`}
                        </Text>
                      </View>
                      {allDone ? (
                        <View style={styles.reachedChip}>
                          <Ionicons name="checkmark-circle" size={13} color={t.emerald} />
                          <Text style={styles.reachedChipText}>Settled</Text>
                        </View>
                      ) : (
                        <Text style={styles.splitCount}>{settled}/{totalRows}</Text>
                      )}
                      <Pressable style={styles.editBtn} onPress={() => openEditSplit(b)} accessibilityLabel="Edit split">
                        <Ionicons name="pencil" size={14} color={t.emerald} />
                      </Pressable>
                      <Pressable style={styles.trash} onPress={() => removeSplit(b.id)}>
                        <Ionicons name="trash-outline" size={15} color={t.red} />
                      </Pressable>
                    </View>
                    <View style={{ gap: 8 }}>
                      {myRow === 1 && b.myShare && (
                        <View style={styles.splitPersonRow}>
                          <Pressable hitSlop={6} onPress={() => onTickMyShare(b)} accessibilityLabel={b.myShare.paid ? 'Mark my share unpaid' : 'Pay my share'}>
                            <Ionicons name={b.myShare.paid ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={b.myShare.paid ? t.emerald : t.textFaint} />
                          </Pressable>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.splitPersonName, b.myShare.paid && styles.splitPersonPaid]}>You</Text>
                            {!b.myShare.paid && (
                              <Text style={styles.splitPersonMail}>tap to pay {b.payerName} your part</Text>
                            )}
                          </View>
                          <Text style={[styles.splitShare, b.myShare.paid && styles.splitPersonPaid]}>{peso(myShareAmt)}</Text>
                        </View>
                      )}
                      {b.people.map((pp) => {
                        const busy = sendingKey === `${b.id}:${pp.id}`;
                        return (
                          <View key={pp.id} style={styles.splitPersonRow}>
                            <Pressable hitSlop={6} onPress={() => onTickPerson(b, pp.id)} accessibilityLabel={pp.paid ? 'Mark unpaid' : 'Mark paid'}>
                              <Ionicons name={pp.paid ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={pp.paid ? t.emerald : t.textFaint} />
                            </Pressable>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.splitPersonName, pp.paid && styles.splitPersonPaid]} numberOfLines={1}>{pp.name}</Text>
                              {!!pp.email && (
                                <Text style={styles.splitPersonMail} numberOfLines={1}>{pp.email}{pp.emailedAt ? ' \u00b7 sent' : ''}</Text>
                              )}
                            </View>
                            <Text style={[styles.splitShare, pp.paid && styles.splitPersonPaid]}>{peso(pp.share)}</Text>
                            {!!pp.email && !pp.paid && (
                              <Pressable style={styles.splitMailBtn} disabled={busy} onPress={() => emailShare(b, pp.id)} accessibilityLabel={`Email ${pp.name} their share`}>
                                <Ionicons name={busy ? 'hourglass' : pp.emailedAt ? 'paper-plane' : 'paper-plane-outline'} size={15} color={t.emerald} />
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {b.mode === 'other' && (
                      b.remoteToken ? (
                        <Pressable style={styles.linkRow} onPress={() => shareLink(b)}>
                          <Ionicons name="link" size={14} color={t.emerald} />
                          <Text style={styles.linkRowText}>{b.payerName}'s tracker link · tap to share</Text>
                          <Ionicons name="share-outline" size={14} color={t.emerald} />
                        </Pressable>
                      ) : (
                        <Pressable
                          style={styles.linkRow}
                          onPress={() => mintRemote(b.id, {
                            title: b.title, total: b.total, headcount: b.headcount, payerName: b.payerName, payerEmail: b.payerEmail,
                            includeMe: !!b.myShare?.included,
                            people: b.people.map((pp) => ({ id: pp.id, name: pp.name, share: pp.share })),
                            even: b.splitKind !== 'custom',
                            myShareAmount: b.myShareAmount,
                          })}
                        >
                          <Ionicons name="link" size={14} color={t.amber} />
                          <Text style={[styles.linkRowText, { color: t.amber }]}>Get manage link</Text>
                        </Pressable>
                      )
                    )}
                    {!allDone && (
                      <Text style={styles.splitFootNote}>
                        {b.mode === 'me'
                          ? 'Tick people as they pay you back and pick where the money landed.'
                          : `${b.payerName} ticks people off from the link. It syncs here when you open this tab.`}
                      </Text>
                    )}
                  </GlassCard>
                );
              })}
            </View>
          )}

                    {view === 'lend' && (
            <View style={{ gap: 16, paddingBottom: 132 }}>
              {lends.length > 0 && (
                <GlassCard pad={16}>
                  <View style={styles.lendStatsRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statLabel}>Out right now</Text>
                      <Text style={styles.lendStatValue}>{peso(lendOutstanding)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statLabel}>At risk</Text>
                      <Text style={[styles.lendStatValue, { color: lendOverdue > 0 ? t.red : t.textPrimary }]}>{peso(lendOverdue)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statLabel}>Paid back</Text>
                      <Text style={[styles.lendStatValue, { color: t.emerald }]}>{peso(lendBack)}</Text>
                    </View>
                  </View>
                  {lendOutstanding > 0 && (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(Math.min((lendOverdue / lendOutstanding) * 100, 100), lendOverdue > 0 ? 4 : 0)}%`, backgroundColor: t.red }]} />
                    </View>
                  )}
                  <Text style={styles.splitFootNote}>
                    Unpaid past due is money lost. Paid back, it lands in your accounts and counts toward your savings.
                  </Text>
                </GlassCard>
              )}
              {lends.length === 0 && (
                <GlassCard>
                  <Text style={styles.emptyTitle}>Nothing lent out</Text>
                  <Text style={styles.emptySub}>Log money you lend with a due date. You get pinged before it's due, and it flows back into your savings when repaid.</Text>
                  <Pressable onPress={openNewLend}>
                    <View style={[styles.emptyBtn, { backgroundColor: t.emerald }]}>
                      <Ionicons name="hand-left" size={15} color={t.onEmerald} />
                      <Text style={styles.emptyBtnText}>Log a lend</Text>
                    </View>
                  </Pressable>
                </GlassCard>
              )}
              {lends.map((l) => {
                const daysLeft = Math.ceil((l.dueDate - Date.now()) / 86400000);
                const overdue = !l.repaid && daysLeft < 0;
                const dueLabel = new Date(l.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const dueFull = new Date(l.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const busy = sendingKey === `lend:${l.id}`;
                const open = openLendId === l.id;
                const fromAcct = l.accountId ? accounts.find((a) => a.id === l.accountId)?.name : null;
                const intoAcct = l.repaidTxId ? accounts.find((a) => a.id === (transactions.find((tx) => tx.id === l.repaidTxId)?.accountId))?.name : null;
                return (
                  <GlassCard key={l.id} pad={16} glow={l.repaid}>
                    <View style={styles.splitPersonRow}>
                      <Pressable hitSlop={6} onPress={() => onTickLend(l)} accessibilityLabel={l.repaid ? 'Mark not repaid' : 'Mark repaid'}>
                        <Ionicons name={l.repaid ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={l.repaid ? t.emerald : t.textFaint} />
                      </Pressable>
                      <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => toggleLendOpen(l.id)}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.splitPersonName, l.repaid && styles.splitPersonPaid]} numberOfLines={1}>{l.name}</Text>
                            {!!l.email && l.consent && !l.repaid && (
                              <Ionicons name="notifications" size={11} color={t.emerald} />
                            )}
                          </View>
                          <Text style={[styles.splitPersonMail, overdue && { color: t.red, fontWeight: '700' }]} numberOfLines={1}>
                            {l.repaid
                              ? `repaid${l.repaidAt ? ` ${new Date(l.repaidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
                              : overdue
                                ? `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} late \u00b7 due ${dueLabel}`
                                : `due ${dueLabel}${daysLeft <= 7 ? ` \u00b7 ${daysLeft === 0 ? 'today' : `in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}` : ''}`}
                          </Text>
                        </View>
                        <Text style={[styles.lendAmount, l.repaid && styles.splitPersonPaid, overdue && { color: t.red }]}>{peso(l.amount)}</Text>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={t.textFaint} />
                      </Pressable>
                    </View>

                    {open && (
                      <View style={styles.lendDetail}>
                        <View style={styles.lendDetailRow}>
                          <Text style={styles.lendDetailLabel}>Due date</Text>
                          <Text style={styles.lendDetailValue}>
                            {dueFull}
                            {!l.repaid && ` \u00b7 ${overdue ? `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} late` : daysLeft === 0 ? 'today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go`}`}
                          </Text>
                        </View>
                        <View style={styles.lendDetailRow}>
                          <Text style={styles.lendDetailLabel}>Left from</Text>
                          <Text style={styles.lendDetailValue}>{fromAcct ?? 'Track only, no account touched'}</Text>
                        </View>
                        {l.repaid && (
                          <View style={styles.lendDetailRow}>
                            <Text style={styles.lendDetailLabel}>Came back</Text>
                            <Text style={styles.lendDetailValue}>
                              {l.repaidAt ? new Date(l.repaidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'marked repaid'}
                              {intoAcct ? ` into ${intoAcct}` : ' \u00b7 tracked only'}
                            </Text>
                          </View>
                        )}
                        <View style={styles.lendDetailRow}>
                          <Text style={styles.lendDetailLabel}>Reminders</Text>
                          <Text style={styles.lendDetailValue}>
                            {l.email
                              ? l.consent
                                ? `emails ${l.name.split(' ')[0]} at 7, 3 and 1 days${l.sentStages?.length ? ` \u00b7 sent: ${[...l.sentStages].sort((a, b) => b - a).map((st) => `${st}d`).join(', ')}` : ''}`
                                : 'manual nudges only, you get the pings'
                              : 'no email, pings go to you'}
                          </Text>
                        </View>
                        {!!l.email && (
                          <View style={styles.lendDetailRow}>
                            <Text style={styles.lendDetailLabel}>Email</Text>
                            <Text style={styles.lendDetailValue} numberOfLines={1}>{l.email}</Text>
                          </View>
                        )}
                        <View style={styles.lendActions}>
                          {!!l.email && !l.repaid && (
                            <Pressable style={styles.lendActionBtn} disabled={busy} onPress={() => nudgeLend(l)}>
                              <Ionicons name={busy ? 'hourglass' : 'paper-plane-outline'} size={14} color={t.emerald} />
                              <Text style={styles.lendActionText}>Remind</Text>
                            </Pressable>
                          )}
                          <Pressable style={styles.lendActionBtn} onPress={() => openEditLend(l)}>
                            <Ionicons name="pencil" size={14} color={t.emerald} />
                            <Text style={styles.lendActionText}>Edit</Text>
                          </Pressable>
                          <Pressable style={[styles.lendActionBtn, styles.lendActionDanger]} onPress={() => removeLend(l.id)}>
                            <Ionicons name="trash-outline" size={14} color={t.red} />
                            <Text style={[styles.lendActionText, { color: t.red }]}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </GlassCard>
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
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.grabZone} {...goalDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>New goal</Text>
                <Pressable style={styles.closeBtn} onPress={() => setGoalSheet(false)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled>
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
              {/* Planner v1.1: how often will you actually add money? The
                  plan and suggestions speak in this rhythm from day one. */}
              <Text style={styles.sourceLabel}>I'LL SAVE</Text>
              <View style={styles.sourceGrid}>
                {(['daily', 'weekly', 'monthly'] as SaveCadence[]).map((c) => {
                  const sel = gCadence === c;
                  return (
                    <Pressable key={c} style={[styles.sourceChip, sel && styles.sourceChipSel]} onPress={() => setGCadence(c)}>
                      <Text style={[styles.sourceChipText, sel && { color: t.onEmerald }]}>
                        {c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : 'Monthly'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* Show the ask LIVE while creating, so the deadline choice is
                  made with eyes open. */}
              {(() => {
                const v = parseFloat(gAmount) || 0;
                if (!(v > 0)) return null;
                const weeks = Math.max((gDate.getTime() - Date.now()) / (7 * 86400000), 0.01);
                const units = gCadence === 'daily' ? weeks * 7 : gCadence === 'monthly' ? weeks / 4.345 : weeks;
                const per = Math.ceil(v / Math.max(units, 1));
                return (
                  <Text style={styles.goalPreview}>
                    That works out to about {peso(per)} {CADENCE_NOUN[gCadence]} between now and then.
                  </Text>
                );
              })()}
              </ScrollView>
              <Pressable onPress={submitGoal}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>Create goal</Text>
                </View>
              </Pressable>
            </View>
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
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.grabZone} {...saveDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Add savings</Text>
                <Pressable style={styles.closeBtn} onPress={() => setSavingGoalId(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.sheetSub}>
                {savingGoal ? `Move money toward ${savingGoal.name}. ${peso(savingGoal.current)} of ${peso(savingGoal.target)} saved so far.` : ''}
              </Text>
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled>
              <MoneyInput value={saveAmount} onChangeText={setSaveAmount} placeholder="Amount to set aside" autoFocus />
              {/* Planner v1.1: one tap fills the amount the plan asks for, in
                  the rhythm this goal was set up with. No mental math. */}
              {suggested != null && (
                <Pressable
                  style={[styles.suggestChip, saveAmount === String(suggested) && styles.suggestChipSel]}
                  onPress={() => setSaveAmount(String(suggested))}
                >
                  <Ionicons
                    name="flash"
                    size={13}
                    color={saveAmount === String(suggested) ? t.onEmerald : t.emerald}
                  />
                  <Text style={[styles.suggestChipText, saveAmount === String(suggested) && { color: t.onEmerald }]}>
                    {suggestedLabel}: {peso(suggested)}
                  </Text>
                </Pressable>
              )}
              <Text style={styles.sourceLabel}>TAKE IT FROM</Text>
              <AccountSelect
                accounts={accounts} country={country}
                value={sourceId} onChange={setSourceId}
                noneLabel="Track only"
                style={{ marginBottom: 12 }}
              />
              {sourceAcct && saveVal > availOf(sourceAcct) && (
                <Text style={styles.sourceWarn}>
                  That's more than {sourceAcct.name} can cover. It will stop at zero.
                </Text>
              )}
              {sourceId === null && (
                <Text style={styles.sourceNote}>
                  Track only records the savings without touching an account balance.
                </Text>
              )}
              </ScrollView>
              <Pressable onPress={submitSavings}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>Add savings</Text>
                </View>
              </Pressable>
            </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Planner v3.2: split a bill sheet. Who paid decides the fields:
          Me asks which account the money left; Someone else asks for their
          name and email and whether the user owes a share too. */}
      <Modal visible={splitSheet} transparent animationType="slide" onRequestClose={() => setSplitSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setSplitSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: splitDrag.drag }] }}>
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.grabZone} {...splitDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{editingSplitId ? 'Edit split' : 'Split a bill'}</Text>
                <Pressable style={styles.closeBtn} onPress={() => setSplitSheet(false)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled>
                <TextInput
                  style={styles.input}
                  placeholder="What's it for? (e.g. Dinner at Mesa)"
                  placeholderTextColor={t.textMuted}
                  value={sTitle}
                  onChangeText={(v) => { setSTitle(v); setSError(null); }}
                  returnKeyType="done"
                />
                <MoneyInput value={sTotal} onChangeText={(v) => { setSTotal(v); setSError(null); }} placeholder="Total charged" />
                <View style={styles.splitCountRow}>
                  <Text style={styles.sourceLabel}>PEOPLE (EVERYONE)</Text>
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => setCount(sCount - 1)} hitSlop={6}>
                      <Ionicons name="remove" size={16} color={t.emerald} />
                    </Pressable>
                    <Text style={styles.stepVal}>{sCount}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => setCount(sCount + 1)} hitSlop={6}>
                      <Ionicons name="add" size={16} color={t.emerald} />
                    </Pressable>
                  </View>
                </View>
                {/* Planner v5 (owner request): not every bill splits evenly.
                    Custom lets each person owe exactly what they got; the
                    payer covers whatever is left of the total. */}
                <Text style={styles.sourceLabel}>HOW TO SPLIT</Text>
                <View style={styles.dueModeRow}>
                  <Pressable style={[styles.dueModeChip, sKind === 'even' && styles.dueModeChipSel]} onPress={() => { setSKind('even'); setSError(null); }}>
                    <Ionicons name="reorder-four" size={14} color={sKind === 'even' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, sKind === 'even' && { color: t.onEmerald }]}>Evenly</Text>
                  </Pressable>
                  <Pressable style={[styles.dueModeChip, sKind === 'custom' && styles.dueModeChipSel]} onPress={() => { setSKind('custom'); setSError(null); }}>
                    <Ionicons name="options" size={14} color={sKind === 'custom' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, sKind === 'custom' && { color: t.onEmerald }]}>Custom amounts</Text>
                  </Pressable>
                </View>
                {(() => {
                  const total = parseFloat(sTotal) || 0;
                  if (!(total > 0)) return null;
                  if (sKind === 'even') {
                    const share = Math.round((total / sCount) * 100) / 100;
                    return (
                      <View style={styles.splitMathBox}>
                        <Text style={styles.splitMathText}>
                          {peso(total)} ÷ {sCount} = <Text style={{ color: t.emerald, fontWeight: '800' }}>{peso(share)} each</Text>
                        </Text>
                      </View>
                    );
                  }
                  // Custom: live tally of assigned amounts vs the total. The
                  // remainder is what the payer is covering out of their own
                  // pocket (me mode: you; other mode: the named payer).
                  const assigned = sPeople.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                    + (sMode === 'other' && sIncludeMe ? parseFloat(sMyShare) || 0 : 0);
                  const remainder = total - assigned;
                  const over = remainder < -0.005;
                  const payerLabel = sMode === 'me' ? 'you cover' : `${sPayer.trim() || 'the payer'} covers`;
                  return (
                    <View style={styles.splitMathBox}>
                      <Text style={[styles.splitMathText, over && { color: t.red }]}>
                        {over
                          ? `Shares add up to ${peso(assigned)}, over the ${peso(total)} total`
                          : <>
                              {peso(assigned)} of {peso(total)} assigned · <Text style={{ color: t.emerald, fontWeight: '800' }}>{payerLabel} {peso(Math.max(remainder, 0))}</Text>
                            </>}
                      </Text>
                    </View>
                  );
                })()}

                <Text style={styles.sourceLabel}>WHO PAID?</Text>
                <View style={styles.dueModeRow}>
                  <Pressable style={[styles.dueModeChip, sMode === 'me' && styles.dueModeChipSel]} onPress={() => setMode('me')}>
                    <Ionicons name="person" size={14} color={sMode === 'me' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, sMode === 'me' && { color: t.onEmerald }]}>Me</Text>
                  </Pressable>
                  <Pressable style={[styles.dueModeChip, sMode === 'other' && styles.dueModeChipSel]} onPress={() => setMode('other')}>
                    <Ionicons name="people" size={14} color={sMode === 'other' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, sMode === 'other' && { color: t.onEmerald }]}>Someone else</Text>
                  </Pressable>
                </View>

                {sMode === 'me' && (
                  <>
                    <Text style={styles.sourceLabel}>PAID FROM</Text>
                    <AccountSelect
                      accounts={accounts} country={country}
                      value={sAcct} onChange={(id) => { setSAcct(id); setSError(null); }}
                      placeholder="Which account paid the bill?"
                      style={{ marginBottom: 12 }}
                    />
                    <Text style={styles.remindHintFull}>
                      The full amount logs as an expense now. Each repayment logs as income when you tick it.
                    </Text>
                  </>
                )}

                {sMode === 'other' && (
                  <>
                    <View style={styles.splitPersonInputs}>
                      <TextInput
                        style={[styles.input, styles.splitNameInput]}
                        placeholder="Their name"
                        placeholderTextColor={t.textMuted}
                        value={sPayer}
                        onChangeText={(v) => { setSPayer(v); setSError(null); }}
                        returnKeyType="done"
                      />
                      <TextInput
                        style={[styles.input, styles.splitMailInput]}
                        placeholder="Their email (optional)"
                        placeholderTextColor={t.textMuted}
                        value={sPayerEmail}
                        onChangeText={(v) => { setSPayerEmail(v); setSError(null); }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        returnKeyType="done"
                      />
                    </View>
                    <View style={styles.dueToggleRow}>
                      <Pressable style={[styles.dueToggle, sIncludeMe && styles.dueToggleOn]} onPress={() => setIncludeMe(!sIncludeMe)}>
                        <Ionicons name={sIncludeMe ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={sIncludeMe ? t.onEmerald : t.textMuted} />
                        <Text style={[styles.dueToggleText, sIncludeMe && { color: t.onEmerald }]}>I owe a share too</Text>
                      </Pressable>
                    </View>
                    {sIncludeMe && sKind === 'custom' && (
                      <View style={styles.splitPersonInputs}>
                        <View style={[styles.input, styles.splitNameInput, styles.splitFakeField]}>
                          <Text style={styles.splitFakeFieldText}>Your share</Text>
                        </View>
                        <TextInput
                          style={[styles.input, styles.splitAmtInput]}
                          placeholder="Amount"
                          placeholderTextColor={t.textMuted}
                          value={sMyShare}
                          onChangeText={(v) => { setSMyShare(v.replace(/[^\d.]/g, '')); setSError(null); }}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                        />
                      </View>
                    )}
                    <Text style={styles.remindHintFull}>
                      They get a private link to tick people off as they get paid. Your share logs here when you pay it.
                    </Text>
                  </>
                )}

                {owingRowsFor(sCount, sMode, sIncludeMe) > 0 && <Text style={styles.sourceLabel}>WHO ELSE OWES</Text>}
                {sPeople.map((row, i) => (
                  <View key={row.id} style={sKind === 'custom' ? styles.splitPersonBlock : undefined}>
                    <View style={styles.splitPersonInputs}>
                      <TextInput
                        style={[styles.input, styles.splitNameInput]}
                        placeholder={`Person ${i + 1}`}
                        placeholderTextColor={t.textMuted}
                        value={row.name}
                        onChangeText={(v) => { setSPeople((rs) => rs.map((r) => (r.id === row.id ? { ...r, name: v } : r))); setSError(null); }}
                        returnKeyType="done"
                      />
                      {sKind === 'custom' ? (
                        <TextInput
                          style={[styles.input, styles.splitAmtInput]}
                          placeholder="Amount"
                          placeholderTextColor={t.textMuted}
                          value={row.amount}
                          onChangeText={(v) => { setSPeople((rs) => rs.map((r) => (r.id === row.id ? { ...r, amount: v.replace(/[^\d.]/g, '') } : r))); setSError(null); }}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                        />
                      ) : (
                        <TextInput
                          style={[styles.input, styles.splitMailInput]}
                          placeholder="Email (optional)"
                          placeholderTextColor={t.textMuted}
                          value={row.email}
                          onChangeText={(v) => { setSPeople((rs) => rs.map((r) => (r.id === row.id ? { ...r, email: v } : r))); setSError(null); }}
                          autoCapitalize="none"
                          keyboardType="email-address"
                          returnKeyType="done"
                        />
                      )}
                    </View>
                    {sKind === 'custom' && (
                      <TextInput
                        style={[styles.input, styles.splitMailFull]}
                        placeholder="Email (optional)"
                        placeholderTextColor={t.textMuted}
                        value={row.email}
                        onChangeText={(v) => { setSPeople((rs) => rs.map((r) => (r.id === row.id ? { ...r, email: v } : r))); setSError(null); }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        returnKeyType="done"
                      />
                    )}
                  </View>
                ))}
                {sError && <Text style={styles.sheetError}>{sError}</Text>}
              </ScrollView>
              <Pressable onPress={submitSplit}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>{editingSplitId ? 'Save changes' : 'Create split'}</Text>
                </View>
              </Pressable>
            </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Planner v4: the Lend sheet. Name, amount, due date, where the money
          left from, and optional borrower email with its consent gate. */}
      <Modal visible={lendSheet} transparent animationType="slide" onRequestClose={() => setLendSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setLendSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: lendDrag.drag }] }}>
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.grabZone} {...lendDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{editingLendId ? 'Edit lend' : 'Log a lend'}</Text>
                <Pressable style={styles.closeBtn} onPress={() => setLendSheet(false)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled>
                <View style={styles.splitPersonInputs}>
                  <TextInput
                    style={[styles.input, styles.splitNameInput]}
                    placeholder="Who borrowed?"
                    placeholderTextColor={t.textMuted}
                    value={lName}
                    onChangeText={(v) => { setLName(v); setLError(null); }}
                    returnKeyType="done"
                  />
                  <TextInput
                    style={[styles.input, styles.splitMailInput]}
                    placeholder="Email (optional)"
                    placeholderTextColor={t.textMuted}
                    value={lEmail}
                    onChangeText={(v) => { setLEmail(v); setLError(null); }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="done"
                  />
                </View>
                {!!lEmail.trim() && (
                  <>
                    <View style={styles.dueToggleRow}>
                      <Pressable style={[styles.dueToggle, lConsent && styles.dueToggleOn]} onPress={() => setLConsent((v) => !v)}>
                        <Ionicons name={lConsent ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={lConsent ? t.onEmerald : t.textMuted} />
                        <Text style={[styles.dueToggleText, lConsent && { color: t.onEmerald }]}>They agreed to email reminders</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.remindHintFull}>
                      {lConsent
                        ? 'They get a friendly email 7, 3 and 1 days before the due date. You always get the pings too.'
                        : 'No automatic emails. You get the pings, and the send button on the card nudges them by hand.'}
                    </Text>
                  </>
                )}
                <MoneyInput value={lAmount} onChangeText={(v) => { setLAmount(v); setLError(null); }} placeholder="Amount lent" />
                <Pressable style={styles.dateRow} onPress={() => { Keyboard.dismiss(); setShowLPicker((v) => !v); }}>
                  <Ionicons name="calendar" size={17} color={t.emerald} />
                  <Text style={styles.dateText}>
                    Due {lDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                  <Ionicons name={showLPicker ? 'chevron-up' : 'chevron-down'} size={15} color={t.textMuted} />
                </Pressable>
                {showLPicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={lDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      minimumDate={new Date()}
                      themeVariant={t.mode}
                      onChange={(_, d) => {
                        if (Platform.OS !== 'ios') setShowLPicker(false);
                        if (d) setLDate(d);
                      }}
                    />
                  </View>
                )}
                <Text style={styles.sourceLabel}>THE MONEY LEFT FROM</Text>
                <AccountSelect
                  accounts={accounts} country={country}
                  value={lAcct} onChange={(id) => { setLAcct(id); setLError(null); }}
                  noneLabel="Track only"
                  style={{ marginBottom: 12 }}
                />
                <Text style={styles.remindHintFull}>
                  Pick an account and the amount logs as money out now, then back in when repaid. Track only skips the balances.
                </Text>
                {lError && <Text style={styles.sheetError}>{lError}</Text>}
              </ScrollView>
              <Pressable onPress={submitLend}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>{editingLendId ? 'Save changes' : 'Log lend'}</Text>
                </View>
              </Pressable>
            </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* The receive / pay-my-share account picker. Small on purpose. */}
      <Modal visible={!!pickTarget} transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setPickTarget(null)} />
          <View style={styles.kav} pointerEvents="box-none">
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>
                  {pickTarget?.kind === 'myshare'
                    ? `Pay your share (${peso(pickTarget.amount)})`
                    : pickTarget
                      ? `${pickTarget.personName} paid you ${pickTarget.kind === 'lendRepaid' ? 'back ' : ''}${peso(pickTarget.amount)}`
                      : ''}
                </Text>
                <Pressable style={styles.closeBtn} onPress={() => setPickTarget(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.sheetSub}>
                {pickTarget?.kind === 'myshare' ? 'Which account did it come from?' : 'Which account did it land in?'}
              </Text>
              <AccountSelect
                accounts={accounts} country={country}
                value={pickAcct} onChange={setPickAcct}
                {...(pickTarget?.kind === 'lendRepaid' ? { noneLabel: 'Track only', noneValue: 'none' } : {})}
                style={{ marginBottom: 12 }}
              />
              <Pressable onPress={confirmPick} disabled={!pickAcct}>
                <View style={[styles.submit, { backgroundColor: pickAcct ? t.emerald : t.borderSoft }]}>
                  <Text style={styles.submitText}>{pickTarget?.kind === 'myshare' ? 'Log my payment' : 'Confirm received'}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Budget sheet: category picker */}
      <Modal visible={budgetSheet} transparent animationType="slide" onRequestClose={() => setBudgetSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setBudgetSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: budgetDrag.drag }] }}>
            <View style={[styles.sheet, sheetCap]}>
              <View style={styles.grabZone} {...budgetDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{editingId ? (bHasDue ? 'Edit bill' : 'Edit budget') : bHasDue ? 'New bill' : 'New budget'}</Text>
                <Pressable style={styles.closeBtn} onPress={() => setBudgetSheet(false)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={18} color={t.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.sheetSub}>Pick a category, name it, set a monthly limit.</Text>
              {/* v2.4: the whole form scrolls (it outgrew small screens), the
                  save button stays pinned below. */}
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled>
                <PresetSelect t={t} styles={styles} value={pickedCat} onPick={pickCategory} />
              <TextInput
                style={styles.input}
                placeholder={pickedCat ? `Budget name (${pickedCat})` : 'Budget name'}
                placeholderTextColor={t.textMuted}
                value={bName}
                onChangeText={(v) => { setBName(v); setBError(null); }}
                returnKeyType="done"
              />
              {bError && <Text style={styles.sheetError}>{bError}</Text>}
              <MoneyInput value={bLimit} onChangeText={setBLimit} placeholder="Monthly limit" />
              <View style={styles.dueToggleRow}>
                <Pressable
                  style={[styles.dueToggle, bHasDue && styles.dueToggleOn]}
                  onPress={() => { setBHasDue((v) => !v); setShowBPicker(false); }}
                >
                  <Ionicons name={bHasDue ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={bHasDue ? t.onEmerald : t.textMuted} />
                  <Text style={[styles.dueToggleText, bHasDue && { color: t.onEmerald }]}>Has a due date</Text>
                </Pressable>
              </View>
              {/* Planner v2.1: monthly repeats on a day of the month, no year
                  needed, and re-arms itself every month. One time is a single
                  date that quietly retires after it passes. */}
              {bHasDue && (
                <View style={styles.dueModeRow}>
                  <Pressable
                    style={[styles.dueModeChip, bDueMode === 'monthly' && styles.dueModeChipSel]}
                    onPress={() => { setBDueMode('monthly'); setShowBPicker(false); }}
                  >
                    <Ionicons name="repeat" size={14} color={bDueMode === 'monthly' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, bDueMode === 'monthly' && { color: t.onEmerald }]}>Every month</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.dueModeChip, bDueMode === 'once' && styles.dueModeChipSel]}
                    onPress={() => setBDueMode('once')}
                  >
                    <Ionicons name="calendar-number" size={14} color={bDueMode === 'once' ? t.onEmerald : t.emerald} />
                    <Text style={[styles.dueModeText, bDueMode === 'once' && { color: t.onEmerald }]}>One time</Text>
                  </Pressable>
                </View>
              )}
              {bHasDue && bDueMode === 'monthly' && (
                <>
                  <Text style={styles.sourceLabel}>DUE ON THE</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.dayRow}>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                        const sel = bDueDay === d;
                        return (
                          <Pressable key={d} style={[styles.dayChip, sel && styles.dayChipSel]} onPress={() => setBDueDay(d)}>
                            <Text style={[styles.dayChipText, sel && { color: t.onEmerald }]}>{d}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                  {bDueDay > 28 && (
                    <Text style={styles.remindHintFull}>Short months use their last day.</Text>
                  )}
                  {/* Planner v2.3: auto-pay. On the due day the unspent part
                      of this budget logs itself as an expense from the
                      chosen account. Short on balance? One heads up, then it
                      waits and logs the moment money lands. */}
                  <View style={styles.dueToggleRow}>
                    <Pressable
                      style={[styles.dueToggle, bAutoPay && styles.dueToggleOn]}
                      onPress={() => { setBAutoPay((v) => !v); setBError(null); }}
                    >
                      <Ionicons name={bAutoPay ? 'flash' : 'flash-off-outline'} size={15} color={bAutoPay ? t.onEmerald : t.textMuted} />
                      <Text style={[styles.dueToggleText, bAutoPay && { color: t.onEmerald }]}>
                        {bAutoPay ? 'Auto-pay on' : 'Auto-pay off'}
                      </Text>
                    </Pressable>
                    {!bAutoPay && (
                      <Text style={styles.remindHint}>Off means no auto logging, just reminders.</Text>
                    )}
                  </View>
                  {bAutoPay && (
                    <>
                      <Text style={styles.sourceLabel}>PAID FROM</Text>
                      <AccountSelect
                        accounts={accounts} country={country}
                        value={bAutoAcct} onChange={(id) => { setBAutoAcct(id); setBError(null); }}
                        placeholder="Which account pays it?"
                        style={{ marginBottom: 12 }}
                      />
                      <Text style={styles.remindHintFull}>
                        Pays what's left from {bAutoAcct ? accounts.find((a) => a.id === bAutoAcct)?.name : 'the account you pick'} on the {ordinal(bDueDay)}. Short on balance? It waits and tells you.
                      </Text>
                    </>
                  )}
                </>
              )}
              {bHasDue && bDueMode === 'once' && (
                <Pressable style={styles.dateRow} onPress={() => { Keyboard.dismiss(); setShowBPicker((v) => !v); }}>
                  <Ionicons name="calendar" size={17} color={t.emerald} />
                  <Text style={styles.dateText}>
                    {bDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                  <Ionicons name={showBPicker ? 'chevron-up' : 'chevron-down'} size={15} color={t.textMuted} />
                </Pressable>
              )}
              {bHasDue && bDueMode === 'once' && showBPicker && (
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
              {/* Planner v2: per budget reminder toggle. When on, the phone
                  pings at 7, 3 and 1 days before the due date and on the day
                  itself. */}
              {bHasDue && (
                <View style={styles.dueToggleRow}>
                  <Pressable
                    style={[styles.dueToggle, bRemind && styles.dueToggleOn]}
                    onPress={() => setBRemind((v) => !v)}
                  >
                    <Ionicons name={bRemind ? 'notifications' : 'notifications-off-outline'} size={15} color={bRemind ? t.onEmerald : t.textMuted} />
                    <Text style={[styles.dueToggleText, bRemind && { color: t.onEmerald }]}>
                      {bRemind ? 'Reminders on' : 'Reminders off'}
                    </Text>
                  </Pressable>
                  <Text style={styles.remindHint}>
                    {bRemind ? 'Pings 7, 3 and 1 days out, and on the day.' : 'No pings for this one.'}
                  </Text>
                </View>
              )}
              </ScrollView>
              <Pressable onPress={submitBudget}>
                <View style={[styles.submit, { backgroundColor: t.emerald }]}>
                  <Text style={styles.submitText}>{editingId ? 'Save changes' : 'Create budget'}</Text>
                </View>
              </Pressable>
            </View>
            </Animated.View>
        </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// What an account can actually pay with right now: balance for debit style
// accounts, remaining credit for cards (Wallet shows the same number).
function availOf(a: { balance: number; kind?: 'debit' | 'credit'; creditLimit?: number }): number {
  return a.kind === 'credit' ? Math.max((a.creditLimit ?? 0) - a.balance, 0) : a.balance;
}

// 1st, 2nd, 3rd, 4th... for the monthly due day copy.
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`;
}


// v5.45: the last chip grid falls - the budget sheet's category presets are
// a searchable dropdown now (owner's rule: long lists are dropdowns).
// Module scope (rule 4: it has a search TextInput).
function PresetSelect({ t, styles, value, onPick }: {
  t: Palette; styles: any;
  value: string | null;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const picked = BUDGET_CATEGORIES.find((c) => c.name === value) ?? null;
  const ql = q.trim().toLowerCase();
  const list = ql ? BUDGET_CATEGORIES.filter((c) => c.name.toLowerCase().includes(ql)) : BUDGET_CATEGORIES;
  const choose = (name: string) => { onPick(name); Keyboard.dismiss(); setQ(''); setOpen(false); };
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable
        style={[styles.presetSelect, open && { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint }]}
        onPress={() => { Keyboard.dismiss(); setQ(''); setOpen(!open); }}
      >
        <View style={styles.presetIcon}>
          <Ionicons name={(picked?.icon as any) ?? 'grid-outline'} size={14} color={picked ? t.emerald : t.textMuted} />
        </View>
        <Text style={[styles.presetText, !picked && { color: t.textMuted }]}>
          {picked?.name ?? 'Choose a category'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={t.emerald} />
      </Pressable>
      {open && (
        <View style={styles.presetMenu}>
          <View style={styles.presetSearchRow}>
            <Ionicons name="search" size={14} color={t.textMuted} />
            <TextInput
              style={styles.presetSearchInput}
              placeholder="Search categories"
              placeholderTextColor={t.textMuted}
              value={q}
              onChangeText={setQ}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <ScrollView style={{ maxHeight: 230 }} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {list.map((c) => (
              <Pressable key={c.name} style={[styles.presetRow, styles.presetDivider]} onPress={() => choose(c.name)}>
                <View style={styles.presetIcon}>
                  <Ionicons name={c.icon as any} size={14} color={t.emerald} />
                </View>
                <Text style={styles.presetRowText}>{c.name}</Text>
                {value === c.name && <Ionicons name="checkmark-circle" size={15} color={t.emerald} />}
              </Pressable>
            ))}
            {list.length === 0 && <Text style={styles.presetEmpty}>Nothing matches "{q.trim()}".</Text>}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Hub card: a tappable section tile with a live one-line summary
function HubCard({ styles, t, icon, title, summary, soon, onPress }: {
  styles: ReturnType<typeof makeStyles>;
  t: Palette;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  summary: string;
  soon?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.hubCard, pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 }]}
    >
      <View style={styles.hubCardTop}>
        <View style={styles.hubIcon}>
          <Ionicons name={icon} size={20} color={t.emerald} />
        </View>
        {soon && (
          <View style={styles.soonChip}>
            <Text style={styles.soonChipText}>Soon</Text>
          </View>
        )}
      </View>
      <Text style={styles.hubTitle}>{title}</Text>
      <Text style={styles.hubSummary} numberOfLines={2}>{summary}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },

  // Hub
  hubGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  // v5.45: preset category dropdown
  presetSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  presetText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  presetIcon: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  presetMenu: {
    marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
  },
  presetSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: t.borderSoft,
  },
  presetSearchInput: { flex: 1, height: 38, color: t.textPrimary, fontSize: 13 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  presetDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  presetRowText: { color: t.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
  presetEmpty: { color: t.textMuted, fontSize: 12, padding: 12 },

  // v5.42: Cents strip (mirrors the dashboard centsBlock)
  plannerCentsBlock: {
    marginBottom: 14, borderRadius: 16, padding: 14,
    backgroundColor: t.mode === 'dark' ? 'rgba(46,158,91,0.10)' : t.sageSoft,
  },
  plannerCentsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  plannerCentsEyebrow: { ...type.eyebrow, fontSize: 10, color: t.textFaint },
  plannerCentsMsg: { color: t.textMuted, fontSize: 12.5, lineHeight: 18 },
  hubCard: {
    width: (Dimensions.get('window').width - 48 - 12) / 2,
    borderRadius: 20, padding: 16, minHeight: 128,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
  },
  hubCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  hubIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  hubTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '800' },
  hubSummary: { color: t.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  soonChip: {
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: t.centsYellowTint, borderWidth: 1, borderColor: 'rgba(232,197,71,0.35)',
  },
  soonChipText: { color: t.amber, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  hubHintRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hubHintIcon: {
    width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  hubHintText: { color: t.textMuted, fontSize: 12.5, lineHeight: 18, flex: 1 },
  soonIconWrap: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder, marginBottom: 12,
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 10 },
  backBtn: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: t.textMuted, fontSize: 13, marginTop: 3 },
  addBtn: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },

  // Goals
  emptyTitle: { color: t.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySub: { color: t.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  goalName: { color: t.textPrimary, fontSize: 18, fontWeight: '800' },
  goalDate: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  goalPct: { color: t.emerald, fontSize: 22, fontWeight: '800' },
  goalFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  statLabel: { color: t.textMuted, fontSize: 11 },
  statValue: { color: t.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 2 },
  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12,
  },
  planText: { fontSize: 12.5, fontWeight: '700', lineHeight: 17, flex: 1 },
  goalPreview: { color: t.textMuted, fontSize: 12.5, lineHeight: 17, marginBottom: 12, paddingHorizontal: 2 },
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
  suggestChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 12,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  suggestChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  suggestChipText: { color: t.emerald, fontSize: 13, fontWeight: '800' },
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

  // Budgets
  groupHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, marginTop: 6, marginBottom: -2,
  },
  groupName: { color: t.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  groupTotals: { color: t.textMuted, fontSize: 11, fontWeight: '700' },
  // v5.38: Bills | Spending segment control
  segRow: { flexDirection: 'row', gap: 8 },
  segChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 14,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  segChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  segText: { color: t.emerald, fontSize: 13.5, fontWeight: '800' },
  segCount: { color: t.textMuted, fontSize: 11.5, fontWeight: '800' },

  // Budgets totals header (whole list vs paid)
  totalsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  totalsTitle: { color: t.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  totalsPct: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  totalsLine: { marginBottom: 10 },
  totalsPaid: { color: t.textPrimary, fontSize: 22, fontWeight: '800' },
  totalsBudgeted: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  totalsOf: { color: t.textMuted, fontSize: 13 },
  totalsSub: { color: t.textMuted, fontSize: 12.5, marginTop: 8 },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  budgetIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  // M5.27: unified list type scale (matches the Analytics ledger rows).
  budgetName: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  budgetSub: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  budgetLeft: { color: t.mint, fontSize: 12, fontWeight: '800' },
  track: { height: 7, borderRadius: 4, backgroundColor: t.trackBg, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  starBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  trash: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },

  // Sheets
  dueToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dueToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  dueToggleOn: { backgroundColor: t.emerald, borderColor: t.emerald },
  dueToggleText: { color: t.textMuted, fontSize: 13, fontWeight: '700' },
  remindHint: { color: t.textMuted, fontSize: 11.5, lineHeight: 15, flex: 1 },
  remindHintFull: { color: t.textMuted, fontSize: 11.5, lineHeight: 15, marginBottom: 12, paddingHorizontal: 2 },
  autoWaitText: { color: t.amber, fontSize: 11.5, fontWeight: '700', marginTop: 3 },

  // Split a bill
  splitCount: { color: t.emerald, fontSize: 18, fontWeight: '800' },
  splitPersonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splitPersonName: { color: t.textPrimary, fontSize: 14.5, fontWeight: '700' },
  splitPersonMail: { color: t.textMuted, fontSize: 11.5, marginTop: 1 },
  splitPersonPaid: { color: t.textFaint, textDecorationLine: 'line-through' },
  splitShare: { color: t.textPrimary, fontSize: 13.5, fontWeight: '800' },
  splitMailBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  splitFootNote: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 12 },
  lendStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  lendStatValue: { color: t.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 2 },
  lendAmount: { color: t.textPrimary, fontSize: 14.5, fontWeight: '800' },
  lendDetail: {
    marginTop: 12, paddingTop: 12, gap: 8,
    borderTopWidth: 1, borderTopColor: t.borderSoft,
  },
  lendDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lendDetailLabel: { color: t.textFaint, fontSize: 11.5, fontWeight: '800', width: 84, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 1 },
  lendDetailValue: { color: t.textPrimary, fontSize: 13, fontWeight: '600', flex: 1, lineHeight: 18 },
  lendActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  lendActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1,
    borderRadius: 12, paddingVertical: 10,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  lendActionDanger: { backgroundColor: t.redTint, borderColor: 'rgba(220,38,38,0.25)' },
  lendActionText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  editBtn: {
    width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, borderColor: t.borderSoft, backgroundColor: t.inputFill,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 12,
  },
  linkRowText: { color: t.emerald, fontSize: 12.5, fontWeight: '700', flex: 1 },
  splitCountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  stepper: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, borderRadius: 999, padding: 4,
  },
  stepBtn: {
    width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  stepVal: { color: t.textPrimary, fontSize: 15, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  splitMathBox: {
    borderRadius: 12, borderWidth: 1, borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  splitMathText: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  splitPersonInputs: { flexDirection: 'row', gap: 8 },
  splitNameInput: { flex: 0.42 },
  splitMailInput: { flex: 0.58 },
  // Planner v5 custom shares: name+amount share the first line, email gets
  // its own full-width line, the block keeps rows visually grouped.
  splitPersonBlock: { marginBottom: 4 },
  splitAmtInput: { flex: 0.58, textAlign: 'right' },
  splitMailFull: { alignSelf: 'stretch' },
  splitFakeField: { justifyContent: 'center' },
  splitFakeFieldText: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  sheetError: { color: t.red, fontSize: 12, lineHeight: 17, marginTop: -6, marginBottom: 12, paddingHorizontal: 2 },
  dueModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  dueModeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
    borderRadius: 999, paddingVertical: 10,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  dueModeChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  dueModeText: { color: t.textPrimary, fontSize: 13, fontWeight: '700' },
  dayScroll: { marginBottom: 8 },
  dayRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  dayChip: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  dayChipSel: { backgroundColor: t.emerald, borderColor: t.emerald },
  dayChipText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700' },
  dueDateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  dueDateText: { color: t.emerald, fontSize: 13, fontWeight: '800' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 34, borderWidth: 1, borderColor: t.border,
    // Height cap is applied live per render (sheetCap): it must shrink when
    // the keyboard is up, and a static value here cannot do that.
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
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
