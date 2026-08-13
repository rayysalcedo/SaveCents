// v5 Wallet — open editorial layout. Net worth and the Cents outlook sit
// directly on the theme background (no hero card); the cards live inside a
// single matte panel, stacked wallet-style. Add account is a plain "+" icon.
//
// Drag-to-reorder v3: neighbor cards are displaced by NATIVE interpolations
// of the drag position, so a drag triggers zero React re-renders; the drop
// settles with a clamped spring into a slot that matches the committed
// layout to the pixel. Sheets track the exact keyboard height instead of
// relying on KeyboardAvoidingView, so fields sit flush above the keys.
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, Image, Keyboard, LayoutAnimation, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, UIManager, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { MoneyInput } from '../../src/components/MoneyInput';
import { AccountSelect } from '../../src/components/AccountSelect';
import { BankMark, MerchantBadge, NetworkMark } from '../../src/components/BrandBadge';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useDragToDismiss } from '../../src/hooks/useDragToDismiss';
import { useFinance } from '../../src/store/finance';
import { Account, CURRENCIES, Transaction, fmtMoney, peso } from '../../src/models/types';
import { COUNTRIES, Institution, institutionFor } from '../../src/data/countries';

const SWATCHES = ['#2E9E5B', '#D97706', '#64748B', '#B45309', '#DC2626', '#6D5A7A', '#5B8A72', '#4C7A8C'];
const STACK_OVERLAP = 12;

type Filter = 'all' | 'debit' | 'credit';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

function txWhen(ts: number): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────
// One card in the stack. During a drag session every non-dragged card's
// displacement is a pure interpolation of dragY (native driver, no state),
// which is what makes the gesture glassy: as the lifted card crosses a
// slot, its neighbor glides the full step in lockstep with the finger.
function StackCard({ acct, inst, t, styles, index, expanded, onToggle, onMenu, onTransactions, dragActive, dragging, fromIndex, step, dragY, onDragStart, onDragMove, onDragEnd, onMeasure }: {
  acct: Account; inst?: Institution; t: Palette; styles: any;
  index: number; expanded: boolean;
  onToggle: () => void; onMenu: () => void; onTransactions: () => void;
  dragActive: boolean; dragging: boolean; fromIndex: number; step: number;
  dragY: Animated.Value;
  onDragStart: () => void; onDragMove: (dy: number) => void; onDragEnd: () => void;
  onMeasure: (h: number) => void;
}) {
  const isCredit = acct.kind === 'credit';
  const base = inst?.color ?? acct.color ?? '#8A5C00';
  const gradient: [string, string] = [shade(base, -0.55), shade(base, 0.02)];
  const creditLeft = isCredit ? Math.max((acct.creditLimit ?? 0) - acct.balance, 0) : 0;
  const used = isCredit && acct.creditLimit ? Math.min(acct.balance / acct.creditLimit, 1) : 0;
  const network = acct.network ?? inst?.network;
  const fmt = (n: number) => fmtMoney(n, acct.currency);
  const kindLabel = isCredit ? 'Credit'
    : inst?.kind === 'wallet' ? 'E-wallet'
    : inst?.kind === 'digital' ? 'Digital bank'
    : inst?.kind === 'fintech' ? 'Fintech'
    : inst?.kind === 'cash' ? 'Cash'
    : 'Debit';

  // Gesture plumbing: the long press arms the card; its outer view then
  // claims every move. Refs keep the callbacks fresh without re-creating
  // the responder.
  const armed = useRef(false);
  armed.current = dragging;
  const onDragMoveRef = useRef(onDragMove); onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd); onDragEndRef.current = onDragEnd;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => armed.current,
    onPanResponderMove: (_, g) => onDragMoveRef.current(g.dy),
    onPanResponderRelease: () => onDragEndRef.current(),
    onPanResponderTerminate: () => onDragEndRef.current(),
  })).current;

  // Lift: the grabbed card scales up with a quick spring.
  const lift = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.spring(lift, { toValue: dragging ? 1 : 0, useNativeDriver: true, friction: 7, tension: 200 }).start();
  }, [dragging, lift]);
  const liftScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  // Native displacement: card i glides one full step exactly while the
  // dragged card traverses the span between their slots.
  const shiftY = useMemo(() => {
    if (!dragActive || dragging) return null;
    const d = index - fromIndex;
    if (d > 0) {
      return dragY.interpolate({
        inputRange: [(d - 1) * step, d * step],
        outputRange: [0, -step],
        extrapolate: 'clamp',
      });
    }
    if (d < 0) {
      return dragY.interpolate({
        inputRange: [d * step, (d + 1) * step],
        outputRange: [step, 0],
        extrapolate: 'clamp',
      });
    }
    return null;
  }, [dragActive, dragging, index, fromIndex, step, dragY]);

  const transform = dragging
    ? [{ translateY: dragY }, { scale: liftScale }]
    : shiftY
      ? [{ translateY: shiftY }]
      : [{ scale: liftScale }];

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.stackItem,
        index > 0 && styles.stackOverlap,
        { zIndex: dragging ? 999 : index + 1 },
        dragging && { shadowOpacity: 0.35, shadowRadius: 16, elevation: 14 },
        { transform },
      ]}
    >
      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); onToggle(); }}
        onLongPress={onDragStart}
        delayLongPress={220}
        onLayout={(e) => { if (!expanded) onMeasure(e.nativeEvent.layout.height); }}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.card, !expanded && styles.cardCollapsed]}
        >
          <View style={styles.cardTop}>
            <BankMark inst={inst} name={acct.name} size={30} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>
                {acct.name}
                {acct.nickname ? <Text style={styles.cardNick}>  {acct.nickname}</Text> : null}
              </Text>
              <Text style={styles.cardKind}>{kindLabel}</Text>
            </View>
            {!expanded && (
              <Text style={styles.stripAmount} numberOfLines={1}>
                {isCredit ? fmt(creditLeft) : fmt(acct.balance)}
              </Text>
            )}
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
              <Text style={styles.cardEyebrow}>{isCredit ? 'CREDIT LEFT' : 'CURRENT BALANCE'}</Text>
              <Text style={styles.cardAmount} numberOfLines={1}>{isCredit ? fmt(creditLeft) : fmt(acct.balance)}</Text>

              {isCredit && (acct.creditLimit ?? 0) > 0 && (
                <>
                  <View style={styles.cardTrack}>
                    <View style={[styles.cardFill, { width: `${Math.max((1 - used) * 100, 3)}%`, backgroundColor: used >= 0.9 ? '#FCA5A5' : 'rgba(255,255,255,0.92)' }]} />
                  </View>
                  <Text style={styles.cardCredit} numberOfLines={1}>
                    {fmt(acct.balance)} used of {fmt(acct.creditLimit!)} limit{acct.billingDay ? ` · bills ${ordinal(acct.billingDay)}` : ''}{acct.dueDay ? ` · due ${ordinal(acct.dueDay)}` : ''}
                  </Text>
                </>
              )}

              <Pressable
                onPress={(e) => { e.stopPropagation?.(); onTransactions(); }}
                style={({ pressed }) => [styles.txLink, pressed && { backgroundColor: 'rgba(255,255,255,0.16)' }]}
              >
                <Ionicons name="receipt-outline" size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.txLinkText}>Transactions</Text>
                <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.6)" />
              </Pressable>

              <View style={styles.cardFooter}>
                <Text style={styles.cardMask}>•••• ••••</Text>
                <NetworkMark network={network} height={13} />
              </View>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const { accounts, country, addAccount, removeAccount, setAccountBalance, updateAccount, reorderAccounts, transactions } = useFinance();
  const countryData = COUNTRIES[country];
  const homeCode = countryData.currencyCode;
  const isHome = (a: Account) => !a.currency || a.currency === homeCode;

  // ── Money summaries (home currency only; foreign listed per currency) ──
  const debitTotal = accounts.reduce((a, x) => a + (x.kind === 'credit' || !isHome(x) ? 0 : x.balance), 0);
  const creditOwed = accounts.reduce((a, x) => a + (x.kind === 'credit' && isHome(x) ? x.balance : 0), 0);
  const netWorth = debitTotal - creditOwed;
  const hasCredit = accounts.some((a) => a.kind === 'credit');

  const trendPct = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    const flow = transactions
      .filter((tx) => tx.timestamp >= cutoff)
      .reduce((a, tx) => a + (tx.isIncome ? tx.amount : -tx.amount), 0);
    const prev = netWorth - flow;
    if (prev <= 0 || Math.abs(flow) < 1) return null;
    return ((netWorth - prev) / prev) * 100;
  }, [transactions, netWorth]);

  const foreignLine = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const a of accounts) {
      if (isHome(a) || a.kind === 'credit') continue;
      sums[a.currency!] = (sums[a.currency!] ?? 0) + a.balance;
    }
    return Object.entries(sums).map(([code, sum]) => fmtMoney(sum, code)).join('  ·  ');
  }, [accounts]);

  // ── Cents outlook ──────────────────────────────────────────────────────
  const [fcRange, setFcRange] = useState<'D' | 'W' | 'M' | 'Y'>('W');
  const forecast = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    const recent = transactions.filter((tx) => tx.timestamp >= cutoff);
    const net = recent.reduce((a, tx) => a + (tx.isIncome ? tx.amount : -tx.amount), 0);
    const daily = net / 30;
    const days = fcRange === 'D' ? 1 : fcRange === 'W' ? 7 : fcRange === 'M' ? 30 : 365;
    const when = new Date(Date.now() + days * 86_400_000);
    const dateLabel = when.toLocaleDateString(undefined,
      fcRange === 'Y' ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' });
    const projected = Math.max(netWorth + daily * days, 0);
    const line = Math.abs(daily) < 1
      ? 'Flows are about flat lately.'
      : daily < 0
        ? `Spending about ${peso(Math.round(-daily))} a day right now.`
        : `Adding about ${peso(Math.round(daily))} a day right now.`;
    return { projected, dateLabel, line };
  }, [transactions, netWorth, fcRange]);

  // ── Filter + stack expansion ───────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>('all');
  const shown = accounts.filter((a) =>
    filter === 'all' ? true : filter === 'credit' ? a.kind === 'credit' : a.kind !== 'credit');
  const shownRef = useRef<Account[]>([]);
  shownRef.current = shown;

  const [drag, setDrag] = useState<{ id: string; from: number } | null>(null);
  // Tri-state expansion: null = untouched (first visit expands the bottom
  // card as an affordance), '' = explicitly none, id = that card. The old
  // logic treated '' as "fall back to the bottom card", which silently
  // re-expanded a card inside the DROP COMMIT frame - the real blink.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openId = drag
    ? ''
    : expandedId === null
      ? shown[shown.length - 1]?.id ?? ''
      : shown.some((a) => a.id === expandedId)
        ? expandedId
        : '';
  const toggleCard = (id: string) => {
    if (drag) return;
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    setExpandedId(id === openId ? '' : id);
  };

  // ── Drag engine v3 ─────────────────────────────────────────────────────
  const cardHRef = useRef(64);
  const stepOf = () => Math.max(cardHRef.current - STACK_OVERLAP, 40);
  const dragY = useRef(new Animated.Value(0)).current;
  const lastDyRef = useRef(0);
  const lastSlotRef = useRef(0);
  // dragY resets only after the commit render, when nothing renders it.
  React.useEffect(() => { if (!drag) dragY.setValue(0); }, [drag, dragY]);

  const startDrag = (id: string, index: number) => {
    // CRITICAL: configureNext only when an expanded card will collapse.
    // A pending LayoutAnimation with no immediate layout change would fire
    // at the reorder COMMIT instead, animating the final alignment and
    // producing a visible blink at drop.
    if (openId) LayoutAnimation.configureNext(LayoutAnimation.create(150, 'easeInEaseOut', 'opacity'));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    lastDyRef.current = 0;
    lastSlotRef.current = index;
    dragY.setValue(0);
    // Reordering leaves the whole stack collapsed afterward. The drop
    // commit must be a pure reorder: expanding a card in that same frame
    // is exactly the layout jump the user sees as a glitch.
    setExpandedId('');
    setDrag({ id, from: index });
  };
  const moveDrag = (dy: number) => {
    lastDyRef.current = dy;
    dragY.setValue(dy);
    // Haptic tick at every slot boundary; no state, no re-render.
    const slot = Math.min(
      Math.max((drag?.from ?? 0) + Math.round(dy / stepOf()), 0),
      shownRef.current.length - 1,
    );
    if (slot !== lastSlotRef.current) {
      lastSlotRef.current = slot;
      Haptics.selectionAsync().catch(() => {});
    }
  };
  const endDrag = () => {
    if (!drag) return;
    const from = drag.from;
    const to = Math.min(
      Math.max(from + Math.round(lastDyRef.current / stepOf()), 0),
      shownRef.current.length - 1,
    );
    // Fast clamped settle into the slot, then a single batched commit that
    // renders the exact layout the card already occupies.
    Animated.spring(dragY, {
      toValue: (to - from) * stepOf(), useNativeDriver: true,
      friction: 12, tension: 340, overshootClamping: true,
      restDisplacementThreshold: 0.8, restSpeedThreshold: 8,
    }).start(() => {
      const list = shownRef.current;
      const fromFull = accounts.findIndex((a) => a.id === list[from]?.id);
      const toFull = accounts.findIndex((a) => a.id === list[to]?.id);
      setDrag(null);
      if (fromFull >= 0 && toFull >= 0 && fromFull !== toFull) reorderAccounts(fromFull, toFull);
    });
  };

  // ── Add flow ───────────────────────────────────────────────────────────
  const [addSheet, setAddSheet] = useState(false);
  const [moveSheet, setMoveSheet] = useState(false);
  const [mvFrom, setMvFrom] = useState<string | null>(null);
  const [mvTo, setMvTo] = useState<string | null>(null);
  const [mvAmount, setMvAmount] = useState('');
  const [mvNote, setMvNote] = useState('');
  const addTransfer = useFinance((s2) => s2.addTransfer);
  const addDrag = useDragToDismiss(() => closeAdd());
  const [pick, setPick] = useState<{ name: string; color?: string; initial?: string } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState(SWATCHES[0]);
  const [newKind, setNewKind] = useState<'debit' | 'credit'>('debit');
  const [newBalance, setNewBalance] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [newBillDay, setNewBillDay] = useState('');
  const [newDueDay, setNewDueDay] = useState('');
  const [newCurrency, setNewCurrency] = useState('PHP');
  const [newNickname, setNewNickname] = useState('');

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
    setNewKind('debit'); setNewBalance(''); setNewLimit(''); setNewBillDay(''); setNewDueDay('');
    setNewCurrency(homeCode); setNewNickname('');
    setInstSearch(''); setInstFilter('all');
  };
  const closeAdd = () => { setAddSheet(false); resetAdd(); };

  const confirmAdd = () => {
    if (!pick) return;
    if (newKind === 'credit' && !(parseFloat(newLimit) > 0)) return;
    const limit = parseFloat(newLimit) || 0;
    const entered = parseFloat(newBalance) || 0;
    addAccount(pick.name, pick.color, pick.initial, {
      kind: newKind,
      balance: newKind === 'credit' ? Math.max(limit - Math.min(entered, limit), 0) : entered,
      creditLimit: newKind === 'credit' ? limit : undefined,
      billingDay: newKind === 'credit' ? parseInt(newBillDay, 10) || undefined : undefined,
      dueDay: newKind === 'credit' ? parseInt(newDueDay, 10) || undefined : undefined,
      network: institutionFor(country, pick.name)?.network ?? 'none',
      currency: newCurrency === homeCode ? undefined : newCurrency,
      nickname: newNickname,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    closeAdd();
  };

  // ── Editor ─────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<Account | null>(null);
  const editDrag = useDragToDismiss(() => setEditing(null));
  const [eName, setEName] = useState('');
  const [eBalance, setEBalance] = useState('');
  const [eLimit, setELimit] = useState('');
  const [eBillDay, setEBillDay] = useState('');
  const [eDueDay, setEDueDay] = useState('');
  const [eNetwork, setENetwork] = useState<'visa' | 'mastercard' | 'none'>('none');
  const [eCurrency, setECurrency] = useState('PHP');
  const [eNickname, setENickname] = useState('');

  const openEdit = (a: Account) => {
    setEName(a.name);
    const shownBal = a.kind === 'credit' ? Math.max((a.creditLimit ?? 0) - a.balance, 0) : a.balance;
    setEBalance(shownBal ? String(shownBal) : '');
    setECurrency(a.currency ?? homeCode);
    setENickname(a.nickname ?? '');
    setELimit(a.creditLimit ? String(a.creditLimit) : '');
    setEBillDay(a.billingDay ? String(a.billingDay) : '');
    setEDueDay(a.dueDay ? String(a.dueDay) : '');
    setENetwork(a.network ?? institutionFor(country, a.name)?.network ?? 'none');
    setEditing(a);
  };
  const saveEdit = () => {
    if (!editing) return;
    const entered = parseFloat(eBalance);
    const limit = editing.kind === 'credit'
      ? Math.max(parseFloat(eLimit) || editing.creditLimit || 0, 0)
      : undefined;
    if (!Number.isNaN(entered) && entered >= 0) {
      const stored = editing.kind === 'credit'
        ? Math.max((limit ?? 0) - Math.min(entered, limit ?? 0), 0)
        : entered;
      setAccountBalance(editing.id, stored);
    }
    updateAccount(editing.id, {
      name: eName.trim() || editing.name,
      nickname: eNickname.trim() || undefined,
      network: eNetwork,
      currency: eCurrency === homeCode ? undefined : eCurrency,
      ...(editing.kind === 'credit' ? {
        creditLimit: limit,
        billingDay: Math.min(Math.max(parseInt(eBillDay, 10) || editing.billingDay || 1, 1), 31),
        // Wallet v5: the day the statement must be PAID; drives the bill
        // budget's due date. Cleared by leaving the field empty.
        dueDay: eDueDay ? Math.min(Math.max(parseInt(eDueDay, 10) || 1, 1), 31) : undefined,
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

  // ── Per-card transactions ──────────────────────────────────────────────
  const [txAccount, setTxAccount] = useState<Account | null>(null);
  const txDrag = useDragToDismiss(() => setTxAccount(null));
  const accountTxs = useMemo(
    () => (txAccount ? transactions.filter((tx) => tx.accountId === txAccount.id).slice(0, 60) : []),
    [transactions, txAccount],
  );

  // ── Exact keyboard tracking: sheets sit flush above the keys ───────────
  // v5.35 (owner screenshot: gap between the sheet and the keys): the
  // reported endCoordinates.height over-lifts when an input accessory bar
  // (MoneyInput's chips) inflates the frame and focus then moves to a plain
  // field. Measuring what the keyboard actually COVERS (window height minus
  // its top edge) is the goals.tsx-proven math and stays exact through
  // accessory changes, floating keyboards and frame animations.
  const [kbH, setKbH] = useState(0);
  const kbHRef = useRef(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const apply = (h: number, duration: number) => {
      if (h === kbHRef.current) return; // no change: never queue an animation
      kbHRef.current = h;
      LayoutAnimation.configureNext(LayoutAnimation.create(duration, 'keyboard' as any, 'opacity'));
      setKbH(h);
    };
    const coveredHeight = (e: any): number => {
      if (Platform.OS === 'ios') {
        const winH = Dimensions.get('window').height;
        const top = e?.endCoordinates?.screenY ?? winH;
        return Math.max(0, winH - top);
      }
      return Math.max(e?.endCoordinates?.height ?? 0, 0);
    };
    const sub1 = Keyboard.addListener(showEvt as any, (e: any) =>
      apply(coveredHeight(e), e?.duration || 220));
    const sub2 = Keyboard.addListener(hideEvt as any, (e: any) => apply(0, e?.duration || 220));
    return () => { sub1.remove(); sub2.remove(); };
  }, []);
  const sheetLift = { marginBottom: kbH };
  const sheetPad = { paddingBottom: kbH > 0 ? 14 : 44 };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={!drag}
      >
        {/* Header: title + bare add icon */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Wallet</Text>
          <View style={{ flex: 1 }} />
          {/* v5.48: move funds - pocket to pocket, never an expense */}
          <Pressable
            onPress={() => { setMvFrom(null); setMvTo(null); setMvAmount(''); setMvNote(''); setMoveSheet(true); }}
            hitSlop={8}
            style={({ pressed }) => [styles.moveBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Move funds"
          >
            <Ionicons name="swap-horizontal" size={16} color={t.emerald} />
            <Text style={styles.moveBtnText}>Move</Text>
          </Pressable>
          <Pressable
            onPress={() => setAddSheet(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Add account"
          >
            <Ionicons name="add" size={22} color={t.onEmerald} />
          </Pressable>
        </View>

        {/* Net worth, straight on the canvas */}
        <Text style={styles.nwEyebrow}>NET WORTH</Text>
        <View style={styles.nwRow}>
          <Text style={styles.nwValue}>{peso(netWorth)}</Text>
          {trendPct !== null && (
            <View style={[styles.trendPill, { backgroundColor: trendPct >= 0 ? t.emeraldTint : t.redTint }]}>
              <Ionicons
                name={trendPct >= 0 ? 'trending-up' : 'trending-down'}
                size={12}
                color={trendPct >= 0 ? t.emerald : t.red}
              />
              <Text style={[styles.trendText, { color: trendPct >= 0 ? t.emerald : t.red }]}>
                {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
              </Text>
            </View>
          )}
        </View>
        <View style={styles.nwStats}>
          <View style={styles.nwStat}>
            <Ionicons name="wallet-outline" size={13} color={t.textFaint} />
            <Text style={styles.nwStatText}>{peso(debitTotal)}</Text>
          </View>
          {hasCredit && (
            <View style={styles.nwStat}>
              <Ionicons name="card-outline" size={13} color={t.textFaint} />
              <Text style={styles.nwStatText}>{peso(creditOwed)} owed</Text>
            </View>
          )}
          {foreignLine.length > 0 && (
            <View style={styles.nwStat}>
              <Ionicons name="globe-outline" size={13} color={t.textFaint} />
              <Text style={styles.nwStatText}>{foreignLine}</Text>
            </View>
          )}
        </View>

        {/* Cents outlook: a soft tinted block so it reads at a glance */}
        <View style={styles.fcBlock}>
        <View style={styles.fcHead}>
          <View style={styles.fcTitleWrap}>
            <Image source={require('../../assets/cents-mark.png')} style={{ width: 13, height: 13 }} resizeMode="contain" />
            <Text style={styles.fcTitle}>OUTLOOK</Text>
          </View>
          <View style={styles.fcChips}>
            {(['D', 'W', 'M', 'Y'] as const).map((r) => {
              const active = fcRange === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setFcRange(r)}
                  hitSlop={6}
                  style={[styles.fcChip, active && { backgroundColor: t.emerald, borderColor: t.emerald }]}
                >
                  <Text style={[styles.fcChipText, active && { color: t.onEmerald }]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Text style={styles.fcValue}>
          {'\u2248'} {peso(Math.round(forecast.projected))} <Text style={styles.fcWhen}>by {forecast.dateLabel}</Text>
        </Text>
        <Text style={styles.fcLine}>{forecast.line}</Text>
        </View>

        {/* The cards panel */}
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelCount}>
              {shown.length} card{shown.length === 1 ? '' : 's'}
            </Text>
            <View style={styles.panelFilters}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    hitSlop={4}
                    style={[styles.panelChip, active && { backgroundColor: t.emerald, borderColor: t.emerald }]}
                  >
                    <Text style={[styles.panelChipText, active && { color: t.onEmerald }]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {shown.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name={filter === 'credit' ? 'card-outline' : 'wallet-outline'} size={24} color={t.textFaint} />
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
                  onTransactions={() => setTxAccount(a)}
                  dragActive={!!drag}
                  dragging={drag?.id === a.id}
                  fromIndex={drag?.from ?? 0}
                  step={stepOf()}
                  dragY={dragY}
                  onDragStart={() => startDrag(a.id, i)}
                  onDragMove={moveDrag}
                  onDragEnd={endDrag}
                  onMeasure={(h) => { cardHRef.current = h; }}
                />
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      {/* ── Add sheet ─────────────────────────────────────────────────── */}
      {/* ── v5.48 Move funds sheet ── */}
      <Modal visible={moveSheet} transparent animationType="slide" onRequestClose={() => setMoveSheet(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={styles.scrimFill} onPress={() => { Keyboard.dismiss(); setMoveSheet(false); }} />
          <View style={sheetLift}>
            <Pressable style={[styles.sheet, sheetPad]} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Move funds</Text>
              <Text style={styles.moveSub}>Pocket to pocket. Never logged as an expense or income.</Text>
              <Text style={styles.fieldLabel}>FROM</Text>
              <AccountSelect
                accounts={accounts.filter((a) => a.id !== mvTo)} country={country}
                value={mvFrom} onChange={setMvFrom}
                placeholder="Source account"
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.fieldLabel}>TO</Text>
              <AccountSelect
                accounts={accounts.filter((a) => a.id !== mvFrom)} country={country}
                value={mvTo} onChange={setMvTo}
                placeholder="Destination account"
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.fieldLabel}>AMOUNT</Text>
              <MoneyInput value={mvAmount} onChangeText={setMvAmount} quickChips={false} />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>NOTE (OPTIONAL)</Text>
              <TextInput
                style={styles.moveNoteInput}
                placeholder="e.g. Savings top-up"
                placeholderTextColor={t.textMuted}
                value={mvNote}
                onChangeText={setMvNote}
                returnKeyType="done"
              />
              {(() => {
                const amt = parseFloat(mvAmount);
                const from = accounts.find((a) => a.id === mvFrom);
                const to = accounts.find((a) => a.id === mvTo);
                const ok = !!from && !!to && !Number.isNaN(amt) && amt > 0;
                const short = ok && from!.kind !== 'credit' && from!.balance < amt;
                const paysCard = ok && to!.kind === 'credit';
                return (
                  <>
                    {short && (
                      <Text style={styles.moveWarn}>
                        {from!.name} only holds {peso(from!.balance)} - this would take it negative.
                      </Text>
                    )}
                    {paysCard && !short && (
                      <Text style={styles.moveHint}>Moving to {to!.name} pays the card down.</Text>
                    )}
                    <Pressable
                      style={[styles.moveCta, { backgroundColor: ok ? t.emerald : t.inputFill }]}
                      disabled={!ok}
                      onPress={() => {
                        addTransfer(from!.id, to!.id, amt, mvNote);
                        Keyboard.dismiss();
                        setMoveSheet(false);
                      }}
                    >
                      <Ionicons name="swap-horizontal" size={16} color={ok ? t.onEmerald : t.textMuted} />
                      <Text style={[styles.moveCtaText, !ok && { color: t.textMuted }]}>
                        {ok ? `Move ${peso(amt)}` : 'Move funds'}
                      </Text>
                    </Pressable>
                  </>
                );
              })()}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={addSheet} transparent animationType="slide" onRequestClose={closeAdd}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={styles.scrimFill} onPress={closeAdd} />
          <Animated.View style={[sheetLift, { transform: [{ translateY: addDrag.drag }] }]}>
            <Pressable style={[styles.sheet, sheetPad]} onPress={Keyboard.dismiss}>
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
                      const count = accounts.filter((a) => a.name.toLowerCase() === inst.name.toLowerCase()).length;
                      return (
                        <Pressable
                          key={inst.name}
                          onPress={() => { Keyboard.dismiss(); setPick({ name: inst.name }); }}
                          style={({ pressed }) => [
                            styles.instRow,
                            i < arr.length - 1 && styles.divider,
                            pressed && { backgroundColor: t.inputFill },
                          ]}
                        >
                          <BankMark inst={inst} name={inst.name} size={36} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.instName}>{inst.name}</Text>
                            <Text style={styles.instKind}>
                              {inst.kind === 'wallet' ? 'E-wallet' : inst.kind === 'digital' ? 'Digital bank' : inst.kind === 'fintech' ? 'Fintech' : inst.kind === 'cash' ? 'Cash' : 'Bank'}
                            </Text>
                          </View>
                          {count > 0 && (
                            <View style={styles.addedTag}>
                              <Text style={styles.addedTagText}>{count} added</Text>
                            </View>
                          )}
                          <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
                        </Pressable>
                      );
                    })}
                    {pickerList.length === 0 && (
                      <Text style={styles.noResults}>No matches. Create it as a custom account below.</Text>
                    )}
                  </ScrollView>
                  <View style={styles.customDivider} />
                  <Pressable style={styles.customToggle} onPress={() => setCustomMode(true)}>
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
                <ScrollView
                  style={{ maxHeight: 520 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.stepHead}>
                    <Pressable style={styles.backBtn} onPress={() => setPick(null)} hitSlop={8}>
                      <Ionicons name="chevron-back" size={18} color={t.textPrimary} />
                    </Pressable>
                    <BankMark inst={institutionFor(country, pick.name)} name={pick.name} size={30} />
                    <Text style={styles.sheetTitle}>{pick.name}</Text>
                  </View>

                  <Text style={styles.fieldLabel}>NICKNAME (OPTIONAL)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Salary card, Joint, Travel"
                    placeholderTextColor={t.textFaint}
                    value={newNickname}
                    onChangeText={setNewNickname}
                    returnKeyType="done"
                  />

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

                  <Text style={styles.fieldLabel}>CURRENCY</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.curRow} keyboardShouldPersistTaps="always">
                    {CURRENCIES.map((c) => {
                      const active = newCurrency === c.code;
                      return (
                        <Pressable
                          key={c.code}
                          onPress={() => setNewCurrency(c.code)}
                          style={[styles.curChip, active && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}
                        >
                          <Text style={[styles.curChipText, active && { color: t.emerald }]}>{c.symbol} {c.code}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>{newKind === 'credit' ? 'CREDIT LEFT RIGHT NOW' : 'STARTING BALANCE'}</Text>
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
                      <Text style={styles.fieldLabel}>BILL DUE DAY OF MONTH</Text>
                      <TextInput
                        style={styles.dayInput}
                        placeholder="25"
                        placeholderTextColor={t.textFaint}
                        value={newDueDay}
                        onChangeText={(v) => setNewDueDay(v.replace(/[^\d]/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        returnKeyType="done"
                      />
                      <Text style={styles.dueDayHint}>
                        On the billing day, whatever the card owes becomes a bill in your Budgets, due this day, reminders on.
                      </Text>
                    </>
                  )}

                  <Pressable onPress={confirmAdd}>
                    <View style={[styles.submit, { backgroundColor: newKind === 'credit' && !(parseFloat(newLimit) > 0) ? t.inputFill : t.emerald }]}>
                      <Text style={[styles.submitText, newKind === 'credit' && !(parseFloat(newLimit) > 0) && { color: t.textMuted }]}>
                        Add {pick.name}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={{ height: 8 }} />
                </ScrollView>
              )}
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Editor ────────────────────────────────────────────────────── */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={styles.scrimFill} onPress={() => setEditing(null)} />
          <Animated.View style={[sheetLift, { transform: [{ translateY: editDrag.drag }] }]}>
            <Pressable style={[styles.sheet, sheetPad]} onPress={Keyboard.dismiss}>
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

              <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.fieldLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  value={eName}
                  onChangeText={setEName}
                  placeholder="Name"
                  placeholderTextColor={t.textFaint}
                  returnKeyType="done"
                />

                <Text style={styles.fieldLabel}>NICKNAME (OPTIONAL)</Text>
                <TextInput
                  style={styles.input}
                  value={eNickname}
                  onChangeText={setENickname}
                  placeholder="Salary card, Joint, Travel"
                  placeholderTextColor={t.textFaint}
                  returnKeyType="done"
                />

                <Text style={styles.fieldLabel}>CURRENCY</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.curRow} keyboardShouldPersistTaps="always">
                  {CURRENCIES.map((c) => {
                    const active = eCurrency === c.code;
                    return (
                      <Pressable
                        key={c.code}
                        onPress={() => setECurrency(c.code)}
                        style={[styles.curChip, active && { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder }]}
                      >
                        <Text style={[styles.curChipText, active && { color: t.emerald }]}>{c.symbol} {c.code}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={styles.fieldLabel}>{editing?.kind === 'credit' ? 'CREDIT LEFT' : 'BALANCE'}</Text>
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
                    <Text style={styles.fieldLabel}>BILL DUE DAY OF MONTH</Text>
                    <TextInput
                      style={styles.dayInput}
                      value={eDueDay}
                      onChangeText={(v) => setEDueDay(v.replace(/[^\d]/g, '').slice(0, 2))}
                      placeholder="25"
                      placeholderTextColor={t.textFaint}
                      keyboardType="number-pad"
                      returnKeyType="done"
                    />
                    <Text style={styles.dueDayHint}>
                      On the billing day, whatever the card owes becomes a bill in your Budgets, due this day, reminders on.
                    </Text>
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
                <View style={{ height: 8 }} />
              </ScrollView>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Per-card transactions ─────────────────────────────────────── */}
      <Modal visible={!!txAccount} transparent animationType="slide" onRequestClose={() => setTxAccount(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={styles.scrimFill} onPress={() => setTxAccount(null)} />
          <Animated.View style={{ transform: [{ translateY: txDrag.drag }] }}>
            <View style={[styles.sheet, { paddingBottom: 44 }]}>
              <View style={styles.grabZone} {...txDrag.panHandlers}>
                <View style={styles.handle} />
              </View>
              <View style={styles.stepHead}>
                <BankMark inst={txAccount ? institutionFor(country, txAccount.name) : undefined} name={txAccount?.name ?? ''} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>{txAccount?.name}{txAccount?.nickname ? ` ${txAccount.nickname}` : ''}</Text>
                  <Text style={styles.txSheetSub}>
                    {accountTxs.length === 0 ? 'No transactions yet' : `Last ${accountTxs.length} transaction${accountTxs.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
              </View>

              {accountTxs.length === 0 ? (
                <View style={styles.txEmpty}>
                  <Ionicons name="receipt-outline" size={26} color={t.textFaint} />
                  <Text style={styles.txEmptyText}>
                    Anything you log from this card with Cents shows up here.
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {accountTxs.map((tx: Transaction, i: number) => {
                    const isCreditAcct = txAccount?.kind === 'credit';
                    const positive = tx.isIncome;
                    return (
                      <View key={tx.id} style={[styles.txRow, i < accountTxs.length - 1 && styles.divider]}>
                        <MerchantBadge
                          description={tx.description}
                          fallbackIcon={tx.goalId ? 'flag' : tx.isIncome ? 'trending-up' : 'pricetag'}
                          isIncome={tx.isIncome}
                          isGoalMove={!!tx.goalId}
                          size={34}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.txName} numberOfLines={1}>{tx.description}</Text>
                          <Text style={styles.txMeta} numberOfLines={1}>
                            {isCreditAcct ? (tx.isIncome ? 'Payment' : 'Charge') : tx.categoryId}{' · '}{txWhen(tx.timestamp)}
                          </Text>
                        </View>
                        <Text style={[styles.txAmt, { color: positive ? t.emerald : t.textPrimary }]}>
                          {positive ? '+' : '-'}{fmtMoney(tx.amount, txAccount?.currency)}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800' },
  addBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emerald,
  },

  // Net worth on the open canvas
  nwEyebrow: { ...type.eyebrow, color: t.textFaint },
  nwRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  nwValue: { color: t.textPrimary, fontSize: 40, fontWeight: '800', ...type.money },
  trendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 999, paddingHorizontal: 8, height: 24,
  },
  trendText: { fontSize: 12, fontWeight: '800', ...type.money },
  nwStats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 8 },
  nwStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  nwStatText: { color: t.textMuted, fontSize: 12.5, fontWeight: '600', ...type.money },

  // Outlook: quiet tinted block, no border — visible without shouting
  fcBlock: {
    marginTop: 18, borderRadius: 16, padding: 14,
    backgroundColor: t.mode === 'dark' ? 'rgba(245,198,74,0.10)' : t.sageSoft,
  },
  fcHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fcTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fcTitle: { ...type.eyebrow, fontSize: 10, color: t.textFaint },
  fcChips: { flexDirection: 'row', gap: 6 },
  fcChip: {
    width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(22,91,51,0.18)',
  },
  fcChipText: { color: t.textMuted, fontSize: 11, fontWeight: '800' },
  fcValue: { color: t.textPrimary, fontSize: 25, fontWeight: '800', marginTop: 10, ...type.money },
  fcWhen: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  fcLine: { color: t.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 4 },

  // Cards panel: a full-bleed sheet — spans the whole screen width with
  // rounded top corners and runs beneath the tab bar.
  panel: {
    marginTop: 20, marginHorizontal: -24,
    backgroundColor: t.surface,
    borderTopWidth: 1, borderColor: t.border,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 150,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 12,
  },
  panelCount: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  panelFilters: { flexDirection: 'row', gap: 6 },
  panelChip: {
    height: 28, borderRadius: 999, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  panelChipText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },

  // Stack
  stack: {},
  stackItem: {
    borderRadius: 14,
    shadowColor: '#000000', shadowOpacity: t.mode === 'dark' ? 0.30 : 0.12,
    shadowRadius: 8, shadowOffset: { width: 0, height: -3 },
    elevation: 4,
  },
  stackOverlap: { marginTop: -STACK_OVERLAP },
  card: { borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  cardCollapsed: { paddingBottom: 22 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  cardName: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  cardNick: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, fontWeight: '600' },
  cardKind: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },
  stripAmount: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700', marginRight: 2, ...type.money },
  cardEyebrow: { ...type.eyebrow, color: 'rgba(255,255,255,0.6)', fontSize: 10 },
  cardAmount: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginTop: 2, ...type.money },
  cardTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', marginTop: 10 },
  cardFill: { height: 4, borderRadius: 2 },
  cardCredit: { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 5, ...type.money },
  txLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999,
    paddingLeft: 10, paddingRight: 8, height: 30, marginTop: 12,
  },
  txLinkText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  cardMask: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyTitle: { color: t.textMuted, fontSize: 13.5, fontWeight: '600' },

  // Sheets
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,12,14,0.45)' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800' },
  sheetHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  countryLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countryText: { color: t.textFaint, fontSize: 12, fontWeight: '600' },
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
  instRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  instName: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  instKind: { color: t.textFaint, fontSize: 11.5, marginTop: 1 },
  addedTag: {
    borderRadius: 999, paddingHorizontal: 8, height: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, marginRight: 2,
  },
  addedTagText: { color: t.emerald, fontSize: 10.5, fontWeight: '700' },
  noResults: { color: t.textMuted, fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  customDivider: { height: 1, backgroundColor: t.borderSoft, marginVertical: 12 },
  customToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44 },
  customToggleText: { color: t.emerald, fontSize: 14, fontWeight: '700' },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  backBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },

  // Fields
  fieldLabel: { ...type.eyebrow, color: t.textFaint, marginBottom: 6, marginTop: 2 },
  // v5.48: move funds
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 10,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  moveBtnText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  moveSub: { color: t.textMuted, fontSize: 12.5, marginTop: 4, marginBottom: 14 },
  moveNoteInput: {
    height: 44, borderRadius: 12, paddingHorizontal: 12, color: t.textPrimary, fontSize: 13.5,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  moveWarn: { color: t.red, fontSize: 12, marginTop: 10, fontWeight: '600' },
  moveHint: { color: t.emerald, fontSize: 12, marginTop: 10, fontWeight: '600' },
  moveCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 48, borderRadius: 16, marginTop: 14,
  },
  moveCtaText: { color: t.onEmerald, fontSize: 14.5, fontWeight: '800' },
  input: {
    height: 50, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 15.5, fontWeight: '600',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border, marginBottom: 12,
  },
  dayInput: {
    height: 50, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 20, fontWeight: '700',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border, marginBottom: 12,
    ...type.money,
  },
  dueDayHint: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: -6, marginBottom: 12, paddingHorizontal: 2 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  typeBtn: {
    flex: 1, height: 44, borderRadius: radius.input, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: t.border,
  },
  typeText: { color: t.textMuted, fontSize: 13.5, fontWeight: '700' },
  curRow: { gap: 8, paddingBottom: 12 },
  curChip: {
    height: 34, borderRadius: 999, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  curChipText: { color: t.textMuted, fontSize: 12.5, fontWeight: '700', ...type.money },
  swatchRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchSel: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  submit: { height: 50, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { color: t.onEmerald, fontSize: 15, fontWeight: '800' },

  // Tx sheet
  txSheetSub: { color: t.textFaint, fontSize: 12, marginTop: 1 },
  txEmpty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
  txEmptyText: { color: t.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  txName: { color: t.textPrimary, fontSize: 14, fontWeight: '600' },
  txMeta: { color: t.textFaint, fontSize: 11.5, marginTop: 1 },
  txAmt: { fontSize: 14.5, fontWeight: '800', ...type.money },
});
