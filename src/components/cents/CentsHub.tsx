// M5: the Cents hub — what the center tab-bar button opens.
// A glassmorphic bottom sheet with quick actions (Add Expense / Add Income /
// Scan) plus the entry into the full Cents chat overlay. Rendered as an
// animated absolute overlay (NOT an RN Modal) so the chat/camera layers never
// fight iOS presentation rules.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { MoneyInput } from '../MoneyInput';
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
  const { hubOpen, closeHub, openChat } = useUI();
  const { accounts, categories, country, addExpense, addIncome } = useFinance();

  const [mode, setMode] = useState<Mode>('menu');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pickedCat, setPickedCat] = useState<string | null>(null);
  const [pickedAcct, setPickedAcct] = useState<string | null>(null);
  const [acctMenu, setAcctMenu] = useState(false);

  // Slide-up + backdrop fade
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (hubOpen) {
      setMode('menu'); setAmount(''); setNote(''); setPickedCat(null); setPickedAcct(null); setAcctMenu(false);
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
      <Pressable style={[styles.acctSelect, acctMenu && { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint }]} onPress={() => setAcctMenu((v) => !v)}>
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
              <Text style={styles.acctMenuText}>{a.name}</Text>
              <Text style={styles.acctMenuBal}>{peso(a.balance)}</Text>
              {pickedAcct === a.id && <Ionicons name="checkmark-circle" size={16} color={t.emerald} />}
            </Pressable>
          ))}
          {accounts.length === 0 && (
            <Text style={styles.emptyMenu}>No accounts yet. Add one in the Wallet tab.</Text>
          )}
        </View>
      )}
    </View>
  );

  const backTo = (m: Mode) => { Keyboard.dismiss(); setAcctMenu(false); setMode(m); };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop: darkened + blurred so the user stays in context */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
          <BlurView intensity={26} tint={t.mode === 'dark' ? 'dark' : 'default'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,15,9,0.42)' }]} />
        </Pressable>
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
        <Animated.View
          style={{
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
            opacity: anim,
          }}
        >
          {/* Glass sheet */}
          <View style={styles.sheetShadow}>
            <View style={styles.sheetClip}>
              <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
              <LinearGradient
                colors={
                  t.mode === 'dark'
                    ? ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.03)']
                    : ['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.72)']
                }
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.sheetInner, { paddingBottom: 20 + insets.bottom }]}>
                <View style={styles.handle} />

                {mode === 'menu' && (
                  <>
                    <View style={styles.headRow}>
                      <LinearGradient colors={[t.emerald, t.teal]} style={styles.headBadge}>
                        <Ionicons name="sparkles" size={20} color={t.onEmerald} />
                      </LinearGradient>
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
                      <QuickTile styles={styles} t={t} icon="scan" tint={t.teal} label="Scan" onPress={() => openChat({ camera: true })} />
                    </View>

                    {/* Chat + voice entries */}
                    <Pressable onPress={() => openChat()} style={({ pressed }) => pressed && { transform: [{ scale: 0.985 }] }}>
                      <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.chatBtn}>
                        <LinearGradient
                          colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
                          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.9 }}
                          style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.chatBtnIcon}>
                          <Ionicons name="chatbubbles" size={19} color={t.onEmerald} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chatBtnTitle}>Chat with Cents</Text>
                          <Text style={styles.chatBtnSub}>Log, ask, or check anything in English or Tagalog</Text>
                        </View>
                        <Pressable
                          onPress={() => openChat({ voice: true })}
                          style={({ pressed }) => [styles.micBtn, pressed && { transform: [{ scale: 0.9 }] }]}
                          hitSlop={6}
                        >
                          <Ionicons name="mic" size={20} color={t.emerald} />
                        </Pressable>
                      </LinearGradient>
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

                    <MoneyInput value={amount} onChangeText={setAmount} autoFocus />

                    {mode === 'expense' && (
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

                    <AccountPicker optional={mode === 'expense'} />

                    <TextInput
                      style={styles.noteInput}
                      placeholder={mode === 'expense' ? 'Note (e.g. Jollibee run)' : 'Note (e.g. July salary)'}
                      placeholderTextColor={t.textMuted}
                      value={note}
                      onChangeText={setNote}
                      returnKeyType="done"
                    />

                    <Pressable
                      disabled={mode === 'expense' ? !(validAmount && pickedCat) : !(validAmount && pickedAcct)}
                      onPress={mode === 'expense' ? submitExpense : submitIncome}
                      style={({ pressed }) => pressed && { transform: [{ scale: 0.985 }] }}
                    >
                      <LinearGradient
                        colors={
                          (mode === 'expense' ? validAmount && pickedCat : validAmount && pickedAcct)
                            ? [t.emerald, t.teal]
                            : [t.inputFill, t.inputFill]
                        }
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.submit}
                      >
                        <Text style={[
                          styles.submitText,
                          !(mode === 'expense' ? validAmount && pickedCat : validAmount && pickedAcct) && { color: t.textMuted },
                        ]}>
                          {mode === 'expense' ? 'Log expense' : 'Add income'}
                        </Text>
                      </LinearGradient>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function QuickTile({ styles, t, icon, tint, label, onPress }: any) {
  return (
    <Pressable style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.96 }] }]} onPress={onPress}>
      <View style={[styles.tileIcon, { backgroundColor: tint + '1E', borderColor: tint + '45' }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheetShadow: {
    marginHorizontal: 10,
    shadowColor: '#02170D', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  sheetClip: {
    borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden',
    borderWidth: 1.2, borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.95)',
    borderBottomWidth: 0,
  },
  sheetInner: { padding: 22, paddingTop: 12 },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headTitle: { color: t.textPrimary, fontSize: 19, fontWeight: '800' },
  headBadge: {
    width: 46, height: 46, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    shadowColor: t.emerald, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 5 },
  },
  headIconBadge: {
    width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  headSub: { color: t.textMuted, fontSize: 12.5, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: {
    flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16, borderRadius: 20,
    backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.75)',
    borderWidth: 1, borderColor: t.border,
  },
  tileIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tileLabel: { color: t.textPrimary, fontSize: 12, fontWeight: '700' },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 22, padding: 14, overflow: 'hidden',
    shadowColor: t.emerald, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  chatBtnIcon: {
    width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chatBtnTitle: { color: t.onEmerald, fontSize: 15.5, fontWeight: '800' },
  chatBtnSub: { color: t.mode === 'dark' ? 'rgba(4,20,13,0.75)' : 'rgba(255,255,255,0.85)', fontSize: 11.5, marginTop: 1 },
  micBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#02170D', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
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
  acctMenu: {
    position: 'absolute', top: 76, left: 0, right: 0, zIndex: 40,
    borderRadius: 16, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.menuBg, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
    elevation: 14,
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
  submit: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  submitText: { color: t.onEmerald, fontSize: 15.5, fontWeight: '800' },
});
