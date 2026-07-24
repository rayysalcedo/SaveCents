import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import Constants from 'expo-constants';
import { GlassCard } from '../src/components/GlassCard';
import { Palette, radius, useTheme } from '../src/theme/colors';
import { useFinance } from '../src/store/finance';
import {
  authAvailable, authErrorMessage, resetPassword, signIn, signUp, subscribeAuth,
} from '../src/services/auth';

// Expo Go's binary lacks NSFaceIDUsageDescription, so Face ID can never work
// inside it (iOS error: missing_usage_description). Hide the button there; it
// returns automatically in the M4 development build.
const IN_EXPO_GO = Constants.appOwnership === 'expo';

type Styles = ReturnType<typeof makeStyles>;

// Defined at module level ON PURPOSE. If these live inside AuthScreen, every
// keystroke re-creates the component type, React remounts the TextInput, and
// the keyboard dismisses after each character. Do not move them back inside.
const Field = (props: {
  t: Palette; styles: Styles;
  icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (v: string) => void; secure?: boolean; keyboardType?: 'default' | 'email-address' | 'number-pad';
}) => (
  <View style={props.styles.field}>
    <Ionicons name={props.icon} size={18} color={props.t.textMuted} />
    <TextInput
      style={props.styles.input}
      placeholder={props.placeholder}
      placeholderTextColor={props.t.textMuted}
      value={props.value}
      onChangeText={props.onChangeText}
      secureTextEntry={props.secure}
      keyboardType={props.keyboardType ?? 'default'}
      autoCapitalize="none"
      autoCorrect={false}
    />
  </View>
);

const PrimaryButton = (props: {
  t: Palette; styles: Styles; label: string; busy: boolean; onPress: () => void;
}) => (
  <Pressable
    onPress={props.onPress}
    disabled={props.busy}
    style={({ pressed }) => [props.styles.buttonWrap, (pressed || props.busy) && { opacity: 0.88 }]}
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

type Mode = 'LOGIN' | 'SIGNUP';

export default function AuthScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [bioType, setBioType] = useState<'face' | 'fingerprint' | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionUser, setSessionUser] = useState<{ name: string; email: string } | null>(null);
  const login = useFinance((s) => s.login);
  const biometricsEnabled = useFinance((s) => s.biometricsEnabled);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) return;
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) setBioType('face');
      else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) setBioType('fingerprint');
    })();
  }, []);

  // Watch for a restored Firebase session — this is what makes Face ID a
  // relock (it can only unlock an account that is already signed in).
  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      setHasSession(!!user);
      setSessionUser(user ? { name: user.displayName ?? 'You', email: user.email ?? '' } : null);
    });
    return unsub;
  }, []);

  const enter = (displayName: string, mail: string) => {
    login(displayName, mail);
    router.replace('/(tabs)/dashboard');
  };

  const submitEmail = async () => {
    if (busy) return;
    // Offline-first philosophy: if Firebase isn't configured (fresh clone of
    // the public repo), keep the old mock path so the app still works.
    if (!authAvailable()) {
      enter(name || 'Guest', email || 'guest@savecents.app');
      return;
    }
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const user = mode === 'LOGIN'
        ? await signIn(email, password)
        : await signUp(name, email, password);
      enter(user.displayName ?? name ?? 'You', user.email ?? email);
    } catch (e) {
      Alert.alert(mode === 'LOGIN' ? 'Log in failed' : 'Sign up failed', authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!authAvailable()) return;
    if (!email.trim()) {
      Alert.alert('Reset password', 'Type your email above first, then tap this again.');
      return;
    }
    try {
      await resetPassword(email);
      Alert.alert('Check your inbox', `We sent a password-reset link to ${email.trim()}.`);
    } catch (e) {
      Alert.alert('Reset failed', authErrorMessage(e));
    }
  };

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
        disableDeviceFallback: true, // Face ID or nothing — no passcode screen
      });
      if (result.success) {
        if (sessionUser) enter(sessionUser.name, sessionUser.email);
        else Alert.alert('Session expired', 'Please log in with your email once, then Face ID will work again.');
        return;
      }
      // Surface the real reason instead of failing silently.
      const err = (result as { error?: string }).error ?? 'unknown';
      if (err === 'user_cancel' || err === 'system_cancel' || err === 'app_cancel') return; // user backed out — not an error
      if (err === 'lockout') {
        Alert.alert('Face ID locked', 'Too many failed attempts. Unlock your iPhone with your passcode once, then try again.');
      } else if (err === 'not_available' || err === 'not_enrolled' || err === 'missing_usage_description') {
        Alert.alert('Face ID unavailable', `iOS says: ${err}. Check Settings → Apps → Expo Go → Face ID is ON.`);
      } else {
        Alert.alert('Face ID failed', `Reason: ${err}. You can log in with your email instead.`);
      }
    } catch (e) {
      Alert.alert('Biometrics error', String(e));
    }
  };

  // Real Google Sign-In needs the M4 development build.
  const googleLogin = () =>
    Alert.alert('Coming soon', 'Google Sign-In arrives in the next build — use email for now.');

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.brand}>
        <LinearGradient colors={[t.emerald, t.teal]} style={styles.logoRing}>
          <View style={styles.logoInner}>
            <Ionicons name="wallet" size={28} color={t.emerald} />
          </View>
        </LinearGradient>
        <Text style={styles.title}>SaveCents</Text>
        <Text style={styles.subtitle}>Your proactive financial coach</Text>
      </View>

      <GlassCard glow>
        <Text style={styles.cardTitle}>{mode === 'LOGIN' ? 'Welcome back' : 'Create your account'}</Text>

        {/* Social + passkey options */}
        <Pressable style={styles.providerBtn} onPress={googleLogin}>
          <Text style={styles.gLogo}>G</Text>
          <Text style={styles.providerText}>Continue with Google</Text>
        </Pressable>

        {!IN_EXPO_GO && bioType && biometricsEnabled && hasSession && mode === 'LOGIN' && (
          <Pressable style={styles.providerBtn} onPress={biometricLogin}>
            <Ionicons
              name={bioType === 'face' ? 'scan-circle-outline' : 'finger-print'}
              size={20}
              color={t.emerald}
            />
            <Text style={styles.providerText}>
              {bioType === 'face' ? 'Unlock with Face ID' : 'Unlock with fingerprint'}
            </Text>
          </Pressable>
        )}

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or use email</Text>
          <View style={styles.dividerLine} />
        </View>

        {mode === 'SIGNUP' && (
          <Field t={t} styles={styles} icon="person" placeholder="Full name" value={name} onChangeText={setName} />
        )}
        <Field t={t} styles={styles} icon="mail" placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <Field t={t} styles={styles} icon="lock-closed" placeholder="Password" value={password} onChangeText={setPassword} secure />
        <PrimaryButton t={t} styles={styles} busy={busy} label={mode === 'LOGIN' ? 'Log in' : 'Sign up'} onPress={submitEmail} />

        {mode === 'LOGIN' && (
          <Pressable onPress={forgotPassword} style={styles.forgotRow}>
            <Text style={styles.switchLink}>Forgot password?</Text>
          </Pressable>
        )}

        <Pressable onPress={() => setMode(mode === 'LOGIN' ? 'SIGNUP' : 'LOGIN')} style={styles.switchRow}>
          <Text style={styles.switchText}>
            {mode === 'LOGIN' ? 'New here? ' : 'Already have an account? '}
            <Text style={styles.switchLink}>{mode === 'LOGIN' ? 'Create an account' : 'Log in'}</Text>
          </Text>
        </Pressable>
      </GlassCard>

      <Text style={styles.footnote}>Secured by Firebase · Face ID relock is live</Text>
    </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  brand: { alignItems: 'center', marginBottom: 26 },
  logoRing: { width: 66, height: 66, borderRadius: 22, padding: 2, marginBottom: 14 },
  logoInner: {
    flex: 1, borderRadius: 20, backgroundColor: t.insetBg,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: t.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: 0.3 },
  subtitle: { color: t.textMuted, fontSize: 14, marginTop: 4 },
  cardTitle: { color: t.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 16 },
  providerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 50, borderRadius: radius.input, marginBottom: 10,
    backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.border,
  },
  gLogo: { color: t.textPrimary, fontSize: 17, fontWeight: '800' },
  providerText: { color: t.textPrimary, fontSize: 14, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: t.borderSoft },
  dividerText: { color: t.textFaint, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft,
    borderRadius: radius.input, paddingHorizontal: 14, height: 50, marginBottom: 12,
  },
  input: { flex: 1, color: t.textPrimary, fontSize: 15 },
  buttonWrap: {
    borderRadius: radius.input, marginTop: 6,
    shadowColor: t.emerald, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
  },
  button: { height: 52, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: t.onEmerald, fontSize: 16, fontWeight: '800' },
  forgotRow: { alignItems: 'center', marginTop: 12 },
  switchRow: { alignItems: 'center', marginTop: 14 },
  switchText: { color: t.textMuted, fontSize: 13 },
  switchLink: { color: t.emerald, fontWeight: '700' },
  footnote: { color: t.textFaint, fontSize: 11, textAlign: 'center', marginTop: 18 },
});