// Auth (M5.5, v17) — reference layout in the locked sage language, kept SIMPLE:
// solid card (white in light, deep green in dark; NO glow, NO glass here),
// wordmark with a soft drop shadow, light/dark switcher, segmented
// Login/Register pill, labeled fields, emerald pill CTA (white on emerald in
// BOTH themes), Google + Face ID, sign-up password rules + retype, and the
// email OTP step ending on the green Congratulations card.
//
// Register is sized to fit one screen on regular iPhones: compact brand block,
// the "Already have an account? Log in" line lives under the title (like the
// reference) instead of a bottom row, and Remember me appears on Login only.
//
// Steps: FORM -> (sign up only) OTP -> SUCCESS -> tabs.
// Google accounts skip OTP (their email is already verified).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Palette, radius, useTheme } from '../src/theme/colors';
import { useFinance } from '../src/store/finance';
import {
  authAvailable, authErrorMessage, completePasswordReset, resetPassword, sendVerificationEmail, signIn, signUp, subscribeAuth,
} from '../src/services/auth';
import { OtpUnavailableError, requestEmailOtp, requestResetOtp, verifyEmailOtp, verifyResetOtp } from '../src/services/otp';
import { IN_EXPO_GO, googleConfigured, useGoogleSignIn } from '../src/services/googleAuth';

const REMEMBER_KEY = 'savecents.rememberedEmail';
const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30;

// Sign-up password rules, checked live and enforced on submit.
const PW_RULES = [
  { id: 'len', label: '8+ characters', test: (p: string) => p.length >= 8 },
  { id: 'letter', label: 'A letter', test: (p: string) => /[a-zA-Z]/.test(p) },
  { id: 'num', label: 'A number', test: (p: string) => /\d/.test(p) },
] as const;

type Styles = ReturnType<typeof makeStyles>;
type Mode = 'LOGIN' | 'SIGNUP';
type Step = 'FORM' | 'OTP' | 'SUCCESS';

// ---------------------------------------------------------------------------
// Module-scope subcomponents ON PURPOSE. Defining these inside AuthScreen
// re-creates the component type each keystroke, React remounts the TextInput,
// and the keyboard dismisses per character (HANDOFF rule 3.1). Do not inline.
// ---------------------------------------------------------------------------

const Field = (props: {
  t: Palette; styles: Styles;
  label: string; placeholder: string; value: string;
  onChangeText: (v: string) => void;
  secure?: boolean; keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'name' | 'password' | 'new-password';
}) => {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={props.styles.fieldBlock}>
      <Text style={props.styles.fieldLabel}>{props.label}</Text>
      <View style={props.styles.field}>
        <TextInput
          style={props.styles.input}
          placeholder={props.placeholder}
          placeholderTextColor={props.t.textFaint}
          value={props.value}
          onChangeText={props.onChangeText}
          secureTextEntry={props.secure ? hidden : false}
          keyboardType={props.keyboardType ?? 'default'}
          autoCapitalize={props.autoComplete === 'name' ? 'words' : 'none'}
          autoCorrect={false}
          autoComplete={props.autoComplete}
        />
        {props.secure && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={19} color={props.t.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
};

// Compact live checklist: each rule becomes a chip that turns emerald when met.
const PasswordRules = (props: { t: Palette; styles: Styles; password: string; confirm: string }) => (
  <View style={props.styles.rulesRow}>
    {PW_RULES.map((r) => {
      const ok = r.test(props.password);
      return (
        <View key={r.id} style={[props.styles.ruleChip, ok && props.styles.ruleChipOk]}>
          <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={ok ? props.t.emerald : props.t.textFaint} />
          <Text style={[props.styles.ruleText, ok && props.styles.ruleTextOk]}>{r.label}</Text>
        </View>
      );
    })}
    {(() => {
      const ok = props.confirm.length > 0 && props.confirm === props.password;
      return (
        <View style={[props.styles.ruleChip, ok && props.styles.ruleChipOk]}>
          <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={ok ? props.t.emerald : props.t.textFaint} />
          <Text style={[props.styles.ruleText, ok && props.styles.ruleTextOk]}>Passwords match</Text>
        </View>
      );
    })()}
  </View>
);

const PrimaryButton = (props: {
  t: Palette; styles: Styles; label: string; busy?: boolean; onPress: () => void;
}) => (
  <Pressable
    onPress={props.onPress}
    disabled={props.busy}
    style={({ pressed }) => [props.styles.buttonWrap, (pressed || props.busy) && { opacity: 0.9 }]}
  >
    <LinearGradient
      colors={[props.t.emerald, props.t.teal]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      style={props.styles.button}
    >
      {props.busy
        ? <ActivityIndicator color={props.t.onEmerald} />
        : <Text style={props.styles.buttonText}>{props.label}</Text>}
    </LinearGradient>
  </Pressable>
);

// Segmented Login / Register pill with a sliding emerald thumb.
const ModeSwitch = (props: {
  t: Palette; styles: Styles; mode: Mode; onChange: (m: Mode) => void;
}) => {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(props.mode === 'LOGIN' ? 0 : 1)).current;
  useEffect(() => {
    Animated.spring(x, {
      toValue: props.mode === 'LOGIN' ? 0 : 1,
      useNativeDriver: true, speed: 18, bounciness: 6,
    }).start();
  }, [props.mode, x]);
  const thumbW = Math.max((w - 8) / 2, 0);
  return (
    <View style={props.styles.segment} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Animated.View
          style={[
            props.styles.segmentThumbWrap,
            { width: thumbW, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, thumbW] }) }] },
          ]}
        >
          <LinearGradient
            colors={[props.t.emerald, props.t.teal]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={props.styles.segmentThumb}
          />
        </Animated.View>
      )}
      {(['LOGIN', 'SIGNUP'] as Mode[]).map((m) => {
        const active = props.mode === m;
        return (
          <Pressable key={m} style={props.styles.segmentBtn} onPress={() => props.onChange(m)}>
            <Text style={[props.styles.segmentText, active && props.styles.segmentTextActive]}>
              {m === 'LOGIN' ? 'Login' : 'Register'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

// Sun / moon light-dark switcher (auth screens only; Profile keeps the full picker).
const ThemeSwitch = (props: { t: Palette; styles: Styles; onToggle: () => void }) => {
  const light = props.t.mode === 'light';
  return (
    <Pressable
      onPress={props.onToggle}
      style={props.styles.themeSwitch}
      accessibilityLabel={light ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <View style={[props.styles.themeIcon, light && props.styles.themeIconActive]}>
        <Ionicons name="sunny" size={14} color={light ? props.t.onEmerald : props.t.textMuted} />
      </View>
      <View style={[props.styles.themeIcon, !light && props.styles.themeIconActive]}>
        <Ionicons name="moon" size={13} color={!light ? props.t.onEmerald : props.t.textMuted} />
      </View>
    </Pressable>
  );
};

// Six-box OTP input: the boxes are a visual skin over one hidden TextInput,
// so paste, autofill, and backspace all behave natively.
const OtpBoxes = (props: {
  t: Palette; styles: Styles; value: string; onChange: (v: string) => void;
}) => {
  const ref = useRef<TextInput>(null);
  const chars = props.value.split('');
  return (
    <Pressable style={props.styles.otpRow} onPress={() => ref.current?.focus()}>
      {Array.from({ length: OTP_LENGTH }).map((_, i) => {
        const filled = i < chars.length;
        const activeBox = i === chars.length;
        return (
          <View key={i} style={[props.styles.otpBox, filled && props.styles.otpBoxFilled, activeBox && props.styles.otpBoxActive]}>
            <Text style={props.styles.otpDigit}>{chars[i] ?? ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        style={props.styles.otpHidden}
        value={props.value}
        onChangeText={(v) => props.onChange(v.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoFocus
        caretHidden
      />
    </Pressable>
  );
};

// ---------------------------------------------------------------------------

export default function AuthScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('LOGIN');
  const [step, setStep] = useState<Step>('FORM');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);

  // OTP step state
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // 'code' = 6-digit flow; 'link' = fell back to Firebase's verification email
  const [verifyChannel, setVerifyChannel] = useState<'code' | 'link'>('code');
  const [pendingUser, setPendingUser] = useState<{ name: string; email: string } | null>(null);

  const [bioType, setBioType] = useState<'face' | 'fingerprint' | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionUser, setSessionUser] = useState<{ name: string; email: string } | null>(null);

  const login = useFinance((s) => s.login);
  const biometricsEnabled = useFinance((s) => s.biometricsEnabled);
  const setThemeMode = useFinance((s) => s.setThemeMode);

  // Fade between steps.
  const fade = useRef(new Animated.Value(1)).current;
  const goToStep = (next: Step) => {
    Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) return;
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) setBioType('face');
      else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) setBioType('fingerprint');
    })();
    // Prefill a remembered email.
    AsyncStorage.getItem(REMEMBER_KEY).then((saved) => {
      if (saved) { setEmail(saved); setRememberMe(true); }
    }).catch(() => {});
  }, []);

  // Restored Firebase session makes Face ID a relock (it can only unlock an
  // account that is already signed in).
  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      setHasSession(!!user);
      setSessionUser(user ? { name: user.displayName ?? 'You', email: user.email ?? '' } : null);
    });
    return unsub;
  }, []);

  // Resend cooldown tick.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]);

  const persistRemember = (mail: string) => {
    if (rememberMe && mail.trim()) AsyncStorage.setItem(REMEMBER_KEY, mail.trim()).catch(() => {});
    else AsyncStorage.removeItem(REMEMBER_KEY).catch(() => {});
  };

  const enter = (displayName: string, mail: string) => {
    login(displayName, mail);
    router.replace('/(tabs)/dashboard');
  };

  const toggleTheme = () => setThemeMode(t.mode === 'light' ? 'dark' : 'light');

  // ----- email code delivery (sign-up verification) ------------------------
  const sendSignupCode = async (mail: string): Promise<boolean> => {
    try {
      const r = await requestEmailOtp(mail);
      if (r.devCode) setDevCode(r.devCode); // dev-only delivery, see services/otp.ts
      setVerifyChannel('code');
      setCooldown(RESEND_COOLDOWN);
      return true;
    } catch (e) {
      if (e instanceof OtpUnavailableError) {
        // Production without the M6 endpoint: Firebase's real verification
        // link keeps the flow honest with zero backend.
        const sent = await sendVerificationEmail().catch(() => false);
        setVerifyChannel(sent ? 'link' : 'code');
        setCooldown(RESEND_COOLDOWN);
        return true;
      }
      Alert.alert('Could not send the code', 'Check your connection and try again.');
      return false;
    }
  };

  // ----- submit ------------------------------------------------------------
  const validateSignupPassword = (): string | null => {
    const failed = PW_RULES.filter((r) => !r.test(password));
    if (failed.length) return `Your password still needs: ${failed.map((r) => r.label.toLowerCase()).join(', ')}.`;
    if (password !== confirm) return 'The passwords do not match. Retype them and try again.';
    return null;
  };

  const submitEmail = async () => {
    if (busy) return;
    Keyboard.dismiss();
    // Offline-first: without Firebase config (fresh public clone) the mock
    // path still exercises the full flow, including the OTP step.
    if (!authAvailable()) {
      if (mode === 'SIGNUP') {
        const pwError = validateSignupPassword();
        if (pwError) { Alert.alert('Check your password', pwError); return; }
      }
      const displayName = name.trim() || 'Guest';
      const mail = email.trim() || 'guest@savecents.app';
      persistRemember(mail);
      if (mode === 'SIGNUP') {
        setPendingUser({ name: displayName, email: mail });
        setBusy(true);
        const ok = await sendSignupCode(mail);
        setBusy(false);
        if (ok) { setOtp(''); goToStep('OTP'); }
        return;
      }
      enter(displayName, mail);
      return;
    }
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    if (mode === 'SIGNUP') {
      if (!name.trim()) {
        Alert.alert('Missing info', 'Please enter your full name.');
        return;
      }
      const pwError = validateSignupPassword();
      if (pwError) { Alert.alert('Check your password', pwError); return; }
    }
    setBusy(true);
    try {
      if (mode === 'LOGIN') {
        const user = await signIn(email, password);
        persistRemember(email);
        enter(user.displayName ?? 'You', user.email ?? email);
        return;
      }
      const user = await signUp(name, email, password);
      persistRemember(email);
      setPendingUser({ name: user.displayName ?? name.trim(), email: user.email ?? email.trim() });
      const ok = await sendSignupCode(user.email ?? email);
      if (ok) { setOtp(''); goToStep('OTP'); }
      else enter(user.displayName ?? name, user.email ?? email); // account exists; never strand the user
    } catch (e) {
      Alert.alert(mode === 'LOGIN' ? 'Log in failed' : 'Sign up failed', authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async () => {
    if (otpBusy || !pendingUser) return;
    if (verifyChannel === 'link') {
      // Link fallback: tapping Continue just moves on; Firebase flips
      // emailVerified when they open the email.
      goToStep('SUCCESS');
      return;
    }
    if (otp.length < OTP_LENGTH) {
      Alert.alert('Almost there', `Enter all ${OTP_LENGTH} digits of the code.`);
      return;
    }
    setOtpBusy(true);
    const r = await verifyEmailOtp(otp);
    setOtpBusy(false);
    if (r.ok) {
      Keyboard.dismiss();
      goToStep('SUCCESS');
    } else {
      setOtp('');
      Alert.alert('Wrong code', r.reason ?? 'Try again.');
    }
  };

  const resendCode = async () => {
    if (cooldown > 0 || !pendingUser) return;
    setDevCode(null);
    setOtp('');
    await sendSignupCode(pendingUser.email);
  };

  // ----- M5.33: no-link password reset (6-digit code in-app) ---------------
  const [fpOpen, setFpOpen] = useState(false);
  const [fpStep, setFpStep] = useState<'code' | 'new'>('code');
  const [fpCode, setFpCode] = useState('');
  const [fpNew, setFpNew] = useState('');
  const [fpNew2, setFpNew2] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpError, setFpError] = useState('');
  const fpOob = useRef<string | null>(null);

  const forgotPassword = async () => {
    if (!authAvailable()) {
      Alert.alert('Reset password', 'Connect Firebase first (src/services/firebaseConfig.ts).');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Reset password', 'Type your email above first, then tap this again.');
      return;
    }
    try {
      await requestResetOtp(email);
      setFpCode(''); setFpNew(''); setFpNew2(''); setFpError('');
      fpOob.current = null;
      setFpStep('code');
      setFpOpen(true);
    } catch (e) {
      if (e instanceof OtpUnavailableError) {
        // Worker not configured: the classic link email still works.
        try {
          await resetPassword(email);
          Alert.alert('Check your inbox', `We sent a password reset link to ${email.trim()}.`);
        } catch (e2) {
          Alert.alert('Reset failed', authErrorMessage(e2));
        }
        return;
      }
      Alert.alert('Reset failed', (e as Error)?.message ?? 'Try again.');
    }
  };

  const fpVerify = async () => {
    if (fpBusy) return;
    setFpError('');
    if (fpCode.trim().length < 6) { setFpError('Enter all 6 digits of the code.'); return; }
    setFpBusy(true);
    const r = await verifyResetOtp(email, fpCode);
    setFpBusy(false);
    if (!r.ok || !r.oobCode) { setFpError(r.reason ?? 'That code is not right.'); return; }
    fpOob.current = r.oobCode;
    setFpStep('new');
  };

  const fpSave = async () => {
    if (fpBusy || !fpOob.current) return;
    setFpError('');
    if (fpNew.length < 8) { setFpError('Use at least 8 characters.'); return; }
    if (fpNew !== fpNew2) { setFpError('Passwords do not match.'); return; }
    setFpBusy(true);
    try {
      await completePasswordReset(fpOob.current, fpNew);
      setFpOpen(false);
      setPassword('');
      Alert.alert('Password updated', 'Sign in with your new password.');
    } catch (e) {
      setFpError(authErrorMessage(e));
    } finally {
      setFpBusy(false);
    }
  };

  // ----- Google ------------------------------------------------------------
  const google = useGoogleSignIn(
    (user) => {
      persistRemember(user.email ?? '');
      enter(user.displayName ?? 'You', user.email ?? '');
    },
    (message) => Alert.alert('Google sign-in', message),
  );

  const googleLogin = () => {
    if (IN_EXPO_GO) {
      Alert.alert(
        'Google needs the full app build',
        'Google blocks sign-in inside Expo Go. It works in the development build and in the released app. Use email for now.',
      );
      return;
    }
    if (!googleConfigured()) {
      Alert.alert(
        'Google is almost ready',
        'Paste the OAuth client ids into src/services/googleAuth.ts (setup steps are in that file), then this button signs you straight in.',
      );
      return;
    }
    google.begin();
  };

  // ----- biometrics --------------------------------------------------------
  const biometricLogin = async () => {
    try {
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        Alert.alert('Face ID not set up', 'Set up Face ID in iPhone Settings first, or log in with your email.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock SaveCents',
        cancelLabel: 'Use password instead',
        disableDeviceFallback: true,
      });
      if (result.success) {
        if (sessionUser) enter(sessionUser.name, sessionUser.email);
        else Alert.alert('Session expired', 'Please log in with your email once, then Face ID will work again.');
        return;
      }
      const err = (result as { error?: string }).error ?? 'unknown';
      if (err === 'user_cancel' || err === 'system_cancel' || err === 'app_cancel') return;
      if (err === 'lockout') {
        Alert.alert('Face ID locked', 'Too many failed attempts. Unlock your iPhone with your passcode once, then try again.');
      } else if (err === 'not_available' || err === 'not_enrolled' || err === 'missing_usage_description') {
        Alert.alert('Face ID unavailable', `iOS says: ${err}. Check Settings, then Expo Go, then Face ID is on.`);
      } else {
        Alert.alert('Face ID failed', `Reason: ${err}. You can log in with your email instead.`);
      }
    } catch (e) {
      Alert.alert('Biometrics error', String(e));
    }
  };

  const showBiometric = !IN_EXPO_GO && bioType && biometricsEnabled && hasSession && mode === 'LOGIN';

  // ----- render ------------------------------------------------------------
  return (
    <>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Top bar: back chevron on OTP, theme switcher always */}
          <View style={styles.topBar}>
            {step === 'OTP' ? (
              <Pressable
                style={styles.backBtn}
                onPress={() => { setOtp(''); goToStep('FORM'); setMode('LOGIN'); }}
                accessibilityLabel="Back to login"
              >
                <Ionicons name="chevron-back" size={20} color={t.textPrimary} />
              </Pressable>
            ) : <View style={styles.backBtn} />}
            <ThemeSwitch t={t} styles={styles} onToggle={toggleTheme} />
          </View>

          <Animated.View style={{ opacity: fade }}>
            {step === 'FORM' && (
              <>
                <View style={styles.brand}>
                  <Image source={require('../assets/logo-wordmark.png')} style={styles.wordmark} resizeMode="contain" />
                  <Text style={styles.title}>
                    {mode === 'LOGIN' ? 'Welcome back' : 'Create an account'}
                  </Text>
                  {mode === 'LOGIN' ? (
                    <Text style={styles.subtitle}>Your money, one calm place</Text>
                  ) : (
                    <Pressable onPress={() => setMode('LOGIN')} hitSlop={6}>
                      <Text style={styles.subtitle}>
                        Already have an account? <Text style={styles.link}>Log in</Text>
                      </Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.card}>
                  <ModeSwitch t={t} styles={styles} mode={mode} onChange={(m) => setMode(m)} />

                  {mode === 'SIGNUP' && (
                    <Field
                      t={t} styles={styles} label="Full Name" placeholder="Juan Dela Cruz"
                      value={name} onChangeText={setName} autoComplete="name"
                    />
                  )}
                  <Field
                    t={t} styles={styles} label="Email Address" placeholder="you@email.com"
                    value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email"
                  />
                  <Field
                    t={t} styles={styles} label="Password" placeholder={mode === 'LOGIN' ? 'Your password' : '8+ characters'}
                    value={password} onChangeText={setPassword} secure
                    autoComplete={mode === 'LOGIN' ? 'password' : 'new-password'}
                  />
                  {mode === 'SIGNUP' && (
                    <>
                      <Field
                        t={t} styles={styles} label="Retype Password" placeholder="Same password again"
                        value={confirm} onChangeText={setConfirm} secure autoComplete="new-password"
                      />
                      <PasswordRules t={t} styles={styles} password={password} confirm={confirm} />
                    </>
                  )}

                  {mode === 'LOGIN' && (
                    <View style={styles.rememberRow}>
                      <Pressable style={styles.rememberTap} onPress={() => setRememberMe((v) => !v)} hitSlop={8}>
                        <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
                          {rememberMe && <Ionicons name="checkmark" size={13} color={t.onEmerald} />}
                        </View>
                        <Text style={styles.rememberText}>Remember me</Text>
                      </Pressable>
                      <Pressable onPress={forgotPassword} hitSlop={8}>
                        <Text style={styles.link}>Forgot password</Text>
                      </Pressable>
                    </View>
                  )}

                  <PrimaryButton
                    t={t} styles={styles} busy={busy}
                    label={mode === 'LOGIN' ? 'Login' : 'Create account'}
                    onPress={submitEmail}
                  />

                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>Or continue with</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <View style={styles.providerRow}>
                    <Pressable
                      style={({ pressed }) => [styles.providerBtn, pressed && { opacity: 0.85 }]}
                      onPress={googleLogin}
                    >
                      {google.state === 'working'
                        ? <ActivityIndicator size="small" color={t.textPrimary} />
                        : <Ionicons name="logo-google" size={17} color={t.textPrimary} />}
                      <Text style={styles.providerText}>Google</Text>
                    </Pressable>
                    {showBiometric && (
                      <Pressable
                        style={({ pressed }) => [styles.providerBtn, pressed && { opacity: 0.85 }]}
                        onPress={biometricLogin}
                      >
                        <Ionicons
                          name={bioType === 'face' ? 'scan-circle-outline' : 'finger-print'}
                          size={18} color={t.emerald}
                        />
                        <Text style={styles.providerText}>{bioType === 'face' ? 'Face ID' : 'Fingerprint'}</Text>
                      </Pressable>
                    )}
                  </View>

                  {mode === 'LOGIN' && (
                    <Pressable onPress={() => setMode('SIGNUP')} style={styles.switchRow}>
                      <Text style={styles.switchText}>
                        Don't have an account? <Text style={styles.link}>Sign up</Text>
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {step === 'OTP' && pendingUser && (
              <>
                <View style={styles.brand}>
                  <Image source={require('../assets/logo-wordmark.png')} style={styles.wordmark} resizeMode="contain" />
                  <Text style={styles.title}>Verify your email</Text>
                  <Text style={styles.subtitle}>
                    {verifyChannel === 'code'
                      ? `Enter the 6 digit code sent to ${pendingUser.email}`
                      : `We emailed a verification link to ${pendingUser.email}. Open it, then continue.`}
                  </Text>
                </View>

                <View style={styles.card}>
                  {verifyChannel === 'code' && (
                    <>
                      <OtpBoxes t={t} styles={styles} value={otp} onChange={setOtp} />
                      {devCode && (
                        <View style={styles.devCodeChip}>
                          <Ionicons name="construct-outline" size={13} color={t.textMuted} />
                          <Text style={styles.devCodeText}>Development delivery, your code is {devCode}</Text>
                        </View>
                      )}
                    </>
                  )}

                  <PrimaryButton
                    t={t} styles={styles} busy={otpBusy}
                    label={verifyChannel === 'code' ? 'Submit' : 'Continue'}
                    onPress={submitOtp}
                  />

                  <Pressable onPress={resendCode} style={styles.switchRow} disabled={cooldown > 0}>
                    <Text style={styles.switchText}>
                      {cooldown > 0
                        ? `Resend available in ${cooldown}s`
                        : <>Didn't get it? <Text style={styles.link}>Resend {verifyChannel === 'code' ? 'code' : 'email'}</Text></>}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'SUCCESS' && pendingUser && (
              <View style={styles.successWrap}>
                <View style={styles.successShadow}>
                  <LinearGradient
                    colors={[t.emerald, t.teal]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.successCard}
                  >
                    <View style={styles.successCheckRing}>
                      <Ionicons name="checkmark" size={40} color={t.emerald} />
                    </View>
                    <Text style={styles.successTitle}>Congratulations</Text>
                    <Text style={styles.successBody}>
                      Your account is ready{pendingUser.name.trim() ? `, ${pendingUser.name.trim().split(' ')[0]}` : ''}. Cents is waiting to meet you.
                    </Text>
                    <Pressable
                      style={({ pressed }) => [styles.successBtn, pressed && { opacity: 0.9 }]}
                      onPress={() => enter(pendingUser.name, pendingUser.email)}
                    >
                      <Text style={styles.successBtnText}>Home Page</Text>
                    </Pressable>
                  </LinearGradient>
                </View>
              </View>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>

      {/* M5.33: no-link password reset - code in, new password, done. */}
      <Modal visible={fpOpen} transparent animationType="fade" onRequestClose={() => setFpOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}
          onPress={() => Keyboard.dismiss()}
        >
          <Pressable
            style={{ backgroundColor: t.sheet, borderRadius: 24, borderWidth: 1, borderColor: t.borderSoft, padding: 22 }}
            onPress={() => Keyboard.dismiss()}
          >
            {fpStep === 'code' ? (
              <>
                <Text style={{ color: t.textPrimary, fontSize: 19, fontWeight: '800' }}>Enter your reset code</Text>
                <Text style={{ color: t.textMuted, fontSize: 13.5, lineHeight: 20, marginTop: 6, marginBottom: 16 }}>
                  We emailed a 6 digit code to {email.trim()}. Type it here to set a new password.
                </Text>
                <TextInput
                  value={fpCode}
                  onChangeText={(v) => setFpCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="000000"
                  placeholderTextColor={t.textFaint}
                  style={{
                    color: t.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: 10, textAlign: 'center',
                    backgroundColor: t.inputFill, borderWidth: 1.5, borderColor: fpError ? t.red : t.borderSoft,
                    borderRadius: 16, paddingVertical: 14,
                  }}
                />
              </>
            ) : (
              <>
                <Text style={{ color: t.textPrimary, fontSize: 19, fontWeight: '800' }}>Set a new password</Text>
                <Text style={{ color: t.textMuted, fontSize: 13.5, lineHeight: 20, marginTop: 6, marginBottom: 16 }}>
                  Code confirmed. Choose your new SaveCents password.
                </Text>
                <TextInput
                  value={fpNew}
                  onChangeText={setFpNew}
                  secureTextEntry
                  placeholder="New password (8+ characters)"
                  placeholderTextColor={t.textFaint}
                  style={{
                    color: t.textPrimary, fontSize: 15, backgroundColor: t.inputFill, borderWidth: 1,
                    borderColor: t.borderSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
                  }}
                />
                <TextInput
                  value={fpNew2}
                  onChangeText={setFpNew2}
                  secureTextEntry
                  placeholder="Repeat the new password"
                  placeholderTextColor={t.textFaint}
                  style={{
                    color: t.textPrimary, fontSize: 15, backgroundColor: t.inputFill, borderWidth: 1,
                    borderColor: t.borderSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
                  }}
                />
              </>
            )}

            {!!fpError && (
              <Text style={{ color: t.red, fontSize: 12.5, fontWeight: '600', marginTop: 10 }}>{fpError}</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable
                style={{ flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border }}
                onPress={() => setFpOpen(false)}
              >
                <Text style={{ color: t.textMuted, fontSize: 14.5, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={fpStep === 'code' ? fpVerify : fpSave} disabled={fpBusy}>
                <LinearGradient
                  colors={[t.emerald, t.teal]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: fpBusy ? 0.7 : 1 }}
                >
                  {fpBusy
                    ? <ActivityIndicator size="small" color={t.onEmerald} />
                    : <Text style={{ color: t.onEmerald, fontSize: 14.5, fontWeight: '800' }}>{fpStep === 'code' ? 'Continue' : 'Save password'}</Text>}
                </LinearGradient>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22 },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  backBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.sheet, borderWidth: 1, borderColor: t.borderSoft,
  },
  themeSwitch: {
    flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.chip,
    backgroundColor: t.sheet, borderWidth: 1, borderColor: t.borderSoft,
  },
  themeIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  themeIconActive: { backgroundColor: t.emerald },

  brand: { alignItems: 'center', marginBottom: 14 },
  // The wordmark asset ships with its own soft shadow baked into the
  // artwork, so NO runtime shadow props here (the iOS-only shadow looked off
  // and Android could never match it). v19 asset aspect ~2.47.
  wordmark: { width: 150, height: 61, marginBottom: 3 },
  title: { color: t.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center' },
  subtitle: { color: t.textMuted, fontSize: 13.5, marginTop: 5, textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 },

  // Solid, simple card per the reference: white in light, deep green in dark.
  // NO glow, NO blur. Shadow lives here and nothing clips it (rule 3.2 safe:
  // no overflow hidden on this view).
  card: {
    backgroundColor: t.sheet,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: t.borderSoft,
    padding: 18,
    shadowColor: t.mode === 'light' ? '#0B3A2E' : '#000000',
    shadowOpacity: t.mode === 'light' ? 0.08 : 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  segment: {
    flexDirection: 'row', backgroundColor: t.inputFill, borderRadius: radius.chip,
    padding: 4, marginBottom: 13, borderWidth: 1, borderColor: t.borderSoft,
  },
  segmentThumbWrap: {
    position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: radius.chip,
    shadowColor: t.emerald, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  segmentThumb: { flex: 1, borderRadius: radius.chip },
  segmentBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  segmentText: { color: t.textMuted, fontSize: 14, fontWeight: '700' },
  segmentTextActive: { color: t.onEmerald },

  fieldBlock: { marginBottom: 10 },
  fieldLabel: { color: t.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
    borderRadius: radius.input, paddingHorizontal: 14, height: 47,
  },
  input: { flex: 1, color: t.textPrimary, fontSize: 15 },

  rulesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4, marginTop: 2 },
  ruleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.chip,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
  },
  ruleChipOk: { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
  ruleText: { color: t.textFaint, fontSize: 11.5, fontWeight: '600' },
  ruleTextOk: { color: t.emerald },

  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  rememberTap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 19, height: 19, borderRadius: 6, borderWidth: 1.5, borderColor: t.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.inputFill,
  },
  checkboxOn: { backgroundColor: t.emerald, borderColor: t.emerald },
  rememberText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  link: { color: t.emerald, fontSize: 13, fontWeight: '700' },

  buttonWrap: {
    borderRadius: radius.chip, marginTop: 10,
    shadowColor: t.emerald, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  button: { height: 50, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: t.borderSoft },
  dividerText: { color: t.textFaint, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },

  providerRow: { flexDirection: 'row', gap: 10 },
  providerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: radius.chip,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.border,
  },
  providerText: { color: t.textPrimary, fontSize: 14, fontWeight: '700' },

  switchRow: { alignItems: 'center', marginTop: 12 },
  switchText: { color: t.textMuted, fontSize: 13 },

  otpRow: { flexDirection: 'row', gap: 9, justifyContent: 'center', marginBottom: 6, marginTop: 4 },
  otpBox: {
    width: 44, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.inputFill, borderWidth: 1.5, borderColor: t.borderSoft,
  },
  otpBoxFilled: { borderColor: t.emeraldBorder, backgroundColor: t.emeraldTint },
  otpBoxActive: { borderColor: t.emerald },
  otpDigit: { color: t.textPrimary, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  otpHidden: { position: 'absolute', opacity: 0.01, width: '100%', height: '100%' },
  devCodeChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'center',
    borderRadius: radius.chip, backgroundColor: t.inputFill,
  },
  devCodeText: { color: t.textMuted, fontSize: 12, fontWeight: '600' },

  successWrap: { paddingHorizontal: 6 },
  successShadow: {
    borderRadius: radius.card,
    shadowColor: t.emerald, shadowOpacity: 0.45, shadowRadius: 26, shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  successCard: {
    borderRadius: radius.card, paddingVertical: 34, paddingHorizontal: 26, alignItems: 'center',
  },
  successCheckRing: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  successTitle: { color: t.onEmerald, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  successBody: { color: 'rgba(255,255,255,0.92)', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 22 },
  successBtn: {
    height: 50, borderRadius: radius.chip, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  successBtnText: { color: t.deepForest, fontSize: 15, fontWeight: '800' },
});
