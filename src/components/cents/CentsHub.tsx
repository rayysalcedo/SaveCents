// M5: the Cents hub — what the center tab-bar button opens.
// A glassmorphic bottom sheet with quick actions (Add Expense / Add Income /
// Scan) plus the entry into the full Cents chat overlay. Rendered as an
// animated absolute overlay (NOT an RN Modal) so the chat/camera layers never
// fight iOS presentation rules.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDragToDismiss } from '../../hooks/useDragToDismiss';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Palette, radius, type, useTheme } from '../../theme/colors';
import { useFinance } from '../../store/finance';
import { useUI } from '../../store/ui';
import { peso } from '../../models/types';
import { institutionFor } from '../../data/countries';

type Mode = 'menu' | 'expense' | 'income';

export function CentsHub() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { hubOpen, closeHub, openChat, openScan } = useUI();
  const sheetDrag = useDragToDismiss(() => dismiss());
  const { accounts, categories, country, addExpense, addIncome } = useFinance();

  const [mode, setMode] = useState<Mode>('menu');
  const [amount, setAmount] = useState('');
  // v5.4 calculator-first entry: step 1 is an in-sheet keypad (no system
  // keyboard, so nothing to dismiss and nothing gets buried); "+" chains
  // several amounts into one total; Next moves to naming and routing.
  const [entryStep, setEntryStep] = useState<'amount' | 'details'>('amount');
  const [calcAcc, setCalcAcc] = useState(0);
  const [calcEntry, setCalcEntry] = useState('');
  const calcTotal = calcAcc + (parseFloat(calcEntry) || 0);
  const tapKey = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (k === 'back') {
      if (calcEntry.length > 0) setCalcEntry(calcEntry.slice(0, -1));
      else if (calcAcc > 0) { setCalcAcc(0); }
      return;
    }
    if (k === 'clear') { setCalcAcc(0); setCalcEntry(''); return; }
    if (k === 'plus') {
      const v = parseFloat(calcEntry) || 0;
      if (v > 0) { setCalcAcc(calcAcc + v); setCalcEntry(''); }
      return;
    }
    if (k === '.') {
      if (!calcEntry.includes('.')) setCalcEntry(calcEntry === '' ? '0.' : calcEntry + '.');
      return;
    }
    // digits / 00
    const next = (calcEntry + k).replace(/^0+(?=\d)/, '');
    const [, dec] = next.split('.');
    if (dec && dec.length > 2) return;
    if (next.replace('.', '').length > 9) return;
    setCalcEntry(next);
  };
  const confirmCalc = () => {
    if (!(calcTotal > 0)) return;
    setAmount(Number.isInteger(calcTotal) ? String(calcTotal) : calcTotal.toFixed(2));
    Haptics.selectionAsync().catch(() => {});
    setEntryStep('details');
  };
  const backToCalc = () => {
    // Re-edit: current amount becomes the accumulator.
    setCalcAcc(parseFloat(amount) || 0);
    setCalcEntry('');
    setEntryStep('amount');
  };
  const [note, setNote] = useState('');
  const [pickedCat, setPickedCat] = useState<string | null>(null);
  const [pickedAcct, setPickedAcct] = useState<string | null>(null);
  const [acctMenu, setAcctMenu] = useState(false);

  // Slide-up + backdrop fade
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (hubOpen) {
      setMode('menu'); setAmount(''); setNote(''); setPickedCat(null); setPickedAcct(null); setAcctMenu(false);
      setEntryStep('amount'); setCalcAcc(0); setCalcEntry('');
      Animated.timing(anim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      anim.setValue(0);
    }
  }, [hubOpen, anim]);

  if (!hubOpen) return null;

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => closeHub());
  };

  const amountNum = parseFloat(amount);
  const validAmount = !Number.isNaN(amountNum) && amountNum > 0;
  const acct = accounts.find((a) => a.id === pickedAcct) ?? null;

  const submitExpense = () => {
    if (!validAmount || !pickedCat) return;
    addExpense(amountNum, pickedCat, pickedAcct ?? undefined, note);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    dismiss();
  };
  const submitIncome = () => {
    if (!validAmount || !pickedAcct) return;
    addIncome(amountNum, pickedAcct, note);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    dismiss();
  };

  const AcctDot = ({ name, color, initial, size = 26 }: { name: string; color?: string; initial?: string; size?: number }) => {
    const inst = institutionFor(country, name);
    const c = color ?? inst?.color ?? t.emerald;
    return (
      <View style={{
        width: size, height: size, borderRadius: size * 0.34, alignItems: 'center', justifyContent: 'center',
        backgroundColor: c + '22', borderWidth: 1, borderColor: c + '55',
      }}>
        <Text style={{ color: c, fontSize: size * 0.36, fontWeight: '800' }}>
          {initial ?? inst?.initial ?? name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  };

  // Dropdown/picker for routing to a card or e-wallet
  const AccountPicker = ({ optional }: { optional?: boolean }) => (
    <View style={{ zIndex: 30 }}>
      <Text style={styles.fieldLabel}>{optional ? 'PAY FROM (OPTIONAL)' : 'ROUTE TO'}</Text>
      <Pressable style={[styles.acctSelect, acctMenu && { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint }]} onPress={() => { Keyboard.dismiss(); setAcctMenu((v) => !v); }}>
        {acct ? (
          <>
            <AcctDot name={acct.name} color={acct.color} initial={acct.initial} />
            <Text style={styles.acctSelectText}>{acct.name}</Text>
            <Text style={styles.acctSelectBal}>{peso(acct.balance)}</Text>
          </>
        ) : (
          <>
            <View style={styles.acctPlaceholderIcon}>
              <Ionicons name="wallet-outline" size={14} color={t.textMuted} />
            </View>
            <Text style={[styles.acctSelectText, { color: t.textMuted }]}>
              {optional ? 'No source, just track it' : 'Choose a card or e-wallet'}
            </Text>
          </>
        )}
        <Ionicons name={acctMenu ? 'chevron-up' : 'chevron-down'} size={15} color={t.emerald} />
      </Pressable>
      {acctMenu && (
        <View style={styles.acctMenu}>
          {/* Long lists scroll internally, capped at ~5.5 rows; the sheet
              itself scrolls too since the menu now occupies real height. */}
          <ScrollView
            style={{ maxHeight: 250 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
          {optional && (
            <Pressable style={[styles.acctMenuItem, styles.menuDivider]} onPress={() => { setPickedAcct(null); setAcctMenu(false); }}>
              <View style={styles.acctPlaceholderIcon}>
                <Ionicons name="remove" size={14} color={t.textMuted} />
              </View>
              <Text style={[styles.acctMenuText, { color: t.textMuted }]}>No source</Text>
              {pickedAcct === null && <Ionicons name="checkmark-circle" size={16} color={t.emerald} />}
            </Pressable>
          )}
          {accounts.map((a, i) => (
            <Pressable
              key={a.id}
              style={[styles.acctMenuItem, i < accounts.length - 1 && styles.menuDivider]}
              onPress={() => { setPickedAcct(a.id); setAcctMenu(false); }}
            >
              <AcctDot name={a.name} color={a.color} initial={a.initial} />
              <Text style={styles.acctMenuText}>{a.nickname ? `${a.name} ${a.nickname}` : a.name}</Text>
              <Text style={styles.acctMenuBal}>{peso(a.balance)}</Text>
              {pickedAcct === a.id && <Ionicons name="checkmark-circle" size={16} color={t.emerald} />}
            </Pressable>
          ))}
          {accounts.length === 0 && (
            <Text style={styles.emptyMenu}>No accounts yet. Add one in the Wallet tab.</Text>
          )}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const backTo = (m: Mode) => { Keyboard.dismiss(); setAcctMenu(false); setMode(m); };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop: darkened + blurred so the user stays in context */}
      {/* v4: plain neutral scrim — no backdrop blur. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,12,14,0.45)' }]} onPress={dismiss} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
        <Animated.View
          style={{
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
            opacity: anim,
          }}
        >
          {/* Glass sheet */}
          <Animated.View style={[styles.sheetShadow, { transform: [{ translateY: sheetDrag.drag }] }]}>
            <View style={[styles.sheetClip, { backgroundColor: t.sheet }]}>
              <Pressable style={[styles.sheetInner, { paddingBottom: 20 + insets.bottom }]} onPress={Keyboard.dismiss}>
                <View style={styles.grabZone} {...sheetDrag.panHandlers}>
                  <View style={styles.handle} />
                </View>
                <ScrollView
                  style={{ maxHeight: 560, flexGrow: 0 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >

                {mode === 'menu' && (
                  <>
                    <View style={styles.headRow}>
                      <View style={[styles.headBadge, { backgroundColor: t.forest }]}>
                        <Image source={require('../../../assets/cents-mark.png')} style={{ width: 26, height: 26 }} resizeMode="contain" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.headTitle}>Hi, I'm Cents</Text>
                        <Text style={styles.headSub}>What should we do with your money?</Text>
                      </View>
                      <Pressable style={styles.closeBtn} onPress={dismiss}>
                        <Ionicons name="close" size={18} color={t.textMuted} />
                      </Pressable>
                    </View>

                    {/* Quick actions */}
                    <View style={styles.tileRow}>
                      <QuickTile styles={styles} t={t} icon="remove-circle" tint={t.red} label="Add Expense" onPress={() => backTo('expense')} />
                      <QuickTile styles={styles} t={t} icon="add-circle" tint={t.emerald} label="Add Income" onPress={() => backTo('income')} />
                      <QuickTile styles={styles} t={t} icon="scan" tint={t.teal} label="Scan" onPress={() => openScan()} />
                    </View>

                    {/* Chat + voice entries */}
                    {/* v4: quiet co-pilot entry — outlined matte row with
                        monochrome icons, not a glowing gradient banner. */}
                    <Pressable onPress={() => openChat()} style={({ pressed }) => [styles.chatBtn, pressed && { backgroundColor: t.inputFill }]}>
                      <View style={styles.chatBtnIcon}>
                        <Ionicons name="chatbubbles-outline" size={19} color={t.textPrimary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.chatBtnTitle}>Ask Cents</Text>
                        <Text style={styles.chatBtnSub}>Log, ask, or check anything in English or Tagalog</Text>
                      </View>
                      <Pressable
                        onPress={() => openChat({ voice: true })}
                        style={({ pressed }) => [styles.micBtn, pressed && { transform: [{ scale: 0.9 }] }]}
                        hitSlop={6}
                      >
                        <Ionicons name="mic-outline" size={20} color={t.textPrimary} />
                      </Pressable>
                    </Pressable>
                  </>
                )}

                {(mode === 'expense' || mode === 'income') && (
                  <>
                    <View style={styles.headRow}>
                      <Pressable style={styles.closeBtn} onPress={() => backTo('menu')}>
                        <Ionicons name="chevron-back" size={18} color={t.textPrimary} />
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.headTitle}>{mode === 'expense' ? 'Add an expense' : 'Add income'}</Text>
                        <Text style={styles.headSub}>
                          {mode === 'expense' ? 'Where did it go?' : 'Which wallet does it land in?'}
                        </Text>
                      </View>
                      <View style={styles.headIconBadge}>
                        <Ionicons name={mode === 'expense' ? 'receipt' : 'cash'} size={19} color={t.emerald} />
                      </View>
                    </View>

                    {/* Step 1: the calculator. No system keyboard at all. */}
                    {entryStep === 'amount' && (
                      <>
                        <View style={styles.calcDisplay}>
                          {calcAcc > 0 && (
                            <Text style={styles.calcExpr}>{peso(calcAcc)} + {calcEntry || '0'}</Text>
                          )}
                          <Text style={styles.calcTotal} numberOfLines={1}>{peso(calcTotal)}</Text>
                        </View>
                        <View style={styles.calcGrid}>
                          {[
                            ['1', '2', '3', 'back'],
                            ['4', '5', '6', 'plus'],
                            ['7', '8', '9', 'clear'],
                            ['.', '0', '00', 'next'],
                          ].map((row, ri) => (
                            <View key={ri} style={styles.calcRow}>
                              {row.map((k) => {
                                const isNext = k === 'next';
                                const isOp = k === 'back' || k === 'plus' || k === 'clear';
                                return (
                                  <Pressable
                                    key={k}
                                    onPress={() => (isNext ? confirmCalc() : tapKey(k))}
                                    style={({ pressed }) => [
                                      styles.calcKey,
                                      isNext && { backgroundColor: calcTotal > 0 ? t.emerald : t.inputFill, borderColor: calcTotal > 0 ? t.emerald : t.border },
                                      pressed && !isNext && { backgroundColor: t.emeraldTint },
                                    ]}
                                  >
                                    {k === 'back' && <Ionicons name="backspace-outline" size={20} color={t.textPrimary} />}
                                    {k === 'plus' && <Ionicons name="add" size={22} color={t.emerald} />}
                                    {k === 'clear' && <Text style={[styles.calcKeyText, { color: t.textMuted }]}>C</Text>}
                                    {isNext && <Ionicons name="arrow-forward" size={20} color={calcTotal > 0 ? t.onEmerald : t.textMuted} />}
                                    {!isOp && !isNext && <Text style={styles.calcKeyText}>{k}</Text>}
                                  </Pressable>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      </>
                    )}

                    {/* Step 2: name it and route it. */}
                    {entryStep === 'details' && (
                      <Pressable onPress={backToCalc} style={({ pressed }) => [styles.amountPill, pressed && { backgroundColor: t.emeraldTint }]}>
                        <Text style={styles.amountPillValue}>{peso(parseFloat(amount) || 0)}</Text>
                        <View style={styles.amountPillEdit}>
                          <Ionicons name="pencil" size={13} color={t.emerald} />
                          <Text style={styles.amountPillEditText}>Edit</Text>
                        </View>
                      </Pressable>
                    )}

                    {entryStep === 'details' && mode === 'expense' && (
                      <>
                        <Text style={styles.fieldLabel}>BUDGET</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll} keyboardShouldPersistTaps="always">
                          {categories.map((c) => {
                            const active = pickedCat === c.name;
                            return (
                              <Pressable key={c.id} style={[styles.catChip, active && styles.catChipActive]} onPress={() => setPickedCat(c.name)}>
                                <Ionicons name={(c.icon as any) || 'pricetag'} size={13} color={active ? t.onEmerald : t.emerald} />
                                <Text style={[styles.catChipText, active && { color: t.onEmerald }]}>{c.name}</Text>
                              </Pressable>
                            );
                          })}
                          {categories.length === 0 && <Text style={styles.emptyMenu}>No budgets yet. Add one in Goals.</Text>}
                        </ScrollView>
                      </>
                    )}

                    {entryStep === 'details' && <AccountPicker optional={mode === 'expense'} />}

                    {entryStep === 'details' && (
                      <TextInput
                        style={styles.noteInput}
                        placeholder={mode === 'expense' ? 'Note (e.g. Jollibee run)' : 'Note (e.g. July salary)'}
                        placeholderTextColor={t.textMuted}
                        value={note}
                        onChangeText={setNote}
                        returnKeyType="done"
                        blurOnSubmit
                      />
                    )}

                    {entryStep === 'details' && (
                    <Pressable
                      disabled={mode === 'expense' ? !(validAmount && pickedCat) : !(validAmount && pickedAcct)}
                      onPress={mode === 'expense' ? submitExpense : submitIncome}
                      style={({ pressed }) => pressed && { transform: [{ scale: 0.985 }] }}
                    >
                      <View
                        style={[
                          styles.submit,
                          { backgroundColor: (mode === 'expense' ? validAmount && pickedCat : validAmount && pickedAcct) ? t.emerald : t.inputFill },
                        ]}
                      >
                        <Text style={[
                          styles.submitText,
                          !(mode === 'expense' ? validAmount && pickedCat : validAmount && pickedAcct) && { color: t.textMuted },
                        ]}>
                          {mode === 'expense' ? 'Log expense' : 'Add income'}
                        </Text>
                      </View>
                    </Pressable>
                    )}
                  </>
                )}
                </ScrollView>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function QuickTile({ styles, t, icon, tint, label, onPress }: any) {
  return (
    <Pressable style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.96 }] }]} onPress={onPress}>
      {/* v4: neutral chip, colored glyph only — accents stay scarce. */}
      <View style={[styles.tileIcon, { backgroundColor: 'transparent', borderColor: t.border }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  // Floating modal: a soft neutral shadow is allowed here (v4 rule).
  sheetShadow: {
    marginHorizontal: 10,
    shadowColor: '#000000', shadowOpacity: 0.20, shadowRadius: 18, shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  sheetClip: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: t.border,
    borderBottomWidth: 0,
  },
  sheetInner: { padding: 22, paddingTop: 12 },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 16 },
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 8, paddingBottom: 4, marginTop: -8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headTitle: { color: t.textPrimary, fontSize: 19, fontWeight: '800' },
  headBadge: {
    width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  headIconBadge: {
    width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  headSub: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.07)' : t.inputFill,
    borderWidth: 1, borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.12)' : t.borderSoft,
  },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: {
    flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16, borderRadius: radius.tile,
    backgroundColor: t.inputFill,
    borderWidth: 1, borderColor: t.border,
  },
  tileIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tileLabel: { color: t.textPrimary, fontSize: 12, fontWeight: '700' },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.card, padding: 14,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border,
  },
  chatBtnIcon: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  chatBtnTitle: { color: t.textPrimary, fontSize: 15.5, fontWeight: '700' },
  chatBtnSub: { color: t.textMuted, fontSize: 11.5, marginTop: 1 },
  micBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border,
  },
  fieldLabel: { ...type.eyebrow, color: t.textFaint, marginTop: 12, marginBottom: 8 },
  chipScroll: { gap: 8, paddingRight: 8 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  catChipActive: { backgroundColor: t.emerald, borderColor: t.emerald },
  catChipText: { color: t.textPrimary, fontSize: 12.5, fontWeight: '700' },
  acctSelect: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  acctSelectText: { color: t.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  acctSelectBal: { color: t.textMuted, fontSize: 12, fontWeight: '700', ...type.money },
  acctPlaceholderIcon: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  // v5.6: IN-FLOW dropdown. An absolute overlay near the sheet bottom got
  // clipped past the screen edge and, adding no height, gave the outer
  // ScrollView nothing to scroll toward - bottom rows were unreachable.
  acctMenu: {
    marginTop: 8,
    borderRadius: 16, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
  },
  acctMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  acctMenuText: { color: t.textPrimary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  acctMenuBal: { color: t.textMuted, fontSize: 12, ...type.money },
  emptyMenu: { color: t.textMuted, fontSize: 12.5, padding: 12 },
  noteInput: {
    height: 46, borderRadius: 14, paddingHorizontal: 13, marginTop: 12,
    color: t.textPrimary, fontSize: 14,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  // Calculator-first entry
  calcDisplay: { alignItems: 'flex-end', paddingVertical: 10, paddingHorizontal: 4, minHeight: 64, justifyContent: 'flex-end' },
  calcExpr: { color: t.textFaint, fontSize: 13, fontWeight: '600', ...type.money },
  calcTotal: { color: t.textPrimary, fontSize: 34, fontWeight: '800', ...type.money },
  calcGrid: { gap: 8, marginBottom: 14 },
  calcRow: { flexDirection: 'row', gap: 8 },
  calcKey: {
    flex: 1, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border,
  },
  calcKeyText: { color: t.textPrimary, fontSize: 19, fontWeight: '700', ...type.money },
  amountPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: radius.input, borderWidth: 1, borderColor: t.emeraldBorder,
    backgroundColor: t.emeraldTint, paddingHorizontal: 14, height: 52, marginBottom: 12,
  },
  amountPillValue: { color: t.textPrimary, fontSize: 20, fontWeight: '800', ...type.money },
  amountPillEdit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amountPillEditText: { color: t.emerald, fontSize: 13, fontWeight: '700' },
  submit: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  submitText: { color: t.onEmerald, fontSize: 15.5, fontWeight: '800' },
});
