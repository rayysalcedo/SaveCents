// M5.5b: Scan with Cents — our own camera experience (expo-camera), not the
// system camera. Live viewfinder with corner brackets + a sweeping scan line,
// an Item / Receipt mode switch, capture, torch and gallery import. After
// capture the photo freezes full-bleed, the scan line keeps sweeping while
// Gemini analyzes, then Cents talks in a glass panel pinned to the bottom of
// the scanned image: the analysis, the action card, and a composer so the
// user keeps talking (text or voice) right over the scan. "Open chat" hands
// the same thread to the full chat overlay (everything already lives in the
// chat store, so nothing is lost).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Easing, Image, Keyboard, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Palette, useTheme } from '../../theme/colors';
import { useFinance } from '../../store/finance';
import { useUI, ScanMode } from '../../store/ui';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { ChatMessage, peso } from '../../models/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Phase = 'camera' | 'analyzing' | 'result';

type Styles = ReturnType<typeof makeStyles>;

// ── Module-scope subcomponents ──────────────────────────────────────────────
// Defining these inside the screen creates new component types per render:
// typing in the panel input would remount everything and replay animations
// (the "blinking"). Keep new subcomponents at module scope.

const GlassRound = ({ styles, t, icon, onPress, active }: {
  styles: Styles; t: Palette; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean;
}) => (
  <Pressable style={[styles.glassRound, { backgroundColor: 'rgba(14,16,18,0.55)' }, active && styles.glassRoundActive]} onPress={onPress}>
    <Ionicons name={icon} size={20} color={active ? t.mint : '#FFFFFF'} />
  </Pressable>
);

const Corner = ({ styles, pos }: { styles: Styles; pos: 'tl' | 'tr' | 'bl' | 'br' }) => (
  <View
    style={[
      styles.corner,
      pos === 'tl' && { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 18 },
      pos === 'tr' && { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 18 },
      pos === 'bl' && { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 18 },
      pos === 'br' && { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 18 },
    ]}
  />
);

const ScanFrame = ({ styles, sweep, frameW, frameH }: {
  styles: Styles; sweep: Animated.Value; frameW: number; frameH: number;
}) => (
  <View style={[styles.frame, { width: frameW, height: frameH }]} pointerEvents="none">
    <Corner styles={styles} pos="tl" /><Corner styles={styles} pos="tr" /><Corner styles={styles} pos="bl" /><Corner styles={styles} pos="br" />
    <Animated.View
      style={[
        styles.scanLineWrap,
        { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [8, frameH - 40] }) }] },
      ]}
    >
      <LinearGradient
        colors={['rgba(127,184,154,0)', 'rgba(127,184,154,0.7)', 'rgba(127,184,154,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.scanLine}
      />
      <LinearGradient
        colors={['rgba(245,198,74,0.16)', 'rgba(245,198,74,0)']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={styles.scanTrail}
      />
    </Animated.View>
  </View>
);

const TypingDots = ({ styles }: { styles: Styles }) => {
  const d0 = React.useRef(new Animated.Value(0)).current;
  const d1 = React.useRef(new Animated.Value(0)).current;
  const d2 = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loops = [d0, d1, d2].map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(d, { toValue: 1, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [d0, d1, d2]);
  return (
    <View style={styles.typingRow}>
      {[d0, d1, d2].map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.typingDot, {
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }]}
        />
      ))}
    </View>
  );
};

const ThreadItem = React.memo(function ThreadItem({ msg, styles, t, confirmAction }: {
  msg: ChatMessage; styles: Styles; t: Palette; confirmAction: (id: string, confirm: boolean) => void;
}) {
  if (msg.type === 'text') {
    if (msg.sender === 'USER') {
      return (
        <View style={styles.userPillRow}>
          <View style={[styles.userPill, { backgroundColor: t.forest }]}>
            <Text style={styles.userPillText}>{msg.text}</Text>
          </View>
        </View>
      );
    }
    return <Text style={styles.centsLine}>{msg.text}</Text>;
  }
  const prompt =
    msg.type === 'confirmation' || msg.type === 'negotiation' ? msg.prompt
    : msg.type === 'batchConfirmation' ? `${msg.prompt}\n${msg.steps.map((s2, i) => `${i + 1}. ${s2}`).join('\n')}`
    : msg.type === 'receiptScan' ? `Log ${peso(msg.amount)} from ${msg.store}?`
    : msg.type === 'consultItem' ? `${msg.item} at ${peso(msg.amount)} delays ${msg.goalName} by ${msg.delayWeeks} weeks. Proceed?`
    : `"${msg.item}" (${peso(msg.amount)}) doesn't fit your budgets. Create a category?`;
  const fil = 'lang' in msg && msg.lang === 'fil';
  const isNegotiate = msg.type === 'negotiation' || msg.type === 'consultItem';
  return (
    <View style={styles.miniCard}>
      <Text style={styles.centsLine}>{prompt}</Text>
      {!msg.handled ? (
        <View style={styles.miniActions}>
          <Pressable style={styles.miniDecline} onPress={() => confirmAction(msg.id, false)}>
            <Text style={styles.miniDeclineText}>{fil ? 'Huwag muna' : isNegotiate ? "Don't buy" : 'Cancel'}</Text>
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => confirmAction(msg.id, true)}>
            <View style={[styles.miniConfirm, { backgroundColor: t.emerald }]}>
              <Text style={styles.miniConfirmText}>{fil ? 'Sige' : isNegotiate ? 'Proceed' : 'Confirm'}</Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.miniHandled}>
          <Ionicons name={msg.confirmed ? 'checkmark-circle' : 'close-circle'} size={13} color={msg.confirmed ? t.mint : 'rgba(255,255,255,0.5)'} />
          <Text style={[styles.miniHandledText, msg.confirmed && { color: t.mint }]}>
            {msg.confirmed ? (fil ? 'Nai-log' : 'Confirmed') : (fil ? 'Hindi itinuloy' : 'Declined')}
          </Text>
        </View>
      )}
    </View>
  );
});

export function ScanOverlay() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { scanOpen, scanMode, closeScan, openChat, openVoice } = useUI();
  const { chat, isThinking, sendImage, sendChat, confirmAction } = useFinance();
  const { inset: kbInset, visible: kbVisible } = useKeyboardInset();

  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [mode, setMode] = useState<ScanMode>('price');
  const [phase, setPhase] = useState<Phase>('camera');
  const [torch, setTorch] = useState(false);
  const [shotUri, setShotUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const startIndex = useRef(0);
  const threadRef = useRef<ScrollView>(null);

  const enter = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const panelUp = useRef(new Animated.Value(0)).current;

  // Entrance + reset per open
  useEffect(() => {
    if (scanOpen) {
      setMode(scanMode);
      setPhase('camera');
      setShotUri(null);
      setTorch(false);
      setInput('');
      panelUp.setValue(0);
      Animated.timing(enter, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      if (perm && !perm.granted && perm.canAskAgain) requestPerm();
    } else {
      enter.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen]);

  // Sweeping scan line — runs while framing and while analyzing
  useEffect(() => {
    if (!scanOpen || phase === 'result') { sweep.stopAnimation(); return; }
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanOpen, phase, sweep]);

  // Analysis finished → slide the result panel up
  useEffect(() => {
    if (phase === 'result') {
      Animated.spring(panelUp, { toValue: 1, friction: 9, tension: 60, useNativeDriver: true }).start();
    }
  }, [phase, panelUp]);

  // Keep the mini-thread pinned to the newest message
  useEffect(() => {
    if (phase === 'result') {
      const timer = setTimeout(() => threadRef.current?.scrollToEnd({ animated: true }), 90);
      return () => clearTimeout(timer);
    }
  }, [chat.length, isThinking, phase]);

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.timing(enter, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => closeScan());
  };

  const analyze = async (base64: string, uri: string, m: ScanMode) => {
    startIndex.current = useFinance.getState().chat.length + 1; // skip the user's image message
    setShotUri(uri);
    setPhase('analyzing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await sendImage(base64, 'image/jpeg', m, uri);
    setPhase('result');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const capture = async () => {
    if (busy || !camRef.current) return;
    setBusy(true);
    try {
      const shot = await camRef.current.takePictureAsync({
        base64: true,
        quality: mode === 'receipt' ? 0.7 : 0.5,
      });
      if (shot?.base64) await analyze(shot.base64, shot.uri, mode);
    } catch (e) {
      Alert.alert('Camera error', String((e as Error)?.message ?? e));
      setPhase('camera');
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permLib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permLib.granted) {
        Alert.alert('Photos access needed', 'Allow photo access to import a photo.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ quality: mode === 'receipt' ? 0.7 : 0.5, base64: true });
      const a = res.canceled ? null : res.assets?.[0];
      if (a?.base64) await analyze(a.base64, a.uri, mode);
    } catch (e) {
      Alert.alert('Photos error', String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    Keyboard.dismiss();
    panelUp.setValue(0);
    setShotUri(null);
    setPhase('camera');
  };

  const toChat = () => {
    Keyboard.dismiss();
    closeScan();
    openChat();
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendChat(text);
  };

  if (!scanOpen) return null;

  // Frame geometry — receipts are tall, items squarer
  const frameW = SCREEN_W - 72;
  const frameH = mode === 'receipt' ? Math.min(frameW * 1.32, SCREEN_H * 0.5) : frameW * 1.02;

  const thread = chat.slice(startIndex.current).filter((m) => !(m.type === 'text' && m.sender === 'USER' && m.imageUri));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter, backgroundColor: '#020905' }]}>
      {/* Layer 1: live camera or the captured shot */}
      {phase === 'camera' ? (
        perm?.granted ? (
          <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />
        ) : (
          <View style={styles.permWrap}>
            <View style={styles.permIcon}>
              <Ionicons name="camera" size={28} color={t.mint} />
            </View>
            <Text style={styles.permTitle}>Cents needs the camera</Text>
            <Text style={styles.permSub}>Point it at an item or a receipt and Cents reads it for you.</Text>
            <Pressable onPress={() => requestPerm()} style={({ pressed }) => pressed && { transform: [{ scale: 0.97 }] }}>
              <View style={[styles.permBtn, { backgroundColor: t.emerald }]}>
                <Text style={styles.permBtnText}>Allow camera</Text>
              </View>
            </Pressable>
            <Pressable onPress={pickFromLibrary}>
              <Text style={styles.permAlt}>Or import from Photos</Text>
            </Pressable>
          </View>
        )
      ) : (
        shotUri && <Image source={{ uri: shotUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      {/* Layer 2: vignette so chrome stays readable on any scene */}
      <LinearGradient
        colors={['rgba(2,9,5,0.75)', 'rgba(2,9,5,0)', 'rgba(2,9,5,0)', 'rgba(2,9,5,0.85)']}
        locations={[0, 0.22, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <GlassRound styles={styles} t={t} icon="close" onPress={dismiss} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{phase === 'camera' ? 'Scan with Cents' : mode === 'receipt' ? 'Receipt' : 'Item'}</Text>
          {phase === 'analyzing' && <Text style={styles.headerSub}>Reading the photo</Text>}
        </View>
        {phase === 'camera'
          ? <GlassRound styles={styles} t={t} icon={torch ? 'flash' : 'flash-off'} active={torch} onPress={() => setTorch((v) => !v)} />
          : <GlassRound styles={styles} t={t} icon="camera-reverse" onPress={retake} />}
      </View>

      {/* Viewfinder frame + sweep (camera + analyzing) */}
      {phase !== 'result' && (
        <View style={styles.frameHost} pointerEvents="none">
          <ScanFrame styles={styles} sweep={sweep} frameW={frameW} frameH={frameH} />
          {phase === 'analyzing' && (
            <View style={[styles.analyzingChip, { backgroundColor: 'rgba(14,16,18,0.55)' }]}>
              <View style={styles.analyzingDot} />
              <Text style={styles.analyzingText}>Cents is analyzing</Text>
              <TypingDots styles={styles} />
            </View>
          )}
        </View>
      )}

      {/* Camera controls */}
      {phase === 'camera' && perm?.granted && (
        <View style={[styles.controls, { paddingBottom: insets.bottom + 22 }]}>
          <View style={[styles.modeSwitch, { backgroundColor: 'rgba(14,16,18,0.55)' }]}>
            {(['price', 'receipt'] as ScanMode[]).map((m) => {
              const active = mode === m;
              return (
                <Pressable key={m} onPress={() => setMode(m)} style={styles.modeSeg}>
                  {active && <View style={[StyleSheet.absoluteFill, { backgroundColor: t.emerald }]} />}
                  <Text style={[styles.modeText, active && { color: '#FFFFFF' }]}>{m === 'price' ? 'Item' : 'Receipt'}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.shutterRow}>
            <Pressable style={[styles.sideBtn, { backgroundColor: 'rgba(14,16,18,0.55)' }]} onPress={pickFromLibrary}>
              <Ionicons name="images" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={capture} style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.93 }] }]}>
              <View style={[styles.shutterInner, { backgroundColor: t.emerald }]} />
            </Pressable>
            <View style={{ width: 46, height: 46 }} />
          </View>
          <Text style={styles.hint}>
            {mode === 'receipt' ? 'Fit the whole receipt inside the frame' : 'Center the item or its price tag'}
          </Text>
        </View>
      )}

      {/* Result panel: Cents talks under the scanned image */}
      {phase === 'result' && (
        <Animated.View
          style={[
            styles.panelWrap,
            {
              opacity: panelUp,
              transform: [{ translateY: panelUp.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
            },
          ]}
        >
          <View style={[styles.panel, { backgroundColor: 'rgba(20,23,26,0.94)' }]}>
            <View style={styles.panelHead}>
                <View style={[styles.panelAvatar, { backgroundColor: t.forest }]}>
                  <Image source={require('../../../assets/cents-mark-white.png')} style={{ width: 16, height: 16 }} resizeMode="contain" />
                </View>
                <Text style={styles.panelName}>Cents</Text>
                <View style={{ flex: 1 }} />
                <Pressable style={styles.openChatBtn} onPress={toChat}>
                  <Text style={styles.openChatText}>Open chat</Text>
                  <Ionicons name="arrow-forward" size={13} color={t.mint} />
                </Pressable>
              </View>

              <ScrollView
                ref={threadRef}
                style={styles.thread}
                contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {thread.map((m) => <ThreadItem key={m.id} msg={m} styles={styles} t={t} confirmAction={confirmAction} />)}
                {isThinking && <TypingDots styles={styles} />}
              </ScrollView>

              <View style={styles.panelComposer}>
                <TextInput
                  style={styles.panelInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask Cents about it"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  onSubmitEditing={send}
                  returnKeyType="send"
                />
                <Pressable style={styles.panelIconBtn} onPress={openVoice}>
                  <Ionicons name="mic" size={19} color={t.mint} />
                </Pressable>
                <Pressable onPress={send} style={({ pressed }) => pressed && { transform: [{ scale: 0.9 }] }}>
                  <View style={[styles.panelIconBtn, { borderWidth: 0, backgroundColor: t.emerald }]}>
                    <Ionicons name="arrow-up" size={17} color="#FFFFFF" />
                  </View>
                </Pressable>
              </View>
            </View>
          <View style={{ height: kbVisible ? 8 : insets.bottom + 8 }} />
          <Animated.View style={{ height: kbInset }} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 16.5, fontWeight: '800', letterSpacing: 0.2 },
  headerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11.5, marginTop: 1 },
  glassRound: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  glassRoundActive: { borderColor: 'rgba(127,184,154,0.8)' },

  frameHost: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'relative' },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: 'rgba(110,231,183,0.95)' },
  scanLineWrap: { position: 'absolute', left: 6, right: 6 },
  scanLine: { height: 2.5, borderRadius: 2 },
  scanTrail: { height: 34, marginTop: 0 },

  analyzingChip: {
    position: 'absolute', bottom: '16%', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  analyzingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.mint },
  analyzingText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 16 },
  modeSwitch: {
    flexDirection: 'row', borderRadius: 999, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  modeSeg: { paddingHorizontal: 22, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  modeText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '800' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', gap: 30 },
  shutter: {
    width: 76, height: 76, borderRadius: 38, padding: 5,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29 },
  sideBtn: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '600' },

  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  permIcon: {
    width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.14)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)',
  },
  permTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', marginTop: 4 },
  permSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  permBtn: { borderRadius: 999, paddingHorizontal: 26, paddingVertical: 13, marginTop: 8 },
  permBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14.5 },
  permAlt: { color: t.mint, fontSize: 13.5, fontWeight: '700', marginTop: 6 },

  panelWrap: { position: 'absolute', left: 12, right: 12, bottom: 0 },
  panel: {
    borderRadius: 28, overflow: 'hidden', padding: 16, maxHeight: SCREEN_H * 0.55,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  panelAvatar: {
    width: 26, height: 26, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  panelName: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },
  openChatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: 'rgba(16,185,129,0.16)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.45)',
  },
  openChatText: { color: t.mint, fontSize: 12, fontWeight: '800' },

  thread: { flexGrow: 0, maxHeight: SCREEN_H * 0.3 },
  centsLine: { color: 'rgba(255,255,255,0.94)', fontSize: 14, lineHeight: 20.5 },
  userPillRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userPill: { borderRadius: 16, borderBottomRightRadius: 6, paddingHorizontal: 13, paddingVertical: 8, maxWidth: '85%' },
  userPillText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '600' },

  miniCard: {
    borderRadius: 18, padding: 12,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  miniActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  miniDecline: {
    flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  miniDeclineText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 13 },
  miniConfirm: { height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  miniConfirmText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  miniHandled: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  miniHandledText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700' },

  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'flex-end', height: 12, paddingVertical: 2 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.mint },

  panelComposer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  panelInput: {
    flex: 1, height: 42, borderRadius: 21, paddingHorizontal: 14,
    color: '#FFFFFF', fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  panelIconBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
});
