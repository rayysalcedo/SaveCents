import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { GlassCard } from '../src/components/GlassCard';
import { Palette, radius, useTheme } from '../src/theme/colors';
import { useFinance } from '../src/store/finance';

type Mode = 'LOGIN' | 'SIGNUP' | 'OTP';

export default function AuthScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [bioType, setBioType] = useState<'face' | 'fingerprint' | null>(null);
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

  const finish = () => {
    login(name || 'Rayy', email || 'rayysalcedo@gmail.com');
    router.replace('/(tabs)/dashboard');
  };

  const biometricLogin = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock SaveCents',
        cancelLabel: 'Use password instead',
      });
      if (result.success) finish();
    } catch {
      Alert.alert('Biometrics unavailable', 'Please log in with your email instead.');
    }
  };

  // Real Google Sign-In needs a dev build + Firebase (M3). Mocked for now.
  const googleLogin = () => finish();


  const Field = (props: {
  icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (t: string) => void; secure?: boolean; keyboardType?: 'default' | 'email-address' | 'number-pad';
}) => {
  return (
    <View style={styles.field}>
      <Ionicons name={props.icon} size={18} color={t.textMuted} />
      <TextInput
        style={styles.input}
        placeholder={props.placeholder}
        placeholderTextColor={t.textMuted}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize="none"
      />
    </View>
  );
};

  const PrimaryButton = ({ label, onPress }: { label: string; onPress: () => void }) => {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.buttonWrap, pressed && { opacity: 0.88 }]}>
      <LinearGradient
        colors={[t.emerald, t.teal]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
};

  return (
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
        {mode === 'OTP' ? (
          <>
            <Text style={styles.cardTitle}>Verify your email</Text>
            <Text style={styles.hint}>We sent a 6-digit code to {email || 'your inbox'}. (Mock — any code works.)</Text>
            <Field icon="key" placeholder="6-digit code" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
            <PrimaryButton label="Verify and continue" onPress={finish} />
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>{mode === 'LOGIN' ? 'Welcome back' : 'Create your account'}</Text>

            {/* Social + passkey options */}
            <Pressable style={styles.providerBtn} onPress={googleLogin}>
              <Text style={styles.gLogo}>G</Text>
              <Text style={styles.providerText}>Continue with Google</Text>
            </Pressable>

            {bioType && biometricsEnabled && mode === 'LOGIN' && (
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
              <Field icon="person" placeholder="Full name" value={name} onChangeText={setName} />
            )}
            <Field icon="mail" placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field icon="lock-closed" placeholder="Password" value={password} onChangeText={setPassword} secure />
            <PrimaryButton
              label={mode === 'LOGIN' ? 'Log in' : 'Sign up'}
              onPress={() => (mode === 'LOGIN' ? finish() : setMode('OTP'))}
            />
            <Pressable onPress={() => setMode(mode === 'LOGIN' ? 'SIGNUP' : 'LOGIN')} style={styles.switchRow}>
              <Text style={styles.switchText}>
                {mode === 'LOGIN' ? 'New here? ' : 'Already have an account? '}
                <Text style={styles.switchLink}>{mode === 'LOGIN' ? 'Create an account' : 'Log in'}</Text>
              </Text>
            </Pressable>
          </>
        )}
      </GlassCard>

      <Text style={styles.footnote}>Google & email are mock until M3 · Face ID is live</Text>
    </KeyboardAvoidingView>
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
  hint: { color: t.textMuted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
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
  switchRow: { alignItems: 'center', marginTop: 16 },
  switchText: { color: t.textMuted, fontSize: 13 },
  switchLink: { color: t.emerald, fontWeight: '700' },
  footnote: { color: t.textFaint, fontSize: 11, textAlign: 'center', marginTop: 18 },
});
