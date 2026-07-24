import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../src/components/GlassCard';
import { MoneyInput, formatMoneyRaw } from '../../src/components/MoneyInput';
import { Palette, radius, type, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { peso } from '../../src/models/types';
import { COUNTRIES, institutionFor } from '../../src/data/countries';

const THEME_OPTS = ['light', 'dark', 'system'] as const;

export default function ProfileScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const {
    profile, accounts, logout, themeMode, setThemeMode,
    country, setCountry, addAccount, removeAccount, setAccountBalance,
    updateProfile, biometricsEnabled, setBiometricsEnabled,
  } = useFinance();
  const router = useRouter();
  const goals = useFinance((st) => st.goals);
  const totalLiquid = accounts.reduce((a, x) => a + x.balance, 0);
  const countryData = COUNTRIES[country];

  const [countrySheet, setCountrySheet] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState('#10B981');
  const [accountSheet, setAccountSheet] = useState(false);
  const [editName, setEditName] = useState(profile.name);
  const [editEmail, setEditEmail] = useState(profile.email);
  const [securitySheet, setSecuritySheet] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; balance: string } | null>(null);

  // Animated theme segmented indicator
  const segIndex = THEME_OPTS.indexOf(themeMode);
  const segAnim = useRef(new Animated.Value(segIndex)).current;
  useEffect(() => {
    Animated.spring(segAnim, { toValue: segIndex, friction: 7, tension: 160, useNativeDriver: true }).start();
  }, [segIndex, segAnim]);

  const doLogout = () => {
    logout();
    router.replace('/auth');
  };

  const saveBalance = () => {
    if (!editing) return;
    const v = parseFloat(editing.balance);
    if (!Number.isNaN(v) && v >= 0) setAccountBalance(editing.id, v);
    setEditing(null);
  };

  const InstTile = ({ name, size = 40, colorOverride, initialOverride }: {
    name: string; size?: number; colorOverride?: string; initialOverride?: string;
  }) => {
    const inst = institutionFor(country, name);
    const color = colorOverride ?? inst?.color ?? t.emerald;
    return (
      <View
        style={{
          width: size, height: size, borderRadius: size * 0.34,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55',
        }}
      >
        <Text style={{ color, fontSize: size * 0.34, fontWeight: '800' }}>
          {initialOverride ?? inst?.initial ?? name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  };

  const SettingRow = ({ icon, label, value, divider, onPress }: {
    icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; divider?: boolean; onPress?: () => void;
  }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, divider && styles.dividerTop, pressed && onPress && { backgroundColor: t.inputFill }]}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={t.emerald} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>Profile</Text>

        <GlassCard glow style={{ marginBottom: 24 }}>
          <View style={styles.userRow}>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            </LinearGradient>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.userName} numberOfLines={1}>{profile.name}</Text>
              <Text style={styles.userEmail} numberOfLines={1}>{profile.email}</Text>
            </View>
            <Pressable
              style={styles.editBtn}
              onPress={() => { setEditName(profile.name); setEditEmail(profile.email); setAccountSheet(true); }}
            >
              <Ionicons name="pencil" size={15} color={t.emerald} />
            </Pressable>
          </View>

          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>TOTAL LIQUID BALANCE</Text>
            <View style={styles.balanceRow2}>
              <Text style={styles.balanceBig}>{peso(totalLiquid)}</Text>
              <View style={styles.miniPills}>
                <View style={styles.miniPill}>
                  <Ionicons name="wallet" size={11} color={t.emerald} />
                  <Text style={styles.miniPillText}>{accounts.length} sources</Text>
                </View>
                <View style={styles.miniPill}>
                  <Ionicons name="flag" size={11} color={t.emerald} />
                  <Text style={styles.miniPillText}>{goals.length} goal{goals.length === 1 ? '' : 's'}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.trialRow}>
            <View style={styles.trialIcon}>
              <Ionicons name="diamond" size={13} color={t.purple} />
            </View>
            <Text style={styles.trialLabel}>Free trial</Text>
            <Text style={styles.trialDays}>30 days left</Text>
            <Ionicons name="chevron-forward" size={14} color={t.textMuted} />
          </View>
        </GlassCard>

        {/* Accounts */}
        <Text style={styles.eyebrow}>YOUR ACCOUNTS</Text>
        <GlassCard pad={8} style={{ marginBottom: 24 }}>
          {accounts.length === 0 && (
            <Text style={styles.emptyText}>No accounts yet — add one below.</Text>
          )}
          {accounts.map((a, i, arr) => (
            <View key={a.id} style={[styles.acctRow, styles.divider]}>
              <InstTile name={a.name} colorOverride={a.color} initialOverride={a.initial} />
              <Pressable
                style={{ flex: 1 }}
                onPress={() => setEditing({ id: a.id, name: a.name, balance: a.balance ? String(a.balance) : '' })}
              >
                <Text style={styles.acctName}>{a.name}</Text>
                <Text style={styles.acctHint}>Tap to edit balance</Text>
              </Pressable>
              <Text style={styles.acctBalance}>{peso(a.balance)}</Text>
              <Pressable style={styles.trash} onPress={() => removeAccount(a.id)}>
                <Ionicons name="trash-outline" size={16} color={t.red} />
              </Pressable>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.addRow, pressed && { backgroundColor: t.inputFill }]}
            onPress={() => setAddSheet(true)}
          >
            <View style={styles.addRowIcon}>
              <Ionicons name="add" size={18} color={t.emerald} />
            </View>
            <Text style={styles.addRowText}>Add account</Text>
            <Text style={styles.addRowHint}>{countryData.flag} {countryData.institutions.length} available</Text>
          </Pressable>
        </GlassCard>

        {/* Settings */}
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <GlassCard pad={8} style={{ marginBottom: 24 }}>
          {/* Appearance with animated segmented control */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="color-palette" size={16} color={t.emerald} />
            </View>
            <Text style={styles.rowLabel}>Appearance</Text>
            <View style={styles.segmented}>
              <Animated.View
                style={[
                  styles.segIndicator,
                  { transform: [{ translateX: segAnim.interpolate({ inputRange: [0, 2], outputRange: [0, 76] }) }] },
                ]}
              >
                <LinearGradient colors={[t.emerald, t.teal]} style={{ flex: 1, borderRadius: 999 }} />
              </Animated.View>
              {THEME_OPTS.map((m) => (
                <Pressable key={m} style={styles.segment} onPress={() => setThemeMode(m)}>
                  <Ionicons
                    name={m === 'light' ? 'sunny' : m === 'dark' ? 'moon' : 'contrast'}
                    size={14}
                    color={themeMode === m ? t.onEmerald : t.textMuted}
                  />
                </Pressable>
              ))}
            </View>
          </View>
          <SettingRow
            icon="person-circle" label="Account"
            value={profile.name}
            divider onPress={() => { setEditName(profile.name); setEditEmail(profile.email); setAccountSheet(true); }}
          />
          <SettingRow
            icon="lock-closed" label="Security"
            value={biometricsEnabled ? 'Face ID on' : 'Face ID off'}
            divider onPress={() => setSecuritySheet(true)}
          />
          <SettingRow
            icon="globe" label="Country & currency"
            value={`${countryData.flag} ${countryData.symbol}`}
            divider onPress={() => setCountrySheet(true)}
          />
          <SettingRow icon="notifications" label="Notifications" value="On" divider />
          <SettingRow icon="diamond" label="Subscription" value="Trial" divider />
          <SettingRow icon="shield-checkmark" label="Privacy & data" divider />
          <SettingRow icon="help-circle" label="Help & support" divider />
        </GlassCard>

        <Pressable style={styles.logout} onPress={doLogout}>
          <Ionicons name="log-out" size={18} color={t.red} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>

        <Text style={styles.version}>SaveCents v1.0 (M1 build)</Text>
        <View style={{ height: 132 }} />
      </ScrollView>


      {/* Add account: one tap per institution */}
      <Modal visible={addSheet} transparent animationType="slide" onRequestClose={() => setAddSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setAddSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Add account</Text>
            <Text style={styles.sheetSub}>
              {countryData.flag} {countryData.name} — one tap to add, then set the balance from your list.
            </Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {countryData.institutions.map((inst, i, arr) => {
                const added = accounts.some((a) => a.name.toLowerCase() === inst.name.toLowerCase());
                return (
                  <Pressable
                    key={inst.name}
                    disabled={added}
                    onPress={() => addAccount(inst.name)}
                    style={({ pressed }) => [
                      styles.instRow,
                      i < arr.length - 1 && styles.divider,
                      pressed && !added && { backgroundColor: t.inputFill },
                    ]}
                  >
                    <InstTile name={inst.name} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.instName, added && { color: t.textMuted }]}>{inst.name}</Text>
                      <Text style={styles.instKind}>{inst.kind === 'wallet' ? 'E-wallet' : inst.kind === 'bank' ? 'Bank' : 'Physical cash'}</Text>
                    </View>
                    {added ? (
                      <View style={styles.addedBadge}>
                        <Ionicons name="checkmark" size={12} color={t.emerald} />
                        <Text style={styles.addedText}>Added</Text>
                      </View>
                    ) : (
                      <View style={styles.addBadge}>
                        <Ionicons name="add" size={16} color={t.onEmerald} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.customDivider} />
            {!customMode ? (
              <Pressable style={styles.customToggle} onPress={() => setCustomMode(true)}>
                <Ionicons name="color-wand" size={16} color={t.emerald} />
                <Text style={styles.customToggleText}>Create a custom bank or wallet</Text>
              </Pressable>
            ) : (
              <View>
                <TextInput
                  style={styles.input}
                  placeholder="Name (e.g. Payroll Card)"
                  placeholderTextColor={t.textMuted}
                  value={customName}
                  onChangeText={setCustomName}
                  returnKeyType="done"
                />
                <View style={styles.swatchRow}>
                  {['#10B981', '#0071F2', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#64748B'].map((c) => (
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
                  onPress={() => {
                    if (!customName.trim()) return;
                    addAccount(customName.trim(), customColor, customName.trim().slice(0, 2).toUpperCase());
                    setCustomName(''); setCustomMode(false);
                  }}
                >
                  <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                    <Text style={styles.submitText}>Add custom account</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            )}
          </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>


      {/* Account settings */}
      <Modal visible={accountSheet} transparent animationType="slide" onRequestClose={() => setAccountSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setAccountSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Account</Text>
              <Text style={styles.sheetSub}>Your profile details. Password and email verification arrive with cloud accounts (M3).</Text>
              <TextInput
                style={styles.input} placeholder="Full name" placeholderTextColor={t.textMuted}
                value={editName} onChangeText={setEditName} returnKeyType="done"
              />
              <TextInput
                style={styles.input} placeholder="Email" placeholderTextColor={t.textMuted}
                value={editEmail} onChangeText={setEditEmail} autoCapitalize="none" keyboardType="email-address" returnKeyType="done"
              />
              <Pressable style={styles.disabledRow}>
                <Ionicons name="key" size={16} color={t.textFaint} />
                <Text style={styles.disabledText}>Change password — available after cloud sync</Text>
              </Pressable>
              <Pressable onPress={() => { if (editName.trim() && editEmail.trim()) { updateProfile(editName.trim(), editEmail.trim()); setAccountSheet(false); } }}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Save changes</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
        </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Security */}
      <Modal visible={securitySheet} transparent animationType="slide" onRequestClose={() => setSecuritySheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setSecuritySheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Security</Text>
            <View style={styles.secRow}>
              <View style={styles.rowIcon}>
                <Ionicons name="scan-circle-outline" size={16} color={t.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.secLabel}>Biometric unlock</Text>
                <Text style={styles.secSub}>Use Face ID or fingerprint to log in</Text>
              </View>
              <Switch
                value={biometricsEnabled}
                onValueChange={setBiometricsEnabled}
                trackColor={{ true: t.emerald, false: t.inputFill }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={[styles.secRow, { opacity: 0.45 }]}>
              <View style={styles.rowIcon}>
                <Ionicons name="timer-outline" size={16} color={t.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.secLabel}>Auto-lock</Text>
                <Text style={styles.secSub}>Lock after inactivity — coming with cloud accounts</Text>
              </View>
            </View>
            <View style={[styles.secRow, { opacity: 0.45 }]}>
              <View style={styles.rowIcon}>
                <Ionicons name="finger-print" size={16} color={t.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.secLabel}>Confirm large purchases</Text>
                <Text style={styles.secSub}>Face ID before logging big expenses — coming soon</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Country picker */}
      <Modal visible={countrySheet} transparent animationType="slide" onRequestClose={() => setCountrySheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setCountrySheet(false)}>
          <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Country & currency</Text>
            <Text style={styles.sheetSub}>Sets your currency and which banks & wallets you can quick-add.</Text>
            {Object.values(COUNTRIES).map((c, i, arr) => (
              <Pressable
                key={c.code}
                style={[styles.countryRow, i < arr.length - 1 && styles.divider]}
                onPress={() => { setCountry(c.code); setCountrySheet(false); }}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.countryName}>{c.name}</Text>
                  <Text style={styles.countrySub}>{c.institutions.length} banks & wallets · {c.symbol}</Text>
                </View>
                {country === c.code && <Ionicons name="checkmark-circle" size={20} color={t.emerald} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Balance editor */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setEditing(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editing?.name} balance</Text>
              <MoneyInput
                value={editing?.balance ?? ''}
                onChangeText={(v) => editing && setEditing({ ...editing, balance: v })}
                autoFocus
              />
              <Pressable onPress={saveBalance}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
        </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  title: { color: t.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 20 },
  eyebrow: { ...type.eyebrow, color: t.textFaint, marginBottom: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRing: { width: 62, height: 62, borderRadius: 21, padding: 2 },
  avatar: { flex: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: t.insetBg },
  avatarText: { color: t.emerald, fontSize: 24, fontWeight: '800' },
  userName: { color: t.textPrimary, fontSize: 19, fontWeight: '800' },
  userEmail: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  editBtn: {
    width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  balanceBlock: {
    marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.borderSoft,
  },
  balanceLabel: { ...type.eyebrow, color: t.textFaint },
  balanceRow2: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 },
  balanceBig: { color: t.textPrimary, fontSize: 30, fontWeight: '800', ...type.money },
  miniPills: { gap: 6, alignItems: 'flex-end' },
  miniPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  miniPillText: { color: t.emerald, fontSize: 11, fontWeight: '700' },
  trialRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginTop: 14, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: 'rgba(139,92,246,0.10)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)',
  },
  trialIcon: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(139,92,246,0.18)',
  },
  trialLabel: { color: t.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
  trialDays: { color: t.purple, fontSize: 12, fontWeight: '800' },
  emptyText: { color: t.textMuted, fontSize: 13, padding: 14 },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  acctName: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  acctHint: { color: t.textFaint, fontSize: 11, marginTop: 1 },
  acctBalance: { color: t.textPrimary, fontSize: 14, fontWeight: '800', ...type.money },
  trash: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.redTint,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: t.borderSoft },
  dividerTop: { borderTopWidth: 1, borderTopColor: t.borderSoft },
  rowIcon: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint,
  },
  rowLabel: { color: t.textPrimary, fontSize: 14, flex: 1 },
  rowValue: { color: t.textMuted, fontSize: 13 },
  segmented: {
    flexDirection: 'row', gap: 4, padding: 3, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  segIndicator: { position: 'absolute', top: 3, left: 3, width: 34, height: 28, borderRadius: 999 },
  segment: { width: 34, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,77,77,0.35)',
    backgroundColor: t.redTint,
  },
  logoutText: { color: t.red, fontSize: 15, fontWeight: '600' },
  version: { color: t.textFaint, fontSize: 11, textAlign: 'center', marginTop: 16 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  addRowIcon: {
    width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder, borderStyle: 'dashed',
  },
  addRowText: { color: t.emerald, fontSize: 14, fontWeight: '800', flex: 1 },
  addRowHint: { color: t.textFaint, fontSize: 12 },
  instRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12 },
  instName: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  instKind: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  addBadge: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emerald,
  },
  addedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
  },
  addedText: { color: t.emerald, fontSize: 11, fontWeight: '800' },
  sheetSub2: { color: t.textMuted, fontSize: 12, marginBottom: 12 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  sheetSub: { color: t.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flag: { fontSize: 26 },
  countryName: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  countrySub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  input: {
    height: 54, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 22, fontWeight: '800',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, marginBottom: 12,
    ...type.money,
  },
  submit: { height: 52, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  customDivider: { height: 1, backgroundColor: t.borderSoft, marginVertical: 12 },
  customToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46 },
  customToggleText: { color: t.emerald, fontSize: 14, fontWeight: '800' },
  swatchRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchSel: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  disabledRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 46, borderRadius: radius.input, paddingHorizontal: 14, marginBottom: 12,
    backgroundColor: t.inputFill, opacity: 0.6,
  },
  disabledText: { color: t.textFaint, fontSize: 13 },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  secLabel: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },
  secSub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  submitText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },
});
