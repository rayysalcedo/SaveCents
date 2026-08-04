// M5.5d: Cents chat — full-screen liquid-glass overlay in the v4 language the
// owner picked: centered title + status dot header, soft emerald top glow,
// left-aligned hero, tinted icon chips, frosted soft-border MATTE bubbles (no
// sheen). The scan button opens a two-option glass sheet (item / receipt)
// that launches the in-app ScanOverlay camera.
// Deliberately NOT an RN Modal, and no KeyboardAvoidingView (KAV mis-measures
// inside absolute/transformed overlays; keyboard tracked via useKeyboardInset).
//
// M5.5f: every subcomponent lives at MODULE scope. Defining them inside the
// screen component creates new component types on each render, so typing one
// character remounted the whole thread and replayed every entrance animation
// (the "blinking"). Keep new subcomponents at module scope.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, FlatList, Image, Keyboard, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Palette, useTheme } from '../../theme/colors';
import { useFinance } from '../../store/finance';
import { useUI } from '../../store/ui';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { ChatMessage, peso } from '../../models/types';

type Styles = ReturnType<typeof makeStyles>;

const QUICK_PROMPTS = [
  'Can I afford a 1500 game?',
  'Spent 250 on gas',
  "How's my budget?",
  'Add a Groceries budget for 3000',
];

const SUGGESTIONS: { icon: keyof typeof Ionicons.glyphMap; title: string; prompt: string }[] = [
  { icon: 'scale', title: 'Check a purchase', prompt: 'Can I afford a 1500 game?' },
  { icon: 'create', title: 'Log an expense', prompt: 'Spent 250 on gas' },
  { icon: 'pie-chart', title: 'Review my budget', prompt: "How's my budget looking this month?" },
];

// ── Module-scope subcomponents (see M5.5f note above) ───────────────────────

function TypingDots({ styles }: { styles: Styles }) {
  const d0 = useRef(new Animated.Value(0)).current;
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const dots = [d0, d1, d2];
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
  }, [d0, d1, d2]);
  return (
    <View style={styles.typingRow}>
      {[d0, d1, d2].map((d, i) => (
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
}

// Fade + rise entrance. Runs ONCE per mount; module scope keeps mounts stable.
function AppearIn({ children }: { children: React.ReactNode }) {
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
}

const CentsMini = ({ styles, t }: { styles: Styles; t: Palette }) => (
  <View style={styles.miniAvatar}>
    <Image source={require('../../../assets/cents-mark.png')} style={{ width: 16, height: 16 }} resizeMode="contain" />
  </View>
);

const CardLabel = ({ styles, t, icon, label }: { styles: Styles; t: Palette; icon: keyof typeof Ionicons.glyphMap; label: string }) => (
  <View style={styles.cardLabelRow}>
    <Ionicons name={icon} size={14} color={t.emerald} />
    <Text style={styles.cardLabelText}>{label.toUpperCase()}</Text>
  </View>
);

// Frosted MATTE glass shell. v25 PERF: the per-bubble BlurView is replaced by
// the translucent fill rule 3.3 sanctions — one UIVisualEffectView PER BUBBLE
// over the blur-80 backdrop made long threads drop frames while scrolling.
// The fill is tuned up slightly (esp. dark) so the matte look is unchanged;
// the full-screen backdrop blur still supplies the liquid-glass depth.
const Glass = ({ styles, t, children, strong }: { styles: Styles; t: Palette; children: React.ReactNode; strong?: boolean }) => (
  <View style={[styles.glassBubble, strong && styles.glassBubbleStrong]}>
    <LinearGradient
      colors={
        t.mode === 'dark'
          ? ['rgba(30,48,39,0.92)', 'rgba(22,38,30,0.88)']
          : ['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.86)']
      }
      style={StyleSheet.absoluteFill}
    />
    <View style={styles.glassInner}>{children}</View>
  </View>
);

interface BubbleProps {
  msg: ChatMessage;
  styles: Styles;
  t: Palette;
  confirmAction: (id: string, confirm: boolean) => void;
}

const Bubble = memo(function Bubble({ msg, styles, t, confirmAction }: BubbleProps) {
  const isUser = msg.sender === 'USER';

  if (msg.type === 'text') {
    // A photo with no caption renders bare: just the image with a barely
    // visible hairline border. No bubble, no label.
    if (msg.imageUri && !msg.text) {
      return (
        <View style={[styles.bubbleRow, isUser && { justifyContent: 'flex-end' }]}>
          {!isUser && <CentsMini styles={styles} t={t} />}
          <Image source={{ uri: msg.imageUri }} style={styles.bareImage} resizeMode="cover" />
        </View>
      );
    }
    if (isUser) {
      return (
        <View style={[styles.bubbleRow, { justifyContent: 'flex-end' }]}>
          <LinearGradient colors={[t.emerald, t.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userBubble}>
            {msg.imageUri ? <Image source={{ uri: msg.imageUri }} style={styles.bubbleImage} resizeMode="cover" /> : null}
            <Text style={styles.userText}>{msg.text}</Text>
          </LinearGradient>
        </View>
      );
    }
    return (
      <View style={styles.bubbleRow}>
        <CentsMini styles={styles} t={t} />
        <Glass styles={styles} t={t}>
          {msg.imageUri ? <Image source={{ uri: msg.imageUri }} style={styles.bubbleImage} resizeMode="cover" /> : null}
          <Text style={styles.centsText}>{msg.text}</Text>
        </Glass>
      </View>
    );
  }

  const body = (() => {
    switch (msg.type) {
      case 'confirmation':
        return (
          <>
            <CardLabel styles={styles} t={t}
              icon={
                msg.action.kind === 'AddAccount' ? 'wallet'
                : msg.action.kind === 'AddIncome' ? 'trending-up'
                : msg.action.kind === 'AddGoal' || msg.action.kind === 'AddToGoal' || msg.action.kind === 'WithdrawFromGoal' ? 'flag'
                : msg.action.kind === 'AddCategory' || msg.action.kind === 'UpdateBudget' || msg.action.kind === 'RemoveCategory' ? 'pie-chart'
                : 'create'
              }
              label={
                msg.action.kind === 'AddAccount' ? (msg.lang === 'fil' ? 'Bagong wallet' : 'New money source')
                : msg.action.kind === 'AddIncome' ? (msg.lang === 'fil' ? 'Dagdag na pera' : 'Add income')
                : msg.action.kind === 'AddGoal' ? (msg.lang === 'fil' ? 'Bagong goal' : 'New goal')
                : msg.action.kind === 'AddToGoal' ? (msg.lang === 'fil' ? 'Ipon sa goal' : 'Goal savings')
                : msg.action.kind === 'WithdrawFromGoal' ? (msg.lang === 'fil' ? 'Kuha sa goal' : 'Goal withdrawal')
                : msg.action.kind === 'AddCategory' || msg.action.kind === 'UpdateBudget' || msg.action.kind === 'RemoveCategory' ? (msg.lang === 'fil' ? 'Budget' : 'Budget')
                : (msg.lang === 'fil' ? 'I-log ang gastos' : 'Log expense')
              }
            />
            <Text style={styles.centsText}>{msg.prompt}</Text>
          </>
        );
      case 'negotiation':
        return (
          <>
            <CardLabel styles={styles} t={t} icon="scale" label="Purchase check" />
            <Text style={styles.centsText}>{msg.prompt}</Text>
          </>
        );
      case 'receiptScan':
        return (
          <>
            <CardLabel styles={styles} t={t} icon="receipt" label="Receipt detected" />
            <Text style={styles.cardBig}>{peso(msg.amount)}</Text>
            <Text style={styles.cardSub}>{msg.store}</Text>
            <Text style={[styles.centsText, { marginTop: 8 }]}>Log this expense?</Text>
          </>
        );
      case 'consultItem':
        return (
          <>
            <CardLabel styles={styles} t={t} icon="bag-handle" label="Pre-purchase check" />
            <Text style={styles.cardBig}>{msg.item} · {peso(msg.amount)}</Text>
            <Text style={[styles.centsText, { marginTop: 8 }]}>
              Buying this delays your <Text style={{ color: t.emerald, fontWeight: '700' }}>{msg.goalName}</Text> by{' '}
              <Text style={{ color: t.red, fontWeight: '700' }}>{msg.delayWeeks} weeks</Text>. Proceed?
            </Text>
          </>
        );
      case 'mismatch':
        return (
          <Text style={styles.centsText}>
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
      <CentsMini styles={styles} t={t} />
      <Glass styles={styles} t={t} strong>
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
      </Glass>
    </View>
  );
});

function SheetItem(props: {
  styles: Styles; t: Palette;
  icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void;
}) {
  const { styles, t } = props;
  return (
    <Pressable style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: t.inputFill }]} onPress={props.onPress}>
      <View style={styles.sheetIcon}>
        <Ionicons name={props.icon} size={20} color={t.emerald} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sheetItemTitle}>{props.title}</Text>
        <Text style={styles.sheetItemSub}>{props.sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
    </Pressable>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function CentsChatModal() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { chatOpen, closeChat, openVoice, openScan } = useUI();
  const { chat, isThinking, sendChat, confirmAction, profile } = useFinance();
  const { inset: kbInset } = useKeyboardInset();

  const enter = useRef(new Animated.Value(0)).current;
  const [input, setInput] = useState('');
  const [scanSheet, setScanSheet] = useState(false);
  const listRef = useRef<FlatList>(null);

  const fresh = chat.length <= 1; // only the seeded greeting so far

  useEffect(() => {
    if (chatOpen) {
      Animated.timing(enter, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      enter.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.timing(enter, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => closeChat());
  };

  // INVERTED list: newest message lives at offset 0, so when the keyboard
  // shrinks the list the latest bubbles stay pinned above the composer with
  // ZERO scroll bookkeeping. (Replaces the old setTimeout+scrollToEnd hack,
  // which raced the keyboard animation and left new bubbles covered.)
  const reversedChat = useMemo(() => [...chat].reverse(), [chat]);

  // Dock spacer rides ONE continuous animated value: max(safe-area, keyboard).
  // The old `kbVisible ? 10 : insets.bottom + 12` padding snapped between two
  // heights the moment the keyboard started moving — that was the visible
  // hitch when tapping out of the conversation.
  const safe = insets.bottom + 4;
  const dockSpacer = useMemo(
    () =>
      kbInset.interpolate({
        inputRange: [0, safe, safe + 1000],
        outputRange: [safe, safe, safe + 1000],
      }),
    [kbInset, safe],
  );

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendChat(text);
  };

  const startScan = (mode: 'price' | 'receipt') => {
    setScanSheet(false);
    openScan(mode); // our own overlay view, no iOS presentation conflict
  };

  if (!chatOpen) return null;

  const nickname = profile.nickname || profile.name || 'there';

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
        },
      ]}
    >
      {/* Liquid-glass veil over the screen the user was on */}
      <BlurView intensity={80} tint={t.blurTint} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={
          t.mode === 'dark'
            ? ['rgba(4,16,10,0.66)', 'rgba(3,12,8,0.44)', 'rgba(2,10,6,0.82)']
            : ['rgba(238,246,240,0.7)', 'rgba(255,255,255,0.38)', 'rgba(228,240,232,0.86)']
        }
        style={StyleSheet.absoluteFill}
      />
      {/* Soft emerald glow for depth */}
      <LinearGradient
        colors={[t.emeraldGlow, 'rgba(16,185,129,0)']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={styles.glowTop}
        pointerEvents="none"
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.glassBtn} onPress={dismiss}>
          <BlurView intensity={32} tint={t.blurTint} style={StyleSheet.absoluteFill} />
          <Ionicons name="chevron-down" size={20} color={t.textPrimary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Cents AI</Text>
            <View style={styles.onlineDot} />
          </View>
        </View>
        {/* Right spacer keeps the title centered; the header scan button was
            removed (owner request) — scanning lives in the composer camera
            button, the quick dial, and the hub. */}
        <View style={styles.glassBtnSpacer} />
      </View>

      {/* Thread or hero */}
      {fresh ? (
        <Pressable style={styles.hero} onPress={Keyboard.dismiss}>
          <Text style={styles.heroHello}>Hello, {nickname}</Text>
          <Text style={styles.heroTitle}>What should we do{'\n'}with your money?</Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((sug) => (
              <Pressable key={sug.title} onPress={() => sendChat(sug.prompt)} style={({ pressed }) => pressed && { transform: [{ scale: 0.985 }] }}>
                <View style={styles.suggestCard}>
                  <BlurView intensity={28} tint={t.blurTint} style={StyleSheet.absoluteFill} />
                  <LinearGradient
                    colors={
                      t.mode === 'dark'
                        ? ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.03)']
                        : ['rgba(255,255,255,0.94)', 'rgba(255,255,255,0.66)']
                    }
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.suggestIcon}>
                    <Ionicons name={sug.icon} size={16} color={t.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestTitle}>{sug.title}</Text>
                    <Text style={styles.suggestPrompt}>{sug.prompt}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
                </View>
              </Pressable>
            ))}
          </View>
        </Pressable>
      ) : (
        // v25: the FlatList must NOT be wrapped in a Pressable — a Pressable
        // parent joins the responder negotiation for every touch, so scroll
        // drags started with a dead zone and often failed to move at all
        // (owner-reported). Keyboard dismissal now relies on
        // keyboardDismissMode="interactive" (drag the thread down) and the
        // chevron; blank-space tap dismissal was the cost of working scroll.
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={reversedChat}
            inverted
            keyExtractor={(m) => m.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
            renderItem={({ item, index }) =>
              // inverted list: index 0 = newest = the only row that animates.
              index === 0 ? (
                <AppearIn>
                  <Bubble msg={item} styles={styles} t={t} confirmAction={confirmAction} />
                </AppearIn>
              ) : (
                <Bubble msg={item} styles={styles} t={t} confirmAction={confirmAction} />
              )
            }
            // In an inverted list the HEADER renders at the visual bottom —
            // exactly where the typing indicator belongs.
            ListHeaderComponent={
              isThinking ? (
                <View style={styles.bubbleRow}>
                  <CentsMini styles={styles} t={t} />
                  <Glass styles={styles} t={t}>
                    <TypingDots styles={styles} />
                  </Glass>
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Bottom dock: quick prompts + floating composer + keyboard inset */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={{ flexGrow: 0, flexShrink: 0 }}
          keyboardShouldPersistTaps="always"
        >
          {QUICK_PROMPTS.map((p) => (
            <Pressable key={p} style={styles.chip} onPress={() => sendChat(p)}>
              <BlurView intensity={24} tint={t.blurTint} style={StyleSheet.absoluteFill} />
              <Text style={styles.chipText}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.composerWrap, { paddingBottom: 10 }]}>
          <View style={styles.composer}>
            <BlurView intensity={46} tint={t.blurTint} style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={
                t.mode === 'dark'
                  ? ['rgba(255,255,255,0.13)', 'rgba(255,255,255,0.05)']
                  : ['rgba(255,255,255,0.97)', 'rgba(255,255,255,0.76)']
              }
              style={StyleSheet.absoluteFill}
            />
            <Pressable style={styles.iconBtn} onPress={() => setScanSheet(true)}>
              <Ionicons name="camera" size={20} color={t.emerald} />
            </Pressable>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message Cents"
              placeholderTextColor={t.textMuted}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable style={styles.iconBtn} onPress={openVoice}>
              <Ionicons name="mic" size={20} color={t.emerald} />
            </Pressable>
            <Pressable onPress={send} style={({ pressed }) => pressed && { transform: [{ scale: 0.88 }] }}>
              <LinearGradient colors={[t.emerald, t.teal]} style={[styles.iconBtn, styles.sendBtn]}>
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
          </View>
        </View>
        <Animated.View style={{ height: dockSpacer }} />
      </View>

      {/* Scan sheet: item or receipt, launches the in-app camera overlay */}
      <Modal visible={scanSheet} transparent animationType="slide" onRequestClose={() => setScanSheet(false)}>
        <Pressable style={styles.sheetScrim} onPress={() => setScanSheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Scan with Cents</Text>
            <SheetItem
              styles={styles} t={t}
              icon="pricetag" title="Scan an item" sub="Cents identifies it, finds the price, and checks your numbers"
              onPress={() => startScan('price')}
            />
            <SheetItem
              styles={styles} t={t}
              icon="receipt" title="Scan a receipt" sub="Cents reads the total and breaks down what you paid for"
              onPress={() => startScan('receipt')}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  glowTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 220, opacity: 0.5 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  headerCenter: { alignItems: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: t.textPrimary, fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  headerSub: { color: t.textMuted, fontSize: 11.5, marginTop: 1 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.emerald },
  glassBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', borderWidth: 1,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.9)',
    backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
  },
  glassBtnSpacer: { width: 40, height: 40 },

  hero: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  heroHello: { color: t.textMuted, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  heroTitle: {
    color: t.textPrimary, fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -0.5,
    marginBottom: 28,
  },
  suggestions: { gap: 10 },
  suggestCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 20, padding: 13, overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.95)',
    shadowColor: '#02170D', shadowOpacity: t.mode === 'dark' ? 0.2 : 0.08,
    shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  suggestIcon: {
    width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  suggestTitle: { color: t.textPrimary, fontSize: 14.5, fontWeight: '800' },
  suggestPrompt: { color: t.textMuted, fontSize: 12.5, marginTop: 1 },

  list: { padding: 18, gap: 12, paddingBottom: 16 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end' },
  // Owner spec: the Cents mark sits plain inside a neutral circle — no green
  // fill behind it.
  miniAvatar: {
    width: 26, height: 26, borderRadius: 13, marginRight: 8, marginBottom: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border,
  },
  glassBubble: {
    maxWidth: '84%', borderRadius: 22, borderBottomLeftRadius: 8, overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.95)',
  },
  glassBubbleStrong: {
    minWidth: '72%',
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,1)',
    shadowColor: '#02170D', shadowOpacity: t.mode === 'dark' ? 0.28 : 0.12,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glassInner: { paddingHorizontal: 16, paddingVertical: 12 },
  userBubble: {
    maxWidth: '84%', borderRadius: 22, borderBottomRightRadius: 8, overflow: 'hidden',
    paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: t.emerald, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  userText: { color: '#FFFFFF', fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
  centsText: { color: t.textPrimary, fontSize: 14.5, lineHeight: 21 },
  bubbleImage: { width: 200, height: 200, borderRadius: 14, marginBottom: 8 },
  bareImage: {
    width: 232, height: 232, borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(2,44,34,0.18)',
  },

  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardLabelText: { color: t.emerald, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  cardBig: { color: t.textPrimary, fontSize: 22, fontWeight: '800' },
  cardSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: t.onEmerald, fontWeight: '800', fontSize: 14 },
  declineBtn: { backgroundColor: t.inputFill, borderWidth: 1, borderColor: t.borderSoft },
  declineText: { color: t.textMuted, fontWeight: '700', fontSize: 14 },
  handledChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginTop: 12, borderWidth: 1,
  },
  handledYes: { backgroundColor: t.emeraldTint, borderColor: t.emeraldBorder },
  handledNo: { backgroundColor: t.inputFill, borderColor: t.borderSoft },
  handledText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },

  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'flex-end', height: 12, paddingVertical: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.emerald },

  chipsRow: { gap: 8, paddingHorizontal: 16, paddingBottom: 10, alignItems: 'center' },
  chip: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.94)',
    backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)',
  },
  chipText: { color: t.textPrimary, fontSize: 12, fontWeight: '600' },

  composerWrap: { paddingHorizontal: 14 },
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 28, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.mode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.98)',
    shadowColor: '#02170D', shadowOpacity: t.mode === 'dark' ? 0.3 : 0.14,
    shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  input: { flex: 1, color: t.textPrimary, fontSize: 14.5, paddingHorizontal: 4, paddingVertical: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendBtn: {
    shadowColor: t.emerald, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },

  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44, borderWidth: 1, borderColor: t.border, gap: 4,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.dotIdle, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: t.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16 },
  sheetIcon: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.emeraldTint, borderWidth: 1, borderColor: t.emeraldBorder,
  },
  sheetItemTitle: { color: t.textPrimary, fontSize: 15, fontWeight: '700' },
  sheetItemSub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
});