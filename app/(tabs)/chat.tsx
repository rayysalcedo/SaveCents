import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import {
  Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Palette, radius, useTheme } from '../../src/theme/colors';
import { useFinance } from '../../src/store/finance';
import { ChatMessage, peso } from '../../src/models/types';

const QUICK_PROMPTS = [
  'Can I afford a 1500 game?',
  'Spent 250 on gas',
  "How's my budget?",
  'Add a Groceries budget for 3000',
];

export default function ChatScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const s1 = Keyboard.addListener('keyboardWillShow', () => setKbVisible(true));
    const s2 = Keyboard.addListener('keyboardWillHide', () => setKbVisible(false));
    const s3 = Keyboard.addListener('keyboardDidShow', () => setKbVisible(true));
    const s4 = Keyboard.addListener('keyboardDidHide', () => setKbVisible(false));
    return () => { s1.remove(); s2.remove(); s3.remove(); s4.remove(); };
  }, []);
  const { chat, isThinking, sendChat, confirmAction, simulateReceiptScan, simulateConsultItem } = useFinance();
  const [input, setInput] = useState('');
  const [cameraSheet, setCameraSheet] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [chat.length, isThinking]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendChat(text);
  };


  // Three bouncing dots while Cents thinks
  const TypingDots = () => {
    const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
    useEffect(() => {
      const loops = dots.map((d, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 140),
            Animated.timing(d, { toValue: 1, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(d, { toValue: 0, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.delay(280 - i * 140 > 0 ? 280 - i * 140 : 0),
          ]),
        ),
      );
      loops.forEach((l) => l.start());
      return () => loops.forEach((l) => l.stop());
    }, []);
    return (
      <View style={styles.typingRow}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              {
                opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
              },
            ]}
          />
        ))}
      </View>
    );
  };

  // Fade + rise entrance for every bubble
  const AppearIn = ({ children }: { children: React.ReactNode }) => {
    const a = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      Animated.timing(a, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [a]);
    return (
      <Animated.View
        style={{
          opacity: a,
          transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      >
        {children}
      </Animated.View>
    );
  };

  const Row = ({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) => {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <Ionicons name={icon} size={14} color={t.emerald} />
      <Text style={{ color: t.emerald, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
    </View>
  );
};

  const CentsMini = () => {
  return (
    <View style={styles.miniAvatar}>
      <Ionicons name="sparkles" size={12} color={t.emerald} />
    </View>
  );
};

  const Bubble = ({ msg }: { msg: ChatMessage }) => {
  const isUser = msg.sender === 'USER';

  if (msg.type === 'text') {
    return (
      <View style={[styles.bubbleRow, isUser && { justifyContent: 'flex-end' }]}>
        {!isUser && <CentsMini />}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.centsBubble]}>
          <Text style={styles.bubbleText}>{msg.text}</Text>
        </View>
      </View>
    );
  }

  // All interactive Cents cards
  const body = (() => {
    switch (msg.type) {
      case 'confirmation':
        return (
          <>
            <Row icon="create" label={msg.lang === 'fil' ? 'I-log ang gastos' : 'Log expense'} />
            <Text style={styles.bubbleText}>{msg.prompt}</Text>
          </>
        );
      case 'negotiation':
        return (
          <>
            <Row icon="scale" label={msg.lang === 'fil' ? 'Purchase check' : 'Purchase check'} />
            <Text style={styles.bubbleText}>{msg.prompt}</Text>
          </>
        );
      case 'receiptScan':
        return (
          <>
            <Row icon="receipt" label="Receipt detected" />
            <Text style={styles.cardBig}>{peso(msg.amount)}</Text>
            <Text style={styles.cardSub}>{msg.store} · category: Pets</Text>
            <Text style={[styles.bubbleText, { marginTop: 8 }]}>Log this expense?</Text>
          </>
        );
      case 'consultItem':
        return (
          <>
            <Row icon="bag-handle" label="Pre-purchase check" />
            <Text style={styles.cardBig}>{msg.item} · {peso(msg.amount)}</Text>
            <Text style={[styles.bubbleText, { marginTop: 8 }]}>
              Buying this delays your <Text style={{ color: t.mint, fontWeight: '600' }}>{msg.goalName}</Text> by{' '}
              <Text style={{ color: t.red, fontWeight: '600' }}>{msg.delayWeeks} weeks</Text>. Proceed?
            </Text>
          </>
        );
      case 'mismatch':
        return (
          <Text style={styles.bubbleText}>
            "{msg.item}" ({peso(msg.amount)}) doesn't fit any of your budgets. Create a new category for it?
          </Text>
        );
    }
  })();

  const fil = 'lang' in msg && msg.lang === 'fil';
  const isNegotiate = msg.type === 'negotiation' || msg.type === 'consultItem';
  const noLabel = fil ? 'Huwag muna' : isNegotiate ? "Don't buy" : 'Cancel';
  const yesLabel = fil ? 'Sige' : isNegotiate ? 'Proceed' : 'Confirm';

  return (
    <View style={styles.bubbleRow}>
      <CentsMini />
      <View style={[styles.bubble, styles.centsBubble, styles.actionCard]}>
        {body}
        {!msg.handled ? (
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.declineBtn, pressed && { opacity: 0.7 }]}
              onPress={() => confirmAction(msg.id, false)}
            >
              <Text style={styles.declineText}>{noLabel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.97 }] }]}
              onPress={() => confirmAction(msg.id, true)}
            >
              <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.actionBtn}>
                <Text style={styles.confirmText}>{yesLabel}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.handledChip, msg.confirmed ? styles.handledYes : styles.handledNo]}>
            <Ionicons
              name={msg.confirmed ? 'checkmark-circle' : 'close-circle'}
              size={13}
              color={msg.confirmed ? t.emerald : t.textMuted}
            />
            <Text style={[styles.handledText, msg.confirmed && { color: t.emerald }]}>
              {msg.confirmed ? (fil ? 'Nai-log' : 'Confirmed') : (fil ? 'Hindi itinuloy' : 'Declined')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
  };

  const SheetItem = (props: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void }) => {
  return (
    <Pressable style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: t.inputFill }]} onPress={props.onPress}>
      <View style={styles.sheetIcon}>
        <Ionicons name={props.icon} size={20} color={t.emerald} />
      </View>
      <View>
        <Text style={styles.sheetItemTitle}>{props.title}</Text>
        <Text style={styles.sheetItemSub}>{props.sub}</Text>
      </View>
    </Pressable>
  );
};

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View>
            <LinearGradient colors={[t.emerald, t.teal]} style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <Ionicons name="sparkles" size={17} color={t.emerald} />
              </View>
            </LinearGradient>
            <View style={styles.onlineDot} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Cents</Text>
            <Text style={styles.headerSub}>AI coach · online</Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="shield-checkmark" size={12} color={t.emerald} />
            <Text style={styles.headerBadgeText}>Guarding 1 goal</Text>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={chat}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <AppearIn><Bubble msg={item} /></AppearIn>}
          ListFooterComponent={
            isThinking ? (
              <View style={styles.bubbleRow}>
                <CentsMini />
                <View style={[styles.bubble, styles.centsBubble, styles.thinking]}>
                  <TypingDots />
                </View>
              </View>
            ) : null
          }
        />

        {/* Quick prompts */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={{ flexGrow: 0, flexShrink: 0, height: 46 }}
          keyboardShouldPersistTaps="always"
        >
          {QUICK_PROMPTS.map((p) => (
            <Pressable key={p} style={styles.chip} onPress={() => sendChat(p)}>
              <Text style={styles.chipText}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Composer */}
        <View style={[styles.composerWrap, { paddingBottom: kbVisible ? 10 : 120 }]}>
          <BlurView intensity={30} tint={t.blurTint} style={styles.composer}>
            <Pressable style={styles.iconBtn} onPress={() => setCameraSheet(true)}>
              <Ionicons name="camera" size={20} color={t.emerald} />
            </Pressable>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message Cents…"
              placeholderTextColor={t.textMuted}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable style={styles.iconBtn} onPress={() => sendChat('🎤 (voice input arrives in M4)')}>
              <Ionicons name="mic" size={20} color={t.emerald} />
            </Pressable>
            <Pressable onPress={send} style={({ pressed }) => pressed && { transform: [{ scale: 0.88 }] }}>
              <LinearGradient colors={[t.emerald, t.teal]} style={[styles.iconBtn, styles.sendBtn]}>
                <Ionicons name="arrow-up" size={18} color={t.onEmerald} />
              </LinearGradient>
            </Pressable>
          </BlurView>
        </View>

        {/* Camera sheet — receipt / consult (simulated until M4) */}
        <Modal visible={cameraSheet} transparent animationType="slide" onRequestClose={() => setCameraSheet(false)}>
          <Pressable style={styles.sheetScrim} onPress={() => setCameraSheet(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Use camera</Text>
              <SheetItem
                icon="receipt" title="Scan receipt" sub="Log an expense automatically"
                onPress={() => { setCameraSheet(false); simulateReceiptScan(); }}
              />
              <SheetItem
                icon="bag-handle" title="Consult item" sub="Ask Cents if you can afford this"
                onPress={() => { setCameraSheet(false); simulateConsultItem(); }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}







const makeStyles = (t: Palette) => StyleSheet.create({
  miniAvatar: {
    width: 26, height: 26, borderRadius: 10, marginRight: 8, marginTop: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 24, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: t.borderSoft,
  },
  avatarRing: { width: 42, height: 42, borderRadius: 15, padding: 2 },
  avatarInner: {
    flex: 1, borderRadius: 13, backgroundColor: t.insetBg,
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute', bottom: -1, right: -1, width: 11, height: 11, borderRadius: 6,
    backgroundColor: t.emerald, borderWidth: 2, borderColor: t.bg,
  },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  headerBadgeText: { color: t.emerald, fontSize: 11, fontWeight: '700' },
  chipsRow: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  chip: {
    backgroundColor: t.mode === 'light' ? t.surfaceStrong : t.inputFill, borderWidth: 1, borderColor: t.border,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipText: { color: t.textPrimary, fontSize: 12, fontWeight: '600' },
  headerTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '700' },
  headerSub: { color: t.textMuted, fontSize: 12 },
  list: { padding: 20, gap: 12, paddingBottom: 20 },
  bubbleRow: { flexDirection: 'row' },
  bubble: {
    maxWidth: '86%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1,
  },
  userBubble: { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
  centsBubble: {
    backgroundColor: t.mode === 'light' ? t.surfaceStrong : 'rgba(255,255,255,0.055)',
    borderColor: t.mode === 'light' ? 'rgba(255,255,255,0.9)' : t.borderSoft,
  },
  actionCard: { minWidth: '70%' },
  bubbleText: { color: t.textPrimary, fontSize: 14, lineHeight: 20 },
  thinking: { paddingVertical: 16, paddingHorizontal: 18 },
  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'flex-end', height: 12 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.emerald },
  handledChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginTop: 12,
    borderWidth: 1,
  },
  handledYes: { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
  handledNo: { backgroundColor: t.inputFill, borderColor: t.borderSoft },
  handledText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },
  cardBig: { color: t.textPrimary, fontSize: 22, fontWeight: '700' },
  cardSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: t.onEmerald, fontWeight: '800', fontSize: 14 },
  declineBtn: { backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft },
  declineText: { color: t.textMuted, fontWeight: '700', fontSize: 14 },
  composerWrap: { paddingHorizontal: 16 },
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.chip, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: t.mode === 'light' ? t.surfaceStrong : t.surface,
    borderWidth: 1, borderColor: t.mode === 'light' ? 'rgba(255,255,255,0.95)' : t.border,
  },
  input: { flex: 1, color: t.textPrimary, fontSize: 14, paddingHorizontal: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { backgroundColor: t.emerald },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border, gap: 6,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 10 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16 },
  sheetIcon: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.12)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  sheetItemTitle: { color: t.textPrimary, fontSize: 15, fontWeight: '600' },
  sheetItemSub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
});
