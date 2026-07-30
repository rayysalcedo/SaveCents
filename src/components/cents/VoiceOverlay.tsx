// M5: "Speaking to Cents" — full-screen voice overlay (reference: Echo design).
// Pulsing emerald rings while listening, live transcript in large type, and
// send/cancel controls. Runs real streaming STT once expo-speech-recognition
// is wired in the dev build (see src/services/voice.ts); in Expo Go it shows
// the same premium UI with a clear "arrives with the dev build" note and a
// type-instead fallback so the flow never dead-ends.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Palette, useTheme } from '../../theme/colors';
import { useFinance } from '../../store/finance';
import { useUI } from '../../store/ui';
import { startListening, voiceAvailable, VoiceSession } from '../../services/voice';

export function VoiceOverlay() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { voiceOpen, closeVoice, openChat } = useUI();
  const sendChat = useFinance((s) => s.sendChat);

  const available = voiceAvailable();
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<'listening' | 'error'>('listening');
  const [errMsg, setErrMsg] = useState('');
  const session = useRef<VoiceSession | null>(null);

  // Entrance fade
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (voiceOpen) {
      setTranscript(''); setStatus('listening'); setErrMsg('');
      Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (available) {
        startListening({
          lang: 'en-PH',
          onPartial: setTranscript,
          onFinal: (text) => { setTranscript(text); finish(text); },
          onError: (m) => { setStatus('error'); setErrMsg(m); },
          onEnd: () => {},
        }).then((s) => { session.current = s; });
      }
    } else {
      fade.setValue(0);
      session.current?.cancel();
      session.current = null;
    }
    return () => { session.current?.cancel(); session.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOpen]);

  const finish = (text: string) => {
    const clean = text.trim();
    session.current?.stop();
    session.current = null;
    if (clean) {
      sendChat(clean);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      openChat(); // show Cents replying (no-op reopen if chat was already under)
      return;
    }
    closeVoice(); // nothing sent: return to wherever the user was
  };

  const cancel = () => {
    session.current?.cancel();
    session.current = null;
    closeVoice();
  };

  if (!voiceOpen) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      {/* Deep blurred backdrop — always dark-leaning for focus, both themes */}
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,12,8,0.72)' }]} />
      <LinearGradient
        colors={['rgba(16,185,129,0.22)', 'rgba(16,185,129,0)', 'rgba(13,148,136,0.16)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.wrap, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 26 }]}>
        {/* Header */}
        <View style={styles.topRow}>
          <View style={styles.topPill}>
            <View style={styles.liveDot} />
            <Text style={styles.topPillText}>Speaking to Cents</Text>
          </View>
          <Pressable style={styles.xBtn} onPress={cancel}>
            <Ionicons name="close" size={19} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>

        <Text style={styles.hint}>
          {status === 'error'
            ? errMsg
            : available
              ? (transcript ? ' ' : 'I\u2019m listening')
              : 'Voice is coming soon'}
        </Text>

        {/* Pulse rings */}
        <View style={styles.pulseZone}>
          <PulseRings active={available && status === 'listening'} />
          <View style={styles.core}>
            <LinearGradient colors={[t.mint, t.emerald]} style={styles.coreGrad}>
              <Ionicons name="mic" size={30} color="#04140D" />
            </LinearGradient>
          </View>
        </View>

        {/* Live transcript */}
        <View style={styles.transcriptZone}>
          {transcript ? (
            <Text style={styles.transcript}>
              {transcript}
              <Text style={styles.caret}>▍</Text>
            </Text>
          ) : available ? (
            <Text style={styles.transcriptGhost}>Say something like "Bumili ako ng 250 na kape"</Text>
          ) : (
            <View style={styles.devNote}>
              <Ionicons name="mic-off" size={14} color={t.mint} />
              <Text style={styles.devNoteText}>Voice input is on its way. For now, type your message to Cents.</Text>
            </View>
          )}
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Pressable style={styles.sideBtn} onPress={() => openChat()}>
            <Ionicons name="keypad" size={20} color="rgba(255,255,255,0.8)" />
            <Text style={styles.sideText}>Type instead</Text>
          </Pressable>

          <Pressable
            onPress={() => (transcript.trim() ? finish(transcript) : cancel())}
            style={({ pressed }) => [pressed && { transform: [{ scale: 0.92 }] }]}
          >
            <LinearGradient colors={[t.mint, t.emerald]} style={styles.bigMic}>
              <Ionicons name={transcript.trim() ? 'arrow-up' : 'mic'} size={26} color="#04140D" />
            </LinearGradient>
          </Pressable>

          <View style={styles.sideBtn}>
            <Text style={[styles.sideText, { opacity: 0.55 }]}>
              {transcript.trim() ? 'Tap to send' : 'en · fil'}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// Three staggered expanding rings + a breathing glow — the "AI is listening" pulse.
function PulseRings({ active }: { active: boolean }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 520),
          Animated.timing(r, { toValue: 1, duration: 1650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loops.forEach((l) => l.start());
    b.start();
    return () => { loops.forEach((l) => l.stop()); b.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={pulseStyles.zone} pointerEvents="none">
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          style={[
            pulseStyles.ring,
            {
              opacity: r.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, active ? 0.55 : 0.3, 0] }),
              transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.9] }) }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          pulseStyles.glow,
          {
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, active ? 0.75 : 0.5] }),
            transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          },
        ]}
      />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  zone: { position: 'absolute', width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute', width: 150, height: 150, borderRadius: 75,
    borderWidth: 1.6, borderColor: '#6EE7B7',
  },
  glow: {
    position: 'absolute', width: 132, height: 132, borderRadius: 66,
    backgroundColor: 'rgba(16,185,129,0.25)',
  },
});

const makeStyles = (t: Palette) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 26, alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  topPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#6EE7B7' },
  topPillText: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: '700' },
  xBtn: {
    width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13.5, marginTop: 26, minHeight: 18, textAlign: 'center' },
  pulseZone: { flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  core: {
    width: 96, height: 96, borderRadius: 48, padding: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#10B981', shadowOpacity: 0.8, shadowRadius: 30, shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  coreGrad: { flex: 1, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  transcriptZone: { minHeight: 120, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-start' },
  transcript: {
    color: '#FFFFFF', fontSize: 24, lineHeight: 33, fontWeight: '700', textAlign: 'center',
  },
  caret: { color: '#6EE7B7' },
  transcriptGhost: { color: 'rgba(255,255,255,0.4)', fontSize: 16, fontStyle: 'italic', textAlign: 'center' },
  devNote: {
    flexDirection: 'row', gap: 9, alignItems: 'flex-start',
    backgroundColor: 'rgba(110,231,183,0.1)', borderWidth: 1, borderColor: 'rgba(110,231,183,0.3)',
    borderRadius: 16, padding: 14, maxWidth: 340,
  },
  devNoteText: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, lineHeight: 18, flex: 1 },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', marginTop: 18,
  },
  sideBtn: { width: 96, alignItems: 'center', gap: 5 },
  sideText: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: '600' },
  bigMic: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#10B981', shadowOpacity: 0.7, shadowRadius: 22, shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
});
