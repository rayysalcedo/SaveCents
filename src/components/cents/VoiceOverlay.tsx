// M5.18: "Talking with Cents" — conversation loop + LYRICS-STYLE CAPTIONS.
// A scrolling caption feed carries the whole session: the YOU row appears the
// moment speech is detected (typing dots), fills in with the transcript when
// it lands, and the CENTS row reveals word by word while Cents speaks — like
// following lyrics. Older lines dim, the feed auto-scrolls. (True word-by-word
// captions WHILE the user is still mid-sentence need the dev build's native
// streaming ear; in stream mode the pending YOU row live-updates instead.)
//
// This build also fixes the missing-Cents-caption bug: reply text used to be
// read by an effect gated on phase 'thinking', but speech takes the floor
// synchronously (M5.10 race fix), so the phase was already 'speaking' before
// the effect ran and the caption never rendered. Captions are now appended
// directly from the send promise — no effect, no race.
//
// Waveform rules compliance (§3.5): level-driven bars animate scaleY with
// useNativeDriver on discrete meter events (finite timings); thinking and
// speaking idle waves are NATIVE-driven loops. Word reveal uses a bounded
// setInterval cleared at the last word.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Palette, useTheme } from '../../theme/colors';
import { useFinance } from '../../store/finance';
import { useUI } from '../../store/ui';
import { startListening, voiceAvailable, voiceMode, VoiceSession } from '../../services/voice';
import { getSpokenState, onCentsAudioStart, onCentsSpeech, stopCentsVoice } from '../../services/speech';
import { ChatMessage } from '../../models/types';

type Phase = 'listening' | 'thinking' | 'speaking' | 'muted' | 'error';

interface CapLine {
  id: string;
  who: 'you' | 'cents';
  text: string;
  pending?: boolean; // still being heard/transcribed (typing dots)
  reveal?: boolean;  // animate word-by-word when the text arrives
  hold?: boolean;    // text known, but waiting for the AUDIO to start (M5.20)
}

// ── Waveform geometry (module scope, rule §3.4) ─────────────────────────────
const BAR_COUNT = 26;
const BAR_H = 72;
const WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const x = (i - (BAR_COUNT - 1) / 2) / (BAR_COUNT / 3.4);
  return 0.3 + 0.7 * Math.exp(-(x * x) / 2);
});
const FLAT = 0.1;

const capId = () => `cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// What Cents "said" for a batch of reply messages: text bubbles + card prompts.
const spokenTextOf = (msgs: ChatMessage[]) =>
  msgs
    .filter((m) => m.sender === 'CENTS')
    .map((m) => (m.type === 'text' ? m.text : 'prompt' in m ? (m as any).prompt : ''))
    .filter(Boolean)
    .join(' ');

export function VoiceOverlay() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { voiceOpen, closeVoice, openChat } = useUI();
  const sendChat = useFinance((s) => s.sendChat);
  const sendVoiceClip = useFinance((s) => s.sendVoiceClip);
  const voiceRepliesEnabled = useFinance((s) => s.voiceRepliesEnabled);
  const setVoiceRepliesEnabled = useFinance((s) => s.setVoiceRepliesEnabled);

  const mode = voiceMode();
  const available = voiceAvailable();

  const [phase, setPhaseState] = useState<Phase>('listening');
  const phaseRef = useRef<Phase>('listening');
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };

  const [captions, setCaptions] = useState<CapLine[]>([]);
  const pendingYou = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [errMsg, setErrMsg] = useState('');
  const session = useRef<VoiceSession | null>(null);
  const openRef = useRef(false);
  const mutedNextRef = useRef(false);
  const pausedRef = useRef(false);
  const [pausedUi, setPausedUi] = useState(false);
  const setPaused = (v: boolean) => { pausedRef.current = v; setPausedUi(v); };
  const speechFallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Caption helpers ───────────────────────────────────────────────────────
  const addPendingYou = () => {
    if (pendingYou.current) return;
    const id = capId();
    pendingYou.current = id;
    setCaptions((c) => [...c, { id, who: 'you', text: '', pending: true }]);
  };
  const setPendingYouText = (text: string) => {
    const id = pendingYou.current;
    if (!id) return;
    setCaptions((c) => c.map((l) => (l.id === id ? { ...l, text } : l)));
  };
  const finalizeYou = (text: string) => {
    const id = pendingYou.current;
    pendingYou.current = null;
    if (!text) {
      if (id) setCaptions((c) => c.filter((l) => l.id !== id));
      return;
    }
    if (id) {
      setCaptions((c) => c.map((l) =>
        l.id === id ? { ...l, text, pending: false, reveal: mode === 'recorded' } : l));
    } else {
      setCaptions((c) => [...c, { id: capId(), who: 'you', text, reveal: mode === 'recorded' }]);
    }
  };
  const heldCents = useRef<string | null>(null);
  // CENTS captions arrive HELD (typing dots) and are released to word-reveal
  // the instant the audio starts, so the words track the voice instead of
  // finishing before Cents even opens his mouth.
  const addCentsHeld = (text: string) => {
    if (!text) return;
    const id = capId();
    heldCents.current = id;
    setCaptions((c) => [...c, { id, who: 'cents', text, reveal: true, hold: true }]);
  };
  const releaseHeldCents = () => {
    const id = heldCents.current;
    if (!id) return;
    heldCents.current = null;
    setCaptions((c) => c.map((l) => (l.id === id ? { ...l, hold: false } : l)));
  };

  // ── Waveform values + drivers ─────────────────────────────────────────────
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(FLAT))).current;
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  const driveLevel = (level: number) => {
    if (phaseRef.current !== 'listening') return;
    if (level >= 0.3) addPendingYou(); // your caption row appears as you talk
    bars.forEach((v, i) => {
      const jitter = 0.7 + Math.random() * 0.6;
      const target = FLAT + Math.min(1 - FLAT, level * WEIGHTS[i] * jitter);
      Animated.timing(v, { toValue: target, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
  };

  const stopLoops = () => {
    loops.current.forEach((l) => l.stop());
    loops.current = [];
    bars.forEach((v) =>
      Animated.timing(v, { toValue: FLAT, duration: 180, useNativeDriver: true }).start());
  };

  const startLoops = (amp: number) => {
    stopLoops();
    loops.current = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * 53) % 340),
          Animated.timing(v, {
            toValue: FLAT + amp * WEIGHTS[i],
            duration: 280 + ((i * 37) % 140),
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: FLAT + amp * 0.25 * WEIGHTS[i],
            duration: 300,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ));
    loops.current.forEach((l) => l.start());
  };

  useEffect(() => {
    if (phase === 'speaking') startLoops(0.85);
    else if (phase === 'thinking') startLoops(0.22);
    else stopLoops();
    return stopLoops;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Conversation loop ─────────────────────────────────────────────────────
  const clearFallback = () => {
    if (speechFallback.current) { clearTimeout(speechFallback.current); speechFallback.current = null; }
  };

  const resumeTurn = () => {
    if (!openRef.current) return;
    if (mutedNextRef.current) { mutedNextRef.current = false; setPhase('muted'); return; }
    begin();
  };

  // After a send resolves: caption what Cents SAYS. If speech fired during
  // the send, the caption is the EXACT spoken text (M5.19 fix - captions and
  // voice used to diverge); with the voice toggle off it falls back to the
  // timeline text. Also arms the no-speech fallback so the loop never stalls.
  const captureReplies = (markerBefore: number, spokenBefore: number) => {
    if (!openRef.current) return;
    const spokenNow = getSpokenState();
    const text = spokenNow.counter !== spokenBefore
      ? spokenNow.text
      : spokenTextOf(useFinance.getState().chat.slice(markerBefore));
    if (text) addCentsHeld(text);
    // No-speech fallback: if the audio never starts (voice toggle off, TTS
    // fully dead), release the caption and hand the mic back.
    clearFallback();
    speechFallback.current = setTimeout(() => {
      if (!openRef.current) return;
      releaseHeldCents();
      if (phaseRef.current === 'thinking') resumeTurn();
    }, 2500);
  };

  const begin = () => {
    if (!openRef.current || !available) return;
    session.current?.cancel();
    session.current = null;
    setPaused(false);
    pendingYou.current = null;
    setErrMsg('');
    setPhase('listening');
    startListening({
      lang: 'en-PH',
      autoStopOnSilence: mode === 'recorded',
      onLevel: driveLevel,
      onPartial: (text) => { addPendingYou(); setPendingYouText(text); }, // stream mode: LIVE caption
      onTranscribing: () => {
        if (!openRef.current) return;
        if (pausedRef.current) { mutedNextRef.current = true; setPaused(false); }
        setPhase('thinking');
      },
      onFinal: (text) => handleFinal(text), // stream mode only
      onAudio: (b64, mime) => handleAudio(b64, mime), // recorded fast path
      onError: (m) => {
        if (!openRef.current) return;
        setPaused(false);
        finalizeYou('');
        setErrMsg(m); setPhase('error');
      },
      onEnd: () => {
        if (!openRef.current) return;
        setPaused(false);
        finalizeYou('');
        setPhase('muted');
      },
    }).then((s) => { session.current = s; });
  };

  const handleAudio = (b64: string, mime: string) => {
    session.current = null;
    if (!openRef.current) return;
    setPhase('thinking');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const markerBefore = useFinance.getState().chat.length;
    const spokenBefore = getSpokenState().counter;
    sendVoiceClip(b64, mime).then((transcript) => {
      if (!openRef.current) return;
      finalizeYou(transcript); // full sentence, no truncation
      captureReplies(markerBefore, spokenBefore);
    });
  };

  const handleFinal = (text: string) => {
    const clean = text.trim();
    session.current = null;
    if (!openRef.current) return;
    if (!clean) { finalizeYou(''); setPhase('muted'); return; }
    finalizeYou(clean);
    setPhase('thinking');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const markerBefore = useFinance.getState().chat.length;
    const spokenBefore = getSpokenState().counter;
    sendChat(clean, { viaVoice: true }).then(() => captureReplies(markerBefore, spokenBefore));
  };

  // The caption reveal starts the moment the AUDIO does.
  useEffect(() => {
    const off = onCentsAudioStart(() => {
      if (openRef.current) releaseHeldCents();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cents speech drives the speaking phase and the return to listening.
  useEffect(() => {
    const off = onCentsSpeech((speaking) => {
      if (!openRef.current) return;
      if (speaking) {
        clearFallback();
        session.current?.cancel();
        session.current = null;
        setPhase('speaking');
      } else if (phaseRef.current === 'speaking') {
        releaseHeldCents(); // safety: never leave a caption stuck on dots
        // M5.30: a 450ms cooldown before the mic reopens, so the speaker's
        // tail can't be picked up and transcribed as the user (the "Cents
        // heard itself" incident).
        setTimeout(() => {
          if (openRef.current && phaseRef.current === 'speaking') resumeTurn();
        }, 450);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controls (M5.21: owner layout) ────────────────────────────────────────
  // CENTER = your mic, mute/unmute only. No send button: going quiet for ~5s
  // (or pausing that long after speaking) processes the turn by itself.
  // Pressing while Cents talks barges in: Cents stops, your mic opens.
  const onPrimaryPress = () => {
    switch (phase) {
      case 'listening':
        if (session.current?.pause) { setPaused(true); session.current.pause(); }
        else { session.current?.cancel(); session.current = null; }
        setPhase('muted');
        break;
      case 'muted':
        if (pausedRef.current && session.current?.resume) { setPaused(false); session.current.resume(); setPhase('listening'); }
        else { mutedNextRef.current = false; begin(); }
        break;
      case 'speaking': setPhase('listening'); stopCentsVoice(); begin(); break;
      case 'error': begin(); break;
      case 'thinking': break;
    }
    Haptics.selectionAsync().catch(() => {});
  };

  // LEFT = Cents's voice, speaker on/off. Turning it off mid-sentence
  // silences Cents immediately (the store setter stops playback).
  const speakerToggle = () => {
    setVoiceRepliesEnabled(!voiceRepliesEnabled);
    Haptics.selectionAsync().catch(() => {});
  };

  const leave = () => closeVoice();

  // ── Open / close lifecycle ────────────────────────────────────────────────
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    openRef.current = voiceOpen;
    if (voiceOpen) {
      setCaptions([]); pendingYou.current = null;
      setErrMsg('');
      setPaused(false); mutedNextRef.current = false;
      Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (available) begin();
      else setPhase('muted');
    } else {
      fade.setValue(0);
      clearFallback();
      session.current?.cancel();
      session.current = null;
      stopLoops();
    }
    return () => {
      openRef.current = false;
      clearFallback();
      session.current?.cancel();
      session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOpen]);

  if (!voiceOpen) return null;

  const hint =
    phase === 'error' ? errMsg
    : phase === 'thinking' ? 'Getting that down'
    : phase === 'speaking' ? 'Cents is speaking'
    : phase === 'muted' ? (available ? (pausedUi ? 'Paused. Unmute to keep talking' : 'Mic is off') : 'Voice is coming soon')
    : 'I\u2019m listening';

  const primaryIcon: keyof typeof Ionicons.glyphMap =
    phase === 'listening' ? 'mic'
    : phase === 'error' ? 'refresh'
    : 'mic-off';

  const waveColor = phase === 'speaking' ? t.centsYellow : t.mint;
  const waveDim = phase === 'muted' || phase === 'error';

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      {/* v4: solid matte charcoal canvas — no blur veil, no aurora wash. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(18,20,23,0.97)' }]} />

      <View style={[styles.wrap, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 22 }]}>
        {/* Header */}
        <View style={styles.topRow}>
          <View style={styles.topPill}>
            <View style={[styles.liveDot, phase === 'speaking' && { backgroundColor: t.centsYellow }]} />
            <Text style={styles.topPillText}>Talking with Cents</Text>
          </View>
          <Pressable style={styles.xBtn} onPress={leave}>
            <Ionicons name="close" size={19} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>

        <Text style={styles.hint}>{hint}</Text>

        {/* Waveform */}
        <View style={styles.waveZone}>
          <Waveform bars={bars} color={waveColor} dim={waveDim} />
        </View>

        {/* Caption feed — the lyrics */}
        <View style={styles.captionZone}>
          {captions.length === 0 ? (
            available ? (
              <Text style={styles.ghost}>Speak to talk to Cents</Text>
            ) : (
              <View style={styles.devNote}>
                <Ionicons name="mic-off" size={14} color={t.mint} />
                <Text style={styles.devNoteText}>Voice input is on its way. For now, type your message to Cents.</Text>
              </View>
            )
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.captionScroll}
              contentContainerStyle={styles.captionContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {captions.map((line, i) => (
                <CaptionRow
                  key={line.id}
                  line={line}
                  latest={i === captions.length - 1}
                  styles={styles}
                  t={t}
                  onGrow={() => scrollRef.current?.scrollToEnd({ animated: true })}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* Controls: speaker (Cents voice) | mic mute/unmute | spacer */}
        <View style={styles.controls}>
          <Pressable
            style={[styles.sideBtn, !available && { opacity: 0.35 }]}
            onPress={available ? speakerToggle : undefined}
          >
            <Ionicons
              name={voiceRepliesEnabled ? 'volume-high' : 'volume-mute'}
              size={20}
              color={voiceRepliesEnabled ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)'}
            />
            <Text style={[styles.sideText, !voiceRepliesEnabled && { opacity: 0.55 }]}>
              {voiceRepliesEnabled ? 'Voice on' : 'Voice off'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onPrimaryPress}
            style={({ pressed }) => [pressed && phase !== 'thinking' && { transform: [{ scale: 0.92 }] }]}
          >
            <View style={[styles.bigBtn, { backgroundColor: phase === 'speaking' ? t.centsYellow : t.emerald }]}>
              {phase === 'thinking'
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Ionicons name={primaryIcon} size={26} color={phase === 'speaking' ? '#1A1D20' : '#FFFFFF'} />}
            </View>
          </Pressable>

          <View style={styles.sideBtn} />
        </View>

        <Pressable style={styles.typeInstead} onPress={() => openChat()}>
          <Ionicons name="keypad" size={13} color="rgba(255,255,255,0.65)" />
          <Text style={styles.typeInsteadText}>Type instead</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// One caption line. Cents lines (and finalized recorded YOU lines) reveal
// word by word — a bounded interval, cleared at the last word — so the feed
// reads like following lyrics.
function CaptionRow({ line, latest, styles, t, onGrow }: {
  line: CapLine;
  latest: boolean;
  styles: ReturnType<typeof makeStyles>;
  t: Palette;
  onGrow: () => void;
}) {
  const [shown, setShown] = useState(line.reveal || line.hold ? '' : line.text);

  useEffect(() => {
    if (line.hold) { setShown(''); return; } // waiting for the audio
    if (!line.reveal) { setShown(line.text); return; }
    const words = line.text.split(' ');
    let idx = 0;
    setShown('');
    // CENTS lines pace with the voice (~3 words/sec); YOU lines fill fast.
    const stepMs = line.who === 'cents' ? 300 : 110;
    const iv = setInterval(() => {
      idx += 1;
      setShown(words.slice(0, idx).join(' '));
      onGrow();
      if (idx >= words.length) clearInterval(iv);
    }, stepMs);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.text, line.reveal, line.hold]);

  const isCents = line.who === 'cents';
  return (
    <View style={[styles.capBlock, !latest && { opacity: 0.5 }]}>
      <Text style={isCents ? styles.capLabelCents : styles.capLabelYou}>
        {isCents ? 'CENTS' : 'YOU'}
      </Text>
      {(line.pending && !line.text) || line.hold ? (
        <ActivityIndicator size="small" color={isCents ? t.centsYellow : 'rgba(255,255,255,0.6)'} />
      ) : (
        <Text style={isCents ? styles.centsText : styles.youText}>
          {line.pending ? line.text : shown}
        </Text>
      )}
    </View>
  );
}

function Waveform({ bars, color, dim }: {
  bars: Animated.Value[];
  color: string;
  dim: boolean;
}) {
  return (
    <View style={[waveStyles.row, dim && { opacity: 0.35 }]} pointerEvents="none">
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[waveStyles.bar, { backgroundColor: color, transform: [{ scaleY: v }] }]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  row: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  bar: { width: 4, height: BAR_H, borderRadius: 2 },
});

const makeStyles = (t: Palette) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 26, alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  topPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#7FB89A' },
  topPillText: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: '700' },
  xBtn: {
    width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13.5, fontWeight: '600', marginTop: 20, minHeight: 18, textAlign: 'center' },
  waveZone: { marginTop: 22, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  captionZone: { flex: 1, alignSelf: 'stretch', marginTop: 18, marginBottom: 10, justifyContent: 'center' },
  captionScroll: { flexGrow: 0, maxHeight: '100%' },
  captionContent: { gap: 18, paddingVertical: 8, justifyContent: 'flex-end', flexGrow: 1 },
  capBlock: { alignItems: 'center', gap: 5, alignSelf: 'stretch' },
  capLabelYou: { color: 'rgba(255,255,255,0.45)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  capLabelCents: { color: t.centsYellow, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  youText: { color: 'rgba(255,255,255,0.68)', fontSize: 15.5, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  centsText: { color: 'rgba(255,255,255,0.96)', fontSize: 19, lineHeight: 27, fontWeight: '700', textAlign: 'center' },
  ghost: { color: 'rgba(255,255,255,0.4)', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  devNote: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  devNoteText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 4 },
  sideBtn: { width: 86, alignItems: 'center', gap: 5 },
  sideText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  bigBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  typeInstead: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  typeInsteadText: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, fontWeight: '700' },
});
