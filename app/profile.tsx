// M5 redesign: Profile. Centered identity block, then grouped settings cards
// (Account / Preferences / Privacy & Security), a full-width log out button,
// and a version footer. Every row performs a real action.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../src/components/GlassCard';
import { AVATARS, AvatarBadge } from '../src/components/Avatar';
import { Palette, radius, type, useTheme } from '../src/theme/colors';
import { useFinance } from '../src/store/finance';
import { COUNTRIES } from '../src/data/countries';
import { authAvailable, authErrorMessage, changePassword, deleteAccount, resetPassword, signOutFirebase, getFirebaseAuth } from '../src/services/auth';
import { OtpUnavailableError, requestPasswordOtp, verifyPasswordOtp } from '../src/services/otp';
import { ensureNotificationPermission } from '../src/services/notifications';
import { clearLastUid, deleteCloudData, stopAutoSync } from '../src/services/sync';

const THEME_OPTS = ['light', 'dark', 'system'] as const;


// Rule 3.1: module scope, not inside the screen's render body.
const Row = ({ styles, t, icon, label, value, onPress, right, danger, divider }: {
  styles: any; t: Palette;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  divider?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    style={({ pressed }) => [styles.row, divider && styles.rowDivider, pressed && onPress && { backgroundColor: t.inputFill }]}
  >
    <View style={[styles.rowIcon, danger && { backgroundColor: t.redTint }]}>
      <Ionicons name={icon} size={16} color={danger ? t.red : t.emerald} />
    </View>
    <Text style={[styles.rowLabel, danger && { color: t.red }]}>{label}</Text>
    {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={t.textMuted} /> : null)}
  </Pressable>
);

export default function ProfileScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const {
    profile, logout, themeMode, setThemeMode,
    country, setCountry, updateProfile, resetToDefaults,
    biometricsEnabled, setBiometricsEnabled,
    notificationsEnabled, setNotificationsEnabled,
    updatePersona,
  } = useFinance();
  const countryData = COUNTRIES[country];

  const [countrySheet, setCountrySheet] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);
  const [editName, setEditName] = useState(profile.name);
  const [editEmail, setEditEmail] = useState(profile.email);
  // Persona sheet: nickname + avatar only, never login details.
  const [personaSheet, setPersonaSheet] = useState(false);
  const [nick, setNick] = useState(profile.nickname ?? '');
  const [pickedAvatar, setPickedAvatar] = useState<string | null>(profile.avatarId ?? null);

  // Animated theme segmented indicator
  const segIndex = THEME_OPTS.indexOf(themeMode);
  const segAnim = useRef(new Animated.Value(segIndex)).current;
  useEffect(() => {
    Animated.spring(segAnim, { toValue: segIndex, friction: 7, tension: 160, useNativeDriver: true }).start();
  }, [segIndex, segAnim]);

  const openPersona = () => {
    setNick(profile.nickname ?? '');
    setPickedAvatar(profile.avatarId ?? null);
    setPersonaSheet(true);
  };

  const savePersona = () => {
    updatePersona(nick, pickedAvatar);
    setPersonaSheet(false);
  };

  const openLoginEdit = () => {
    setEditName(profile.name);
    setEditEmail(profile.email);
    setAccountSheet(true);
  };

  // Password change: OTP to the current email first, then the new password.
  type PwStep = 'send' | 'code' | 'new';
  const [pwSheet, setPwSheet] = useState(false);
  const [pwStep, setPwStep] = useState<PwStep>('send');
  const [pwCode, setPwCode] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const openPasswordFlow = () => {
    setPwStep('send'); setPwCode(''); setPwNew(''); setPwNew2(''); setPwError(''); setPwBusy(false);
    setPwSheet(true);
  };

  const sendOtp = async () => {
    setPwError(''); setPwBusy(true);
    try {
      const r = await requestPasswordOtp(profile.email);
      if (r.devCode) {
        // Development delivery: no email backend yet (see src/services/otp.ts).
        Alert.alert('Verification code', r.devCode);
      }
      setPwCode('');
      setPwStep('code');
    } catch (e) {
      if (e instanceof OtpUnavailableError && authAvailable()) {
        // No OTP channel in this build: use Firebase's real reset email so the
        // user still verifies through their inbox.
        try {
          await resetPassword(profile.email);
          setPwSheet(false);
          Alert.alert('Check your email', `We sent a password reset link to ${profile.email}.`);
        } catch (e2) {
          setPwError(authErrorMessage(e2));
        }
      } else {
        setPwError((e as Error)?.message ?? 'Could not send the code.');
      }
    } finally {
      setPwBusy(false);
    }
  };

  const confirmOtp = () => {
    setPwError('');
    const r = verifyPasswordOtp(pwCode);
    if (!r.ok) { setPwError(r.reason ?? 'That code is not right.'); return; }
    setPwStep('new');
  };

  const savePassword = async () => {
    setPwError('');
    if (pwNew.length < 8) { setPwError('Use at least 8 characters.'); return; }
    if (pwNew !== pwNew2) { setPwError('Passwords do not match.'); return; }
    setPwBusy(true);
    try {
      const outcome = await changePassword(pwNew);
      setPwSheet(false);
      if (outcome === 'reset-email-sent') {
        Alert.alert('One more step', `For security we emailed a reset link to ${profile.email}. Open it to finish changing your password.`);
      } else {
        Alert.alert('Password updated', 'Use your new password the next time you log in.');
      }
    } catch (e) {
      setPwError(authErrorMessage(e));
    } finally {
      setPwBusy(false);
    }
  };

  const doLogout = async () => {
    stopAutoSync();
    try { await signOutFirebase(); } catch { /* offline logout is fine */ }
    logout();
    router.replace('/auth');
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and all synced data (budgets, transactions, goals). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete forever', style: 'destructive', onPress: doDeleteAccount },
      ],
    );
  };

  const doDeleteAccount = async () => {
    try {
      stopAutoSync();
      if (authAvailable()) {
        const u = getFirebaseAuth().currentUser;
        if (u) await deleteCloudData(u.uid);
        await deleteAccount();
      }
      await clearLastUid();
      resetToDefaults();
      router.replace('/auth');
    } catch (e) {
      Alert.alert('Could not delete account', authErrorMessage(e));
    }
  };

  const contactSupport = () => {
    Linking.openURL('mailto:support@savecents.app?subject=SaveCents%20support').catch(() =>
      Alert.alert('Support', 'Email us at support@savecents.app'),
    );
  };

  // M5.6: turning notifications ON asks iOS for real permission; if the user
  // denied it at the system level, the switch snaps back with directions.
  const toggleNotifications = async (v: boolean) => {
    setNotificationsEnabled(v);
    if (v) {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        setNotificationsEnabled(false);
        Alert.alert('Notifications are off in iOS Settings', 'Open Settings, find SaveCents, and allow notifications, then flip this switch again.');
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Nav */}
        <View style={styles.navRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={t.textPrimary} />
          </Pressable>
          <Text style={styles.navTitle}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <View>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.avatarRing}>
              <View style={styles.avatar}>
                <AvatarBadge avatarId={profile.avatarId} name={profile.name} size={74} />
              </View>
            </LinearGradient>
            <Pressable onPress={openPersona} style={styles.avatarEdit} hitSlop={6}>
              <Ionicons name="pencil" size={13} color={t.onEmerald} />
            </Pressable>
          </View>
          <Text style={styles.name}>{profile.nickname?.trim() || profile.name}</Text>
          <Text style={styles.email}>{profile.email}</Text>

          {/* Subscription */}
          <View style={styles.planCard}>
            <View style={styles.planIcon}>
              <Ionicons name="diamond" size={15} color={t.emerald} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Free plan</Text>
              <Text style={styles.planSub}>All core features included</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.planBtn, pressed && { opacity: 0.75 }]}
              onPress={() => Alert.alert('Coming soon', 'Plan management is on its way.')}
            >
              <Text style={styles.planBtnText}>Manage</Text>
            </Pressable>
          </View>
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <GlassCard pad={6} style={styles.card}>
          <Row styles={styles} t={t} icon="person" label="Nickname & avatar" onPress={openPersona} />
          <Row styles={styles} t={t} icon="key" label="Login" value={profile.email} divider onPress={openLoginEdit} />
          <Row styles={styles} t={t} icon="lock-closed" label="Password" divider onPress={openPasswordFlow} />
        </GlassCard>

        {/* Preferences */}
        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <GlassCard pad={6} style={styles.card}>
          <Row styles={styles} t={t}
            icon="notifications"
            label="Notifications"
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
                trackColor={{ true: t.emerald, false: t.inputFill }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <View style={[styles.row, styles.rowDivider]}>
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
          <Row styles={styles} t={t}
            icon="globe"
            label="Country & currency"
            value={`${countryData.flag} ${countryData.symbol}`}
            divider
            onPress={() => setCountrySheet(true)}
          />
        </GlassCard>

        {/* Privacy & security */}
        <Text style={styles.sectionLabel}>PRIVACY & SECURITY</Text>
        <GlassCard pad={6} style={styles.card}>
          <Row styles={styles} t={t}
            icon="scan-circle"
            label="Face ID unlock"
            right={
              <Switch
                value={biometricsEnabled}
                onValueChange={setBiometricsEnabled}
                trackColor={{ true: t.emerald, false: t.inputFill }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <Row styles={styles} t={t} icon="help-circle" label="Help & support" divider onPress={contactSupport} />
          <Row styles={styles} t={t} icon="trash" label="Delete account" divider danger onPress={confirmDeleteAccount} />
        </GlassCard>

        {/* Log out */}
        <Pressable onPress={doLogout} style={({ pressed }) => pressed && { transform: [{ scale: 0.985 }] }}>
          <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.logout}>
            <Ionicons name="log-out-outline" size={19} color={t.onEmerald} />
            <Text style={styles.logoutText}>Log out</Text>
          </LinearGradient>
        </Pressable>

        <Text style={styles.version}>SaveCents v1.0</Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Password sheet: OTP first, then new password */}
      <Modal visible={pwSheet} transparent animationType="slide" onRequestClose={() => setPwSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setPwSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Change password</Text>

              {pwStep === 'send' && (
                <>
                  <View style={styles.otpInfo}>
                    <View style={styles.otpIcon}>
                      <Ionicons name="mail" size={17} color={t.emerald} />
                    </View>
                    <Text style={styles.otpInfoText}>
                      We will send a 6-digit verification code to {profile.email}.
                    </Text>
                  </View>
                  {pwError ? <Text style={styles.pwError}>{pwError}</Text> : null}
                  <Pressable onPress={sendOtp} disabled={pwBusy}>
                    <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.submit, pwBusy && { opacity: 0.6 }]}>
                      <Text style={styles.submitText}>{pwBusy ? 'Sending' : 'Send code'}</Text>
                    </LinearGradient>
                  </Pressable>
                </>
              )}

              {pwStep === 'code' && (
                <>
                  <Text style={styles.sheetSub}>Enter the code we sent to {profile.email}.</Text>
                  <TextInput
                    style={styles.codeInput}
                    value={pwCode}
                    onChangeText={(v) => setPwCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                    placeholder="000000"
                    placeholderTextColor={t.textFaint}
                  />
                  {pwError ? <Text style={styles.pwError}>{pwError}</Text> : null}
                  <Pressable onPress={confirmOtp} disabled={pwCode.length !== 6}>
                    <LinearGradient
                      colors={pwCode.length === 6 ? [t.emerald, t.teal] : [t.inputFill, t.inputFill]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}
                    >
                      <Text style={[styles.submitText, pwCode.length !== 6 && { color: t.textMuted }]}>Verify</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable onPress={sendOtp} disabled={pwBusy} style={styles.resend}>
                    <Text style={styles.resendText}>{pwBusy ? 'Sending' : 'Resend code'}</Text>
                  </Pressable>
                </>
              )}

              {pwStep === 'new' && (
                <>
                  <Text style={styles.sheetSub}>Verified. Set your new password.</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="New password"
                    placeholderTextColor={t.textMuted}
                    value={pwNew}
                    onChangeText={setPwNew}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Repeat new password"
                    placeholderTextColor={t.textMuted}
                    value={pwNew2}
                    onChangeText={setPwNew2}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  {pwError ? <Text style={styles.pwError}>{pwError}</Text> : null}
                  <Pressable onPress={savePassword} disabled={pwBusy}>
                    <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.submit, pwBusy && { opacity: 0.6 }]}>
                      <Text style={styles.submitText}>{pwBusy ? 'Saving' : 'Save password'}</Text>
                    </LinearGradient>
                  </Pressable>
                </>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Nickname & avatar sheet */}
      <Modal visible={personaSheet} transparent animationType="slide" onRequestClose={() => setPersonaSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setPersonaSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Nickname & avatar</Text>
              <TextInput
                style={styles.input}
                placeholder={`Nickname (currently ${profile.nickname?.trim() || profile.name})`}
                placeholderTextColor={t.textMuted}
                value={nick}
                onChangeText={setNick}
                returnKeyType="done"
                maxLength={20}
              />
              <Text style={styles.avatarLabel}>PICK AN AVATAR</Text>
              <View style={styles.avatarGrid}>
                <Pressable
                  onPress={() => setPickedAvatar(null)}
                  style={[styles.avatarChoice, pickedAvatar === null && styles.avatarChoiceSel]}
                >
                  <AvatarBadge avatarId={null} name={nick.trim() || profile.name} size={52} />
                </Pressable>
                {AVATARS.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => setPickedAvatar(a.id)}
                    style={[styles.avatarChoice, pickedAvatar === a.id && styles.avatarChoiceSel]}
                  >
                    <AvatarBadge avatarId={a.id} name={profile.name} size={52} />
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={savePersona}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Edit profile sheet */}
      <Modal visible={accountSheet} transparent animationType="slide" onRequestClose={() => setAccountSheet(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={styles.scrimFill} onPress={() => setAccountSheet(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Login details</Text>
              <TextInput
                style={styles.input} placeholder="Full name" placeholderTextColor={t.textMuted}
                value={editName} onChangeText={setEditName} returnKeyType="done"
              />
              <TextInput
                style={styles.input} placeholder="Email" placeholderTextColor={t.textMuted}
                value={editEmail} onChangeText={setEditEmail} autoCapitalize="none" keyboardType="email-address" returnKeyType="done"
              />
              <Pressable onPress={() => { if (editName.trim() && editEmail.trim()) { updateProfile(editName.trim(), editEmail.trim()); setAccountSheet(false); } }}>
                <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submit}>
                  <Text style={styles.submitText}>Save changes</Text>
                </LinearGradient>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Country picker */}
      <Modal visible={countrySheet} transparent animationType="slide" onRequestClose={() => setCountrySheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setCountrySheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Country & currency</Text>
            <Text style={styles.sheetSub}>Sets your currency and which banks and wallets you can quick-add.</Text>
            {Object.values(COUNTRIES).map((c, i, arr) => (
              <Pressable
                key={c.code}
                style={[styles.countryRow, i < arr.length - 1 && styles.rowDivider]}
                onPress={() => { setCountry(c.code); setCountrySheet(false); }}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.countryName}>{c.name}</Text>
                  <Text style={styles.countrySub}>{c.institutions.length} banks and wallets · {c.symbol}</Text>
                </View>
                {country === c.code && <Ionicons name="checkmark-circle" size={20} color={t.emerald} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  backBtn: {
    width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
  },
  navTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '800' },

  identity: { alignItems: 'center', gap: 4, marginBottom: 26 },
  avatarRing: { width: 84, height: 84, borderRadius: 42, padding: 3, marginBottom: 10 },
  avatar: { flex: 1, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: t.insetBg, overflow: 'hidden' },
  avatarEdit: {
    position: 'absolute', bottom: 6, right: -4,
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emerald, borderWidth: 2, borderColor: t.bg,
    shadowColor: '#02170D', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  name: { color: t.textPrimary, fontSize: 21, fontWeight: '800' },
  email: { color: t.textMuted, fontSize: 13 },
  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, alignSelf: 'stretch',
    marginTop: 16, borderRadius: 18, padding: 13,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
  },
  planIcon: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  planName: { color: t.textPrimary, fontSize: 14, fontWeight: '800' },
  planSub: { color: t.textMuted, fontSize: 11.5, marginTop: 1 },
  planBtn: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  planBtnText: { color: t.emerald, fontSize: 12.5, fontWeight: '800' },
  avatarLabel: { ...type.eyebrow, color: t.textFaint, marginBottom: 10, marginTop: 2 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  avatarChoice: {
    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'transparent', backgroundColor: t.inputFill,
  },
  avatarChoiceSel: { borderColor: t.emerald, backgroundColor: t.emeraldTint },

  sectionLabel: { ...type.eyebrow, color: t.textFaint, marginBottom: 10 },
  card: { marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.borderSoft },
  rowIcon: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint,
  },
  rowLabel: { color: t.textPrimary, fontSize: 14.5, fontWeight: '600', flex: 1 },
  rowValue: { color: t.textMuted, fontSize: 13 },
  segmented: {
    flexDirection: 'row', gap: 4, padding: 3, borderRadius: 999,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  segIndicator: { position: 'absolute', top: 3, left: 3, width: 34, height: 28, borderRadius: 999 },
  segment: { width: 34, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

  logout: {
    height: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    shadowColor: t.emerald, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
    marginTop: 4,
  },
  logoutText: { color: t.onEmerald, fontSize: 15.5, fontWeight: '800' },
  version: { color: t.textFaint, fontSize: 11, textAlign: 'center', marginTop: 16 },

  otpInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 16, padding: 13, marginBottom: 14,
  },
  otpIcon: {
    width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceStrong,
  },
  otpInfoText: { color: t.textPrimary, fontSize: 13.5, lineHeight: 19, flex: 1 },
  codeInput: {
    height: 60, borderRadius: radius.input, color: t.textPrimary,
    fontSize: 28, fontWeight: '800', letterSpacing: 12, textAlign: 'center',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, marginBottom: 12,
    fontVariant: ['tabular-nums'],
  },
  pwError: { color: t.red, fontSize: 12.5, marginBottom: 10, fontWeight: '600' },
  resend: { alignItems: 'center', paddingVertical: 13 },
  resendText: { color: t.emerald, fontSize: 13.5, fontWeight: '800' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  scrimFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  sheetSub: { color: t.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flag: { fontSize: 26 },
  countryName: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  countrySub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
  input: {
    height: 54, borderRadius: radius.input, paddingHorizontal: 14, color: t.textPrimary, fontSize: 16, fontWeight: '600',
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft, marginBottom: 12,
  },
  submit: { height: 52, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },
});
