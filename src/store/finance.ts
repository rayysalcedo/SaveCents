// Port of FinanceViewModel.kt — same mock data, same action semantics.
// M2 will swap processChatInput's local stub for the Gemini backend call.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, ActionType, Category, ChatMessage, Goal, Transaction, UserProfile, uid, peso, setCurrencySymbol, setNumberLocale,
} from '../models/types';
import { notifyBudgetCrossings, notifyGoalMilestones } from '../services/notifications';
import { COUNTRIES } from '../data/countries';
import { emailMonthlyReport } from '../services/otp';
import { buildMonthlyReport, matchReportRequest } from '../utils/report';
import { analyzeDocument, analyzeImage, hasTagalog, localParseIntent, parseCentsIntent, parseCentsVoice, transcribeAudio, CentsResult } from '../services/cents';
import { getSpokenState, speakAsCents, stopCentsVoice, CENTS_VOICES, CentsVoiceStyle } from '../services/speech';

export interface FinanceState {
  accounts: Account[];
  categories: Category[];
  goals: Goal[];
  transactions: Transaction[];
  chat: ChatMessage[];
  isThinking: boolean;
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  profile: UserProfile;
  selectedGoalId: string | null;
  themeMode: 'light' | 'dark' | 'system';
  country: string;
  currency: string;
  lastRollover: string; // M5.6: YYYY-MM of the last budget month rollover

  // v4.1 Dashboard: user-chosen order of the Insights carousel cards.
  // Optional: old persisted snapshots predate it (dashboard falls back).
  insightOrder?: string[];
  setInsightOrder: (order: string[]) => void;
  selectGoal: (id: string) => void;
  setThemeMode: (m: 'light' | 'dark' | 'system') => void;
  setCountry: (code: string) => void;
  addAccount: (
    name: string, color?: string, initial?: string,
    opts?: { kind?: 'debit' | 'credit'; creditLimit?: number; billingDay?: number; balance?: number; network?: 'visa' | 'mastercard' | 'none'; currency?: string; nickname?: string },
  ) => void;
  updateAccount: (id: string, patch: Partial<Pick<Account, 'name' | 'color' | 'initial' | 'kind' | 'creditLimit' | 'billingDay' | 'network' | 'currency' | 'nickname'>>) => void;
  reorderAccounts: (fromIndex: number, toIndex: number) => void;
  updateProfile: (name: string, email: string) => void;
  updatePersona: (nickname: string, avatarId: string | null) => void;
  biometricsEnabled: boolean;
  setBiometricsEnabled: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  // M5.9: Cents speaks replies to voice messages aloud (Gemini TTS with a
  // device-voice fallback, services/speech.ts). Profile toggle.
  voiceRepliesEnabled: boolean;
  setVoiceRepliesEnabled: (v: boolean) => void;
  // M5.16: which prebuilt voice speaks (CENTS_VOICES id) and its delivery
  // style. Fixed per conversation - the voice never changes mid-chat.
  centsVoiceName: string;
  setCentsVoiceName: (v: string) => void;
  centsVoiceStyle: CentsVoiceStyle;
  setCentsVoiceStyle: (v: CentsVoiceStyle) => void;
  removeAccount: (id: string) => void;
  setAccountBalance: (id: string, balance: number) => void;
  addBudget: (name: string, limit: number, icon?: string, category?: string, dueDate?: number) => void;
  updateBudget: (id: string, name: string, limit: number, icon: string, category?: string, dueDate?: number) => void;
  removeBudget: (id: string) => void;
  removeGoal: (id: string) => void;
  login: (name: string, email: string) => void;
  logout: () => void;
  replaceAll: (snap: CloudSnapshot) => void;
  resetToDefaults: () => void;
  addGoal: (name: string, target: number, date: string) => void;
  // Session A: goal contributions. Bumps goal.current, optionally debits a
  // source account, never touches budgets. The ONLY caller of
  // notifyGoalMilestones (cloud restores via replaceAll must stay silent).
  addToGoal: (goalId: string, amount: number, accountId?: string) => void;
  // M5.23: the inverse - goal.current down, money back INTO an account so
  // the spendable total balance stays truthful. Withdrawal clamps at what
  // the goal actually holds.
  withdrawFromGoal: (goalId: string, amount: number, accountId?: string) => void;
  // M5 quick actions from the Cents hub — direct logging, no chat round-trip.
  addExpense: (amount: number, categoryName: string, accountId?: string, note?: string) => void;
  addIncome: (amount: number, accountId: string, note?: string) => void;
  // M5.6 truth pass
  updateTransaction: (id: string, patch: { amount?: number; description?: string; categoryId?: string }) => void;
  removeTransaction: (id: string) => void;
  rolloverBudgetsIfNeeded: () => void;
  // M5.22: expense tx ids logged without a source; Cents asked which account
  // paid and the next message may answer. Session-only, never persisted.
  pendingSourceTxIds: string[] | null;
  // M5.24: a goal contribution/withdrawal waiting for its account. Money in
  // the goal already moved; the balance side moves when the user answers.
  pendingGoalMove: { goalId: string; amount: number; direction: 'into' | 'outof' } | null;
  sendChat: (input: string, opts?: { viaVoice?: boolean }) => Promise<void>;
  // M5.12: one-roundtrip voice turn; resolves to the transcript ('' on failure).
  sendVoiceClip: (base64: string, mimeType: string) => Promise<string>;
  sendImage: (base64: string, mimeType: string, mode: 'receipt' | 'price', imageUri?: string) => Promise<void>;
  sendDocument: (part: { base64: string; mimeType: string } | { text: string }, name: string) => Promise<void>;
  confirmAction: (messageId: string, confirm: boolean) => void;
}

const now = Date.now();
const day = 86_400_000;

// YYYY-MM for "which month have budgets last been reset for".
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Shared bookkeeping for edit/delete: the state deltas a transaction caused.
// sign +1 applies the transaction, sign -1 reverses it. Balances and budget
// spent clamp at 0 the same way addExpense always has.
// v4.7: credit cards track money OWED, so flows hit them inverted. Spending
// from a credit card GROWS its balance (owed goes up, credit left goes
// down); income/payments into it shrink what's owed. Debit stays as-is.
function flowBalance(a: Account, isIncome: boolean, amount: number, sign: 1 | -1): number {
  const flow = (isIncome ? amount : -amount) * sign;
  const delta = a.kind === 'credit' ? -flow : flow;
  return Math.max(a.balance + delta, 0);
}

function applyTxEffect(s: { accounts: Account[]; categories: Category[] }, tx: Transaction, sign: 1 | -1) {
  const accounts = tx.accountId
    ? s.accounts.map((a) =>
        a.id === tx.accountId
          ? { ...a, balance: flowBalance(a, tx.isIncome, tx.amount, sign) }
          : a,
      )
    : s.accounts;
  const categories = tx.isIncome || tx.goalId
    ? s.categories
    : s.categories.map((c) =>
        c.name.toLowerCase() === tx.categoryId.toLowerCase()
          ? { ...c, spent: Math.max(c.spent + tx.amount * sign, 0) }
          : c,
      );
  return { accounts, categories };
}

// M5.30: echo filter. If a voice transcript is essentially what Cents JUST
// said out loud, the mic caught the speaker - discard the turn silently
// instead of letting Cents talk to itself.
const normEcho = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function isEchoOfCents(transcript: string): boolean {
  const spoken = normEcho(getSpokenState().text);
  const heard = normEcho(transcript);
  if (!spoken || heard.length < 12) return false;
  return spoken.includes(heard) || heard.includes(spoken);
}

// M5.30: deterministic rescue for the "add money to BPI, I have 5,000 there"
// exchange the brain fumbled (claimed an update it never made). When a
// which-account question is OPEN and the user's answer names an account that
// CANNOT fund the pending amount plus a number, the app itself builds the
// SetAccountBalance ask - no trust in the model required.
function coerceBalanceAnswer(input: string, result: CentsResult, getS: () => FinanceState): CentsResult {
  const pending = getS().pendingGoalMove ?? (getS().pendingSourceTxIds?.length ? true : null);
  if (!pending || result.actions.length > 0) return result;
  if (!/\b(add|added|send|sent|put|deposit|top|topped|update|updated|have|has|meron|may|nilagay|dagdag|nagdagdag)\b/i.test(input)) return result;
  const acct = matchAccount(input, getS().accounts);
  const numMatch = input.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  const amt = numMatch ? parseFloat(numMatch[1]) : 0;
  if (!acct || !(amt > 0)) return result;
  const needed = getS().pendingGoalMove?.amount ?? 0;
  if (needed > 0 && acct.balance >= needed) return result; // could be a funding choice; leave to the brain
  return {
    ...result,
    intent: 'SetAccountBalance',
    accountName: acct.name,
    amount: amt,
    actions: [{ intent: 'SetAccountBalance', amount: amt, categoryName: '', item: acct.name, accountName: acct.name, targetDate: '' }],
  };
}

// M5.11/M5.21: frictionless confirmations. A yes/no in natural phrasing
// ("Yeah, you can do that.", "sige gawin mo na") resolves the latest ask
// DIRECTLY - no button, no model roundtrip. Guard rails: short (max 7
// words), no digits (a "yes but make it 300" belongs to the brain), and a
// message containing BOTH a yes and a no token is ambiguous → brain.
function classifyDecision(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase();
  if (!t || /\d/.test(t) || t.split(/\s+/).length > 7) return null;
  const hasNeg = /\b(no|nope|nah|wag|huwag|hindi|cancel|skip|stop|never ?mind|don'?t)\b/.test(t);
  const hasAff = /^(y(es|ep|up|eah)|oo+|opo|sige|go(ra)?|ok(s|ay)?|sure|tara|tama|correct|right|confirm|please do|go ahead|do it|log it)\b/.test(t);
  // M5.24 ("No, just log it." got CANCELLED): an affirmative command ANYWHERE
  // alongside a negation is mixed signal - the brain decides, not the regex.
  const hasAffAnywhere = /\b(sige|log it|do it|go ahead|proceed|confirm|ituloy|gawin( mo)?( na)?|i-?log( mo)?( na)?)\b/.test(t);
  if (hasAff && !hasNeg) return 'yes';
  if (hasNeg && !hasAff && !hasAffAnywhere) return 'no';
  return null;
}
const soundsFilipino = (t: string) => /\b(oo|opo|sige|tama|tara|gora|wag|huwag|hindi)\b/i.test(t);

// M5.22: fuzzy account matching ("gcash" hits "GCash Wallet", "the bpi one"
// hits "BPI Savings"). Used by executeAction (user named a source up front)
// and by the which-source follow-up answer.
function matchAccount(input: string | undefined, accounts: Account[]): Account | undefined {
  const t = (input ?? '').trim().toLowerCase();
  if (!t) return undefined;
  const exact = accounts.find((a) => a.name.toLowerCase() === t);
  if (exact) return exact;
  return accounts.find((a) => {
    const n = a.name.toLowerCase();
    return t.includes(n) || n.includes(t) || n.split(/\s+/).some((w) => w.length > 2 && t.includes(w));
  });
}

// M5.26: > 0 while resolveLatestBatch is confirming a run of cards.
// Individual confirms hold their which-account question so the batch can
// ask ONE combined question at the end instead of stacking two.
let batchDepth = 0;
let lastAskSignature = '';

// M5.26: the single voice of the which-account follow-up. Composes ONE
// question for whatever is pending (a goal move, orphan expenses, or BOTH -
// the combined case is one answer applied to both sides).
function flushPendingAsk(getS: () => FinanceState, set: Setter) {
  const move = getS().pendingGoalMove;
  const ids = getS().pendingSourceTxIds;
  if (!move && !ids?.length) return;
  const names = getS().accounts.map((a) => a.name).join(', ');
  if (!names) return;
  const signature = `${move ? `${move.goalId}:${move.amount}:${move.direction}` : ''}|${ids?.join(',') ?? ''}`;
  if (signature === lastAskSignature) return; // already asked this exact question
  lastAskSignature = signature;
  // Contribution questions show balances so an empty account is never a
  // surprise (M5.28, the BPI-at-zero incident).
  const namesWithBal = getS().accounts.map((a) => `${a.name} (${peso(a.balance)})`).join(', ');
  const accountChoices = getS().accounts.map((a) => {
    const nick = a.nickname ? ` ${a.nickname}` : '';
    const spendable = a.kind === 'credit' ? Math.max((a.creditLimit ?? 0) - a.balance, 0) : a.balance;
    return { label: `${a.name}${nick} (${peso(spendable)})`, send: `${a.name}${nick}` };
  });
  let q: string;
  if (move && ids?.length) {
    q = 'Which account handled that?';
  } else if (move) {
    q = move.direction === 'into'
      ? `Which account should that ${peso(move.amount)} come from?`
      : `Where should that ${peso(move.amount)} go?`;
  } else {
    q = 'Which one paid for this?';
  }
  pushCents(set, q, accountChoices);
}

// M5.25: every completed goal move gets a ledger transaction: readable in
// Analytics ("Moved to Computer" / "From Computer savings"), moves balances,
// never touches budgets (goalId set → applyTxEffect skips categories).
function pushGoalTx(
  set: Setter,
  goal: { id: string; name: string },
  amount: number,
  direction: 'into' | 'outof',
  accountId: string,
  timestamp?: number,
) {
  const ts = timestamp ?? Date.now();
  set((s) => {
    const next = [
      {
        id: uid(),
        amount,
        description: direction === 'into' ? `Moved to ${goal.name}` : `From ${goal.name} savings`,
        categoryId: 'Savings',
        timestamp: ts,
        isIncome: direction === 'outof',
        accountId,
        goalId: goal.id,
      },
      ...s.transactions,
    ];
    // Keep the ledger newest-first even when a row is backdated.
    next.sort((a, b) => b.timestamp - a.timestamp);
    return { transactions: next };
  });
}

// M5.23: when a goal move doesn't name a source, default to the healthiest
// account and SAY so on the ask card - totals always stay truthful.
const biggestAccount = (accounts: Account[]): Account | undefined =>
  accounts.slice().sort((a, b) => b.balance - a.balance)[0];

// M5.24: attach pending expense txs to an account (deduct + ack). Shared by
// the which-source answer AND by AddAccount confirmation (the "I used a new
// card called GoTyme" flow attaches automatically after creation).
function applySourceToTxs(acct: Account, getS: () => FinanceState, set: Setter): number {
  const ids = getS().pendingSourceTxIds;
  if (!ids?.length) return 0;
  const txs = getS().transactions.filter((tx) => ids.includes(tx.id));
  const total = txs.reduce((a, tx) => a + tx.amount, 0);
  set((s) => ({
    transactions: s.transactions.map((tx) => (ids.includes(tx.id) ? { ...tx, accountId: acct.id } : tx)),
    accounts: s.accounts.map((a) => (a.id === acct.id ? { ...a, balance: flowBalance(a, false, total, 1) } : a)),
    pendingSourceTxIds: null,
  }));
  pushCents(set, `Got it. ${peso(total)} deducted from ${acct.name}.`);
  return total;
}

// M5.24: complete a goal move's account side.
function applyGoalMove(acct: Account, getS: () => FinanceState, set: Setter): boolean {
  const move = getS().pendingGoalMove;
  if (!move) return false;
  const goal = getS().goals.find((g) => g.id === move.goalId);

  // M5.28: contributions were HELD until this answer - fund them for real
  // through addToGoal (goal bump + debit + milestones + ledger row), and
  // refuse to fund from an account that cannot cover it.
  if (move.direction === 'into') {
    if (acct.balance < move.amount) {
      const others = getS().accounts.filter((a) => a.id !== acct.id && a.balance >= move.amount);
      pushCents(set, `${acct.name} only has ${peso(acct.balance)}, not enough for the ${peso(move.amount)}. ${others.length ? `Take it from ${others.map((a) => `${a.name} (${peso(a.balance)})`).join(', ')} instead, or add money to ${acct.name} first?` : `Add money to an account first, then tell me where to take it from.`}`);
      lastAskSignature = `${move.goalId}:${move.amount}:${move.direction}|${getS().pendingSourceTxIds?.join(',') ?? ''}`;
      return true; // question stays open; this reply is the clarification
    }
    set(() => ({ pendingGoalMove: null }));
    useFinance.getState().addToGoal(move.goalId, move.amount, acct.id);
    return true;
  }

  set((s) => ({
    accounts: s.accounts.map((a) =>
      a.id === acct.id ? { ...a, balance: flowBalance(a, true, move.amount, 1) } : a,
    ),
    pendingGoalMove: null,
  }));
  if (goal) {
    // M5.26 (owner: "why did the grocery come before the withdrawal?"):
    // when this withdrawal funds expenses answered in the same breath, its
    // ledger row is backdated to just before them so the story reads in
    // order - withdrawal first, then the spend it paid for.
    const ids = getS().pendingSourceTxIds;
    const funded = ids?.length ? getS().transactions.filter((tx) => ids.includes(tx.id)) : [];
    const ts = funded.length ? Math.min(...funded.map((tx) => tx.timestamp)) - 1000 : undefined;
    pushGoalTx(set, goal, move.amount, 'outof', acct.id, ts);
  }
  pushCents(set, `Got it. Put the ${peso(move.amount)} from ${goal?.name ?? 'your goal'} back into ${acct.name}.`);
  return true;
}

// M5.22/M5.24: the which-account follow-up. When an expense or a goal move
// is waiting for its account, the user's next message (any channel) is
// checked against the account names first. A non-answer LEAVES the question
// open (M5.24: it used to drop it, which broke the new-card flow) - it just
// isn't re-asked; a later account answer still lands.
function assignPendingSource(
  input: string,
  opts: { viaVoice?: boolean } | undefined,
  getS: () => FinanceState,
  set: Setter,
): boolean {
  if (!getS().pendingSourceTxIds?.length && !getS().pendingGoalMove) return false;
  // M5.29 (owner: "I sent money to BPI, I have 5,000 there" got hijacked and
  // re-fired the insufficient message): any message carrying a NUMBER is more
  // than an account answer - the brain handles it (e.g. SetAccountBalance),
  // and the pending move auto-resumes after.
  if (/\d/.test(input)) return false;
  const acct = matchAccount(input, getS().accounts);
  if (!acct) return false; // keep the question open, let the brain handle the message
  const before = getS().chat.length;
  const didGoal = applyGoalMove(acct, getS, set);
  const didTx = applySourceToTxs(acct, getS, set) > 0;
  if (!didGoal && !didTx) return false;
  lastAskSignature = ''; // question answered; the next one may ask fresh
  if (!getS().pendingGoalMove && !getS().pendingSourceTxIds?.length) {
    pushCents(set, soundsFilipino(input) ? 'May iba ka pa bang kailangan?' : 'Anything else you need?');
  }
  set(() => ({ isThinking: false }));
  maybeSpeakReplies(getS(), opts, getS().chat.slice(before), soundsFilipino(input) ? 'fil' : 'en');
  return true;
}

// M5.11/M5.12 shared: resolve a bare yes/no against the newest pending card.
// Returns true when handled (card confirmed or cancelled, ack ensured,
// result spoken for voice turns). Used by sendChat AND sendVoiceClip.
function tryResolvePendingCard(
  word: string,
  opts: { viaVoice?: boolean } | undefined,
  getS: () => FinanceState,
  set: Setter,
): boolean {
  const decision = classifyDecision(word);
  if (!decision) return false;
  return resolveLatestBatch(decision === 'yes', opts, getS, set, soundsFilipino(word) ? 'fil' : 'en');
}

// Executes/cancels the latest ask batch. Called by the word classifier above
// AND by the brain's confirmGranted/confirmDenied flags (M5.21), so ANY
// phrasing of consent lands without a re-ask.
function resolveLatestBatch(
  yes: boolean,
  opts: { viaVoice?: boolean } | undefined,
  getS: () => FinanceState,
  set: Setter,
  lang: 'en' | 'fil',
): boolean {
  // M5.20 (fixes the owner's "Sure. logged EVERYTHING" incident): a yes/no
  // answers ONLY the LATEST ask - the contiguous run of CENTS messages right
  // before the user's reply. Multi-item turns ("cinema 350 and drinks 150")
  // still land together because their cards share that run; stale unhandled
  // cards from earlier turns are untouched (their chat buttons still work).
  const chatNow = getS().chat;
  let bi = chatNow.length - 1;
  while (bi >= 0 && chatNow[bi].sender === 'USER') bi--; // skip the just-appended yes/no
  const batch: ChatMessage[] = [];
  for (; bi >= 0 && chatNow[bi].sender === 'CENTS'; bi--) batch.push(chatNow[bi]);
  const pendingCards = batch.filter((m) => 'handled' in m && !m.handled).reverse();
  if (!pendingCards.length) return false;
  const before = getS().chat.length;
  batchDepth += 1;
  try {
    pendingCards.forEach((c) => getS().confirmAction(c.id, yes));
  } finally {
    batchDepth -= 1;
  }
  if (!getS().chat.slice(before).some((m) => m.sender === 'CENTS')) {
    pushCents(set, yes ? 'Done.' : 'Okay, cancelled that.');
  }
  // M5.19: ask first, coach AFTER. The insight the brain wrote at ask time is
  // delivered now that the user said yes (never on a decline).
  if (yes) {
    const notes = Array.from(new Set(
      pendingCards
        .map((c) => ('coachNote' in c ? (c.coachNote ?? '').trim() : ''))
        .filter(Boolean),
    ));
    if (notes.length) pushCents(set, notes.join(' '));
  }
  // M5.26: ONE follow-up question for the whole batch; when nothing is
  // pending, check out instead - every exchange closes cleanly.
  flushPendingAsk(getS, set);
  if (!getS().pendingGoalMove && !getS().pendingSourceTxIds?.length) {
    pushCents(set, lang === 'fil' ? 'May iba ka pa bang kailangan?' : 'Anything else you need?');
  }
  set(() => ({ isThinking: false }));
  const fresh = getS().chat.slice(before).filter((m) => m.sender === 'CENTS');
  maybeSpeakReplies(getS(), opts, fresh, lang);
  return true;
}

// M5.12 shared: turn a CentsResult into chat replies (multi-step cards or a
// single reply), close the thinking state, and speak for voice turns. The
// exact logic sendChat always had, now also used by sendVoiceClip.
function deliverResult(
  result: CentsResult,
  opts: { viaVoice?: boolean } | undefined,
  getS: () => FinanceState,
  set: Setter,
) {
  // M5.21: the brain recognized a permission grant/refusal for the previous
  // ask (any phrasing) - execute/cancel it, never ask again.
  const granted = result.confirmGranted === true && result.confirmDenied !== true;
  const denied = result.confirmDenied === true && result.confirmGranted !== true;
  if ((granted || denied) && resolveLatestBatch(granted, opts, getS, set, result.lang)) return;

  // Multi-step requests produce one card per action, in order. Categories
  // added earlier in the same batch count as "existing" for later cards
  // (e.g. "add a Groceries budget 9000 and log that receipt there").
  const st = getS();
  if (result.intent !== 'Unknown' && result.actions.length > 1) {
    const replies: ChatMessage[] = [];
    if (result.reply) replies.push({ id: uid(), sender: 'CENTS', type: 'text', text: result.reply });
    const assumed: string[] = [];
    for (const a of result.actions) {
      const sub: CentsResult = {
        ...result,
        intent: a.intent,
        amount: a.amount,
        categoryName: a.categoryName,
        item: a.item || a.categoryName,
        reply: '',
      };
      replies.push(buildReplyFromResult(sub, st, assumed));
      if (a.intent === 'AddCategory' && a.categoryName) assumed.push(a.categoryName);
    }
    set((s2) => ({ chat: [...s2.chat, ...replies], isThinking: false }));
    maybeSpeakReplies(getS(), opts, replies, result.lang, result.speechReply);
    return;
  }

  const reply = buildReplyFromResult(result, st);
  set((s2) => ({ chat: [...s2.chat, reply], isThinking: false }));
  maybeSpeakReplies(getS(), opts, [reply], result.lang, result.speechReply);
}

// M5.9: what Cents says out loud for a batch of reply messages: the plain
// text bubbles plus the question on any action card, in order. Speaking only
// happens for voice-initiated messages (opts.viaVoice) with the Profile
// "Cents voice" toggle on; speakAsCents itself never throws.
function maybeSpeakReplies(
  s: { voiceRepliesEnabled: boolean; centsVoiceName?: string; centsVoiceStyle?: CentsVoiceStyle },
  opts: { viaVoice?: boolean } | undefined,
  replies: ChatMessage[],
  lang: 'en' | 'fil',
  spokenOverride?: string,
) {
  if (!opts?.viaVoice || !(s.voiceRepliesEnabled ?? true)) return;
  // M5.16: prefer the brain's purpose-written spoken version (clean grammar,
  // "250 pesos", conversational); fall back to the chat text, which
  // speakAsCents sanitizes anyway.
  const spoken = (spokenOverride ?? '').trim() || replies
    .filter((m) => m.sender === 'CENTS')
    .map((m) => (m.type === 'text' ? m.text : 'prompt' in m ? m.prompt : ''))
    .filter(Boolean)
    .join(' ');
  if (spoken) speakAsCents(spoken, lang, { voiceName: s.centsVoiceName, style: s.centsVoiceStyle });
}

// The exact shape synced to Firestore (users/{uid}) and persisted locally.
export interface CloudSnapshot {
  accounts: Account[];
  categories: Category[];
  goals: Goal[];
  transactions: Transaction[];
  chat: ChatMessage[];
  profile: UserProfile;
  selectedGoalId: string | null;
  insightOrder?: string[]; // v4.1: optional for old snapshots
  themeMode: 'light' | 'dark' | 'system';
  country: string;
  currency: string;
  biometricsEnabled: boolean;
  notificationsEnabled: boolean;
  voiceRepliesEnabled: boolean;
  centsVoiceName: string;
  centsVoiceStyle: 'english' | 'taglish';
  // M5.6: YYYY-MM key of the last budget month rollover (see
  // rolloverBudgetsIfNeeded). Persisted so a relaunch mid-month is a no-op.
  lastRollover: string;
}

const makeDefaults = (): CloudSnapshot & { isThinking: boolean } => ({
  accounts: [
    { id: uid(), name: 'GCash', balance: 5000 },
    { id: uid(), name: 'BPI', balance: 15000 },
    { id: uid(), name: 'Cash', balance: 2000 },
  ],
  categories: [
    { id: uid(), name: 'Giorno Gas', limit: 1500, spent: 250, icon: 'car' },
    { id: uid(), name: 'Pets', limit: 3000, spent: 800, icon: 'paw' },
    { id: uid(), name: 'Gaming', limit: 1500, spent: 1500, icon: 'game-controller' },
    { id: uid(), name: 'Dining', limit: 4000, spent: 0, icon: 'restaurant' },
  ],
  goals: [{ id: uid(), name: 'Hong Kong Trip', target: 30000, current: 10000, date: 'Nov 2026' }],
  transactions: [
    { id: uid(), amount: 22000, description: 'Salary', categoryId: 'Income', timestamp: now, isIncome: true },
    { id: uid(), amount: 800, description: 'Pet Express', categoryId: 'Pets', timestamp: now, isIncome: false },
    { id: uid(), amount: 250, description: 'Shell Station', categoryId: 'Giorno Gas', timestamp: now - day, isIncome: false },
    { id: uid(), amount: 1500, description: 'Steam Games', categoryId: 'Gaming', timestamp: now - day, isIncome: false },
  ],
  chat: [
    {
      id: uid(), sender: 'CENTS', type: 'text',
      text: "Hi there! I'm Cents. Ask me about your budget, log a transaction, or check if you can afford something.",
    },
  ],
  isThinking: false,
  profile: { name: 'Rayy', email: 'rayysalcedo@gmail.com', isLoggedIn: false },
  selectedGoalId: null,
  insightOrder: ['goal', 'alloc', 'mom', 'topspend'],
  themeMode: 'light' as const, // M5: friendly light/sage is the new default
  country: 'PH',
  currency: '\u20B1',
  biometricsEnabled: true,
  notificationsEnabled: true,
  voiceRepliesEnabled: true,
  centsVoiceName: 'Puck',
  centsVoiceStyle: 'english',
  lastRollover: monthKey(),
});

// Single source of truth for "what gets saved" — used by both the local
// persist middleware and the Firestore sync layer.
export const buildSnapshot = (s: FinanceState): CloudSnapshot => ({
  accounts: s.accounts,
  categories: s.categories,
  goals: s.goals,
  transactions: s.transactions,
  chat: s.chat.slice(-30),
  profile: s.profile,
  selectedGoalId: s.selectedGoalId,
  insightOrder: s.insightOrder ?? ['goal', 'alloc', 'mom', 'topspend'],
  themeMode: s.themeMode,
  country: s.country,
  currency: s.currency,
  biometricsEnabled: s.biometricsEnabled,
  notificationsEnabled: s.notificationsEnabled ?? true,
  voiceRepliesEnabled: s.voiceRepliesEnabled ?? true,
  centsVoiceName: s.centsVoiceName ?? 'Puck',
  centsVoiceStyle: s.centsVoiceStyle ?? 'english',
  lastRollover: s.lastRollover ?? monthKey(),
});

export const useFinance = create<FinanceState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
      pendingSourceTxIds: null,
      pendingGoalMove: null,
  ...makeDefaults(),

  selectGoal: (id) => set({ selectedGoalId: id }),
  setInsightOrder: (order) => set({ insightOrder: order }),
  setThemeMode: (m) => set({ themeMode: m }),

  setCountry: (code) => {
    const c = COUNTRIES[code];
    if (!c) return;
    setCurrencySymbol(c.symbol);
    setNumberLocale(c.locale);
    set({ country: code, currency: c.symbol });
  },

  addAccount: (name, color, initial, opts) => {
    const s = get();
    // v4.8: a user can hold several cards from one bank; only an exact
    // name + nickname duplicate is rejected.
    const nick = (opts?.nickname ?? '').trim().toLowerCase();
    if (s.accounts.some((a) =>
      a.name.toLowerCase() === name.toLowerCase() && (a.nickname ?? '').trim().toLowerCase() === nick,
    )) return;
    set({
      accounts: [...s.accounts, {
        id: uid(), name, balance: Math.max(opts?.balance ?? 0, 0), color, initial,
        kind: opts?.kind ?? 'debit',
        creditLimit: opts?.kind === 'credit' ? Math.max(opts?.creditLimit ?? 0, 0) : undefined,
        billingDay: opts?.kind === 'credit' && opts?.billingDay
          ? Math.min(Math.max(Math.round(opts.billingDay), 1), 31)
          : undefined,
        network: opts?.network,
        currency: opts?.currency,
        nickname: opts?.nickname?.trim() || undefined,
      }],
    });
  },
  updateAccount: (id, patch) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  reorderAccounts: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= s.accounts.length) return s;
      const next = [...s.accounts];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(Math.min(Math.max(toIndex, 0), next.length), 0, moved);
      return { accounts: next };
    }),
  updateProfile: (name, email) => set((s) => ({ profile: { ...s.profile, name, email } })),
  updatePersona: (nickname, avatarId) =>
    set((s) => ({ profile: { ...s.profile, nickname: nickname.trim() || undefined, avatarId: avatarId ?? undefined } })),
  setBiometricsEnabled: (v) => set({ biometricsEnabled: v }),
  setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
  setVoiceRepliesEnabled: (v) => { if (!v) stopCentsVoice(); set({ voiceRepliesEnabled: v }); },
  setCentsVoiceName: (v) => set({ centsVoiceName: CENTS_VOICES.some((c) => c.id === v) ? v : 'Puck' }),
  setCentsVoiceStyle: (v) => set({ centsVoiceStyle: v === 'taglish' ? 'taglish' : 'english' }),
  removeAccount: (id) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),
  setAccountBalance: (id, balance) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, balance } : a)) })),

  addBudget: (name, limit, icon = 'pricetag', category, dueDate) => {
    const s = get();
    if (s.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    set({ categories: [...s.categories, { id: uid(), name, limit, spent: 0, icon, category, dueDate }] });
  },
  updateBudget: (id, name, limit, icon, category, dueDate) =>
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name, limit, icon, category, dueDate } : c)),
    })),
  removeBudget: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),
  removeGoal: (id) =>
    set((s) => ({
      goals: s.goals.filter((g) => g.id !== id),
      selectedGoalId: s.selectedGoalId === id ? null : s.selectedGoalId,
    })),

  login: (name, email) => set((s) => ({ profile: { ...s.profile, name, email, isLoggedIn: true } })),
  logout: () => set((s) => ({ profile: { ...s.profile, isLoggedIn: false } })),

  // Load a cloud snapshot into the store (fresh install / account switch).
  replaceAll: (snap) => {
    setCurrencySymbol(snap.currency);
    set({ ...snap, isThinking: false });
  },
  // Wipe to factory state (different user logs in, or account deletion).
  resetToDefaults: () => {
    const d = makeDefaults();
    setCurrencySymbol(d.currency);
    set(d);
  },

  addGoal: (name, target, date) =>
    set((s) => ({ goals: [...s.goals, { id: uid(), name, target, current: 0, date }] })),

  // Session A: "Add savings" on a goal card. current is NOT capped at target
  // (over-saving is real and the numbers stay honest; the UI caps the percent
  // display). An optional source account is debited with the same clamp-at-0
  // convention as addExpense. Budgets are untouched by design: moving money
  // into a goal is not spending. Mirrors into chat like every other money
  // action so Cents stays the single timeline.
  addToGoal: (goalId, amount, accountId) => {
    if (!(amount > 0)) return;
    const prevGoals = get().goals;
    if (!prevGoals.some((g) => g.id === goalId)) return;
    set((s) => ({
      goals: s.goals.map((g) => (g.id === goalId ? { ...g, current: g.current + amount } : g)),
      accounts: accountId
        ? s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, false, amount, 1) } : a))
        : s.accounts,
    }));
    // Wakes the previously dormant milestone notifications (25/50/75/100).
    notifyGoalMilestones(prevGoals, get().goals, get().notificationsEnabled);
    if (accountId) {
      const g0 = get().goals.find((g) => g.id === goalId);
      if (g0) pushGoalTx(set, g0, amount, 'into', accountId);
    }
    const goal = get().goals.find((g) => g.id === goalId);
    const acct = accountId ? get().accounts.find((a) => a.id === accountId) : undefined;
    if (goal) pushCents(set, `Set aside ${peso(amount)} for ${goal.name}${acct ? ` from ${acct.name}` : ''}. ${peso(goal.current)} of ${peso(goal.target)} saved.`);
  },

  withdrawFromGoal: (goalId, amount, accountId) => {
    if (!(amount > 0)) return;
    const goal = get().goals.find((g) => g.id === goalId);
    if (!goal) return;
    const take = Math.min(amount, goal.current);
    set((s) => ({
      goals: s.goals.map((g) => (g.id === goalId ? { ...g, current: Math.max(g.current - amount, 0) } : g)),
      accounts: accountId
        ? s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, true, take, 1) } : a))
        : s.accounts,
    }));
    const acct = accountId ? get().accounts.find((a) => a.id === accountId) : undefined;
    if (accountId) pushGoalTx(set, goal, take, 'outof', accountId);
    const left = get().goals.find((g) => g.id === goalId)?.current ?? 0;
    pushCents(set, `Took ${peso(take)} out of ${goal.name}${acct ? ` and put it back in ${acct.name}` : ''}. ${peso(left)} left saved.`);
  },

  // M5 hub quick actions. Expense bumps the matching budget's spent and can
  // debit a source; income credits the chosen card/e-wallet. Both mirror into
  // chat so Cents stays the single timeline of what happened.
  addExpense: (amount, categoryName, accountId, note) => {
    const prevCategories = get().categories;
    set((s) => {
      const exists = s.categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase());
      const categories = exists
        ? s.categories.map((c) =>
            c.name.toLowerCase() === categoryName.toLowerCase() ? { ...c, spent: c.spent + amount } : c,
          )
        : [
            ...s.categories,
            { id: uid(), name: categoryName, icon: 'pricetag', spent: amount, limit: Math.ceil((amount * 1.5) / 100) * 100 },
          ];
      return {
        categories,
        accounts: accountId
          ? s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, false, amount, 1) } : a))
          : s.accounts,
        transactions: [
          { id: uid(), amount, description: note?.trim() || categoryName, categoryId: categoryName, timestamp: Date.now(), isIncome: false, accountId },
          ...s.transactions,
        ],
      };
    });
    notifyBudgetCrossings(prevCategories, get().categories, get().notificationsEnabled);
    const acct = accountId ? get().accounts.find((a) => a.id === accountId) : undefined;
    pushCents(set, `Logged ${peso(amount)} under ${categoryName}${acct ? ` from ${acct.name}` : ''}.`);
  },

  addIncome: (amount, accountId, note) => {
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, true, amount, 1) } : a)),
      transactions: [
        { id: uid(), amount, description: note?.trim() || 'Income', categoryId: 'Income', timestamp: Date.now(), isIncome: true, accountId },
        ...s.transactions,
      ],
    }));
    const acct = get().accounts.find((a) => a.id === accountId);
    pushCents(set, `Added ${peso(amount)} to ${acct?.name ?? 'your account'}.`);
  },

  // M5.6: edit a logged transaction. Old effects are reversed, new ones
  // applied, so account balances and budget spent stay consistent.
  updateTransaction: (id, patch) => {
    const prevCategories = get().categories;
    set((s) => {
      const old = s.transactions.find((tx) => tx.id === id);
      if (!old) return s;
      const next: Transaction = {
        ...old,
        amount: patch.amount ?? old.amount,
        description: patch.description?.trim() || old.description,
        // Savings moves keep their category; regular income keeps its too.
        categoryId: old.isIncome || old.goalId ? old.categoryId : (patch.categoryId ?? old.categoryId),
      };
      const reversed = applyTxEffect(s, old, -1);
      const applied = applyTxEffect({ ...s, ...reversed }, next, 1);
      // M5.25: an amount edit on a savings move shifts the goal by the delta.
      const delta = next.amount - old.amount;
      const goals = old.goalId && delta !== 0
        ? s.goals.map((g) =>
            g.id === old.goalId
              ? { ...g, current: Math.max(g.current + (old.isIncome ? -delta : delta), 0) }
              : g,
          )
        : s.goals;
      return {
        ...applied,
        goals,
        transactions: s.transactions.map((tx) => (tx.id === id ? next : tx)),
      };
    });
    notifyBudgetCrossings(prevCategories, get().categories, get().notificationsEnabled);
  },

  // M5.6: delete a logged transaction, reversing its balance/budget effects.
  removeTransaction: (id) => {
    set((s) => {
      const old = s.transactions.find((tx) => tx.id === id);
      if (!old) return s;
      // M5.25: deleting a savings move also reverses the goal side.
      const goals = old.goalId
        ? s.goals.map((g) =>
            g.id === old.goalId
              ? { ...g, current: Math.max(g.current + (old.isIncome ? old.amount : -old.amount), 0) }
              : g,
          )
        : s.goals;
      return {
        ...applyTxEffect(s, old, -1),
        goals,
        transactions: s.transactions.filter((tx) => tx.id !== id),
      };
    });
  },

  // M5.6: budgets reset when the calendar month changes. spent is RECOMPUTED
  // from this month's transactions (not zeroed) so a rollover mid-usage stays
  // truthful, and monthly due dates advance until they land in the current
  // month or later. Idempotent per month via the persisted lastRollover key.
  rolloverBudgetsIfNeeded: () => {
    const key = monthKey();
    const s = get();
    if (s.lastRollover === key) return;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    set({
      lastRollover: key,
      categories: s.categories.map((c) => {
        const spent = s.transactions
          .filter((tx) => !tx.isIncome && tx.timestamp >= monthStart && tx.categoryId.toLowerCase() === c.name.toLowerCase())
          .reduce((a, tx) => a + tx.amount, 0);
        let dueDate = c.dueDate;
        while (dueDate && dueDate < monthStart) {
          const d = new Date(dueDate);
          d.setMonth(d.getMonth() + 1);
          dueDate = d.getTime();
        }
        return { ...c, spent, dueDate };
      }),
    });
  },

  // M2: real Gemini intent parsing via Firebase AI Logic, with the local
  // heuristic as an offline/unconfigured fallback.
  sendChat: async (input, opts) => {
    stopCentsVoice(); // a new message always interrupts a speaking Cents
    set((st) => ({
      chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: input }],
      isThinking: true,
    }));

    // M5.22: if Cents just asked which account paid, an account-name answer
    // stamps and deducts right here (any channel).
    if (assignPendingSource(input, opts, get, set)) return;

    // v5.11/v5.14: "send me my July report" is handled deterministically -
    // shared with the Voice pipeline (handleReportRequest below).
    if (await handleReportRequest(input, get, set, opts)) return;

    // M5.11: "sige" / "yes" / "wag" against a pending card confirms or
    // cancels it right here. Works for voice sessions and typed chat alike,
    // executes instantly, and the result is spoken like any other reply.
    if (tryResolvePendingCard(input, opts, get, set)) return;

    const ctx = buildBrainContext(get());

    let result: CentsResult;
    try {
      result = await parseCentsIntent(input, ctx);
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      console.warn('[Cents brain error]', errMsg);
      result = localParseIntent(input, ctx);
      if (result.intent === 'Unknown' && errMsg === 'cents-overloaded') {
        result.reply = "I'm a bit swamped right now. Give me a few seconds and send that again.";
      }
      if (__DEV__ && result.intent === 'Unknown' && errMsg !== 'cents-overloaded') {
        result.reply += `\n\n[debug, brain error: ${errMsg.slice(0, 160)}]`;
      }
    }
    // M5.29: the app decides the language, not the model - English input can
    // never produce a Filipino reply flag or card.
    if (!hasTagalog(input)) result = { ...result, lang: 'en' };
    result = coerceBalanceAnswer(input, result, get);

    deliverResult(result, opts, get, set);
  },

  // M5.12: a voice turn in ONE model roundtrip. The audio clip goes straight
  // to parseCentsVoice (transcription + intent together); the user bubble is
  // appended once the transcript is known. Returns the transcript for the
  // overlay's YOU caption ('' when nothing usable came back).
  sendVoiceClip: async (base64, mimeType) => {
    stopCentsVoice();
    set({ isThinking: true });

    // FAST PATH (one roundtrip): audio straight to the structured brain.
    let result: CentsResult | null = null;
    let transcript = '';
    let sawOverload = false;
    try {
      result = await parseCentsVoice(base64, mimeType, buildBrainContext(get()));
      transcript = (result.transcript ?? '').trim();
      // M5.30: the mic caught Cents's own voice - drop the turn silently.
      if (transcript && isEchoOfCents(transcript)) {
        set({ isThinking: false });
        return '';
      }
      if (transcript && !hasTagalog(transcript)) result = { ...result, lang: 'en' };
      result = coerceBalanceAnswer(transcript, result, get);
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      sawOverload = errMsg.includes('cents-overloaded');
      console.warn('[Cents voice brain error]', errMsg);
    }

    // FALLBACK (two roundtrips, the M5.8-proven path): some API versions 400
    // the audio-plus-schema combo. Transcribe plainly, then think - slower,
    // but voice keeps working everywhere.
    if (!result || !transcript) {
      try {
        transcript = (await transcribeAudio(base64, mimeType)).trim();
      } catch (e2: any) {
        sawOverload = sawOverload || String(e2?.message ?? e2).includes('cents-overloaded');
        console.warn('[Cents voice transcribe error]', String(e2?.message ?? e2));
        transcript = '';
      }
      if (transcript) {
        set((st) => ({
          chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: transcript }],
        }));
        if (assignPendingSource(transcript, { viaVoice: true }, get, set)) return transcript;
        if (tryResolvePendingCard(transcript, { viaVoice: true }, get, set)) return transcript;
        if (await handleReportRequest(transcript, get, set, { viaVoice: true })) return transcript;
        let r2: CentsResult;
        try {
          r2 = await parseCentsIntent(transcript, buildBrainContext(get()));
        } catch {
          r2 = localParseIntent(transcript, buildBrainContext(get()));
        }
        deliverResult(r2, { viaVoice: true }, get, set);
        return transcript;
      }
      // Both paths came back empty: say so out loud and keep the loop alive.
      pushCents(set, sawOverload
        ? "I'm a bit swamped right now. Give me a few seconds and say that again."
        : 'I could not quite catch that. Say it again?');
      set({ isThinking: false });
      maybeSpeakReplies(get(), { viaVoice: true }, get().chat.slice(-1), 'en');
      return '';
    }

    // Fast path succeeded: the user's words join the timeline like a typed message.
    set((st) => ({
      chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: transcript }],
    }));

    // Which-source answer, then "sige"/"yes": instant, deterministic.
    if (assignPendingSource(transcript, { viaVoice: true }, get, set)) return transcript;
    if (tryResolvePendingCard(transcript, { viaVoice: true }, get, set)) return transcript;
    // "Send me my July report" spoken out loud works exactly like typed.
    if (await handleReportRequest(transcript, get, set, { viaVoice: true })) return transcript;

    deliverResult(result, { viaVoice: true }, get, set);
    return transcript;
  },

  confirmAction: (messageId, confirm) => {
    const s = get();
    const msg = s.chat.find((m) => m.id === messageId);
    if (!msg || !('handled' in msg) || msg.handled) return;

    const txCountBefore = s.transactions.length; // new txs PREPEND

    if (confirm) {
      const prevCategories = s.categories;
      if (msg.type === 'confirmation' || msg.type === 'negotiation') {
        executeAction(msg.action, set);
      } else if (msg.type === 'receiptScan') {
        executeAction({ kind: 'LogTransaction', amount: msg.amount, categoryName: 'Others' }, set);
      } else if (msg.type === 'consultItem') {
        pushCents(set, `Okay, logged the ${msg.item} for ${peso(msg.amount)}. I'll adjust your ${msg.goalName} trajectory.`);
      } else if (msg.type === 'mismatch') {
        executeAction({ kind: 'CreateAndLog', item: msg.item, amount: msg.amount }, set);
      }
      // Chat-confirmed spends should trip the 90 percent alert too.
      notifyBudgetCrossings(prevCategories, get().categories, get().notificationsEnabled);

      // M5.22: an expense that landed with NO source doesn't move any balance
      // - so Cents follows up asking which account paid. Works from every
      // channel (buttons, typed chat, voice, scanner) because they all
      // confirm through here; the next message answers it.
      const after = get().transactions;
      const fresh = after.slice(0, after.length - txCountBefore);
      const orphans = fresh.filter((tx) => !tx.isIncome && !tx.accountId).map((tx) => tx.id);
      if (orphans.length && get().accounts.length) {
        set((st) => ({ pendingSourceTxIds: [...(st.pendingSourceTxIds ?? []), ...orphans] }));
      }
    } else if (msg.type === 'receiptScan') {
      pushCents(set, 'Receipt scan cancelled.');
    }

    set((st) => ({
      chat: st.chat.map((m) =>
        m.id === messageId && 'handled' in m ? { ...m, confirmed: confirm, handled: true } : m,
      ),
    }));
    // M5.26: button confirms (outside a voice/text batch) ask their single
    // follow-up question here; batches ask once at the end instead.
    if (batchDepth === 0) flushPendingAsk(get, set);
  },

  // M4: vision — a photo is just another way to produce a CentsResult, so it
  // flows into the exact same confirmation/negotiation cards as typed chat.
  sendImage: async (base64, mimeType, mode, imageUri) => {
    stopCentsVoice();
    set((st) => ({
      chat: [...st.chat, {
        id: uid(), sender: 'USER', type: 'text',
        text: '', // photo renders bare in the chat; no label
        imageUri,
      }],
      isThinking: true,
    }));

    const ctx = buildBrainContext(get());

    let reply: ChatMessage;
    try {
      const result = await analyzeImage(base64, mimeType, mode, ctx);
      // Coach lead-in first: what Cents saw and figured out, then the action card.
      const analysis = [result.reply, result.details].filter(Boolean).join('\n\n');
      if (analysis) {
        const lead: ChatMessage = { id: uid(), sender: 'CENTS', type: 'text', text: analysis };
        set((st) => ({ chat: [...st.chat, lead] }));
      }
      if (!result.amount) {
        reply = {
          id: uid(), sender: 'CENTS', type: 'text',
          text: analysis
            ? "I couldn't pin down a number from that photo. Tell me the price and I'll take it from there."
            : "I couldn't read that photo clearly. Try a closer, well-lit shot, or just type it (e.g. 'spent 250 on gas').",
        };
      } else {
        reply = buildReplyFromResult(result, get());
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.warn('[Cents vision error]', msg);
      reply = {
        id: uid(), sender: 'CENTS', type: 'text',
        text: msg === 'cents-overloaded'
          ? "I'm getting a lot of requests right now. Give it a few seconds, then retake the shot or just type it (e.g. 'groceries 3670 at Savemore')."
          : "I couldn't analyze that photo right now. Check your connection and try again, or type the expense instead.",
      };
    }
    set((st) => ({ chat: [...st.chat, reply], isThinking: false }));
  },

  // v5.9: uploaded documents. Cents reads the file, lists what it found,
  // and asks what to do; follow-ups run through normal chat intents.
  sendDocument: async (part, name) => {
    stopCentsVoice();
    set((st) => ({
      chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: `Uploaded ${name}` }],
      isThinking: true,
    }));
    const ctx = buildBrainContext(get());
    let reply: ChatMessage;
    try {
      const result = await analyzeDocument(part, name, ctx);
      const analysis = [result.reply, result.details].filter(Boolean).join('\n\n');
      reply = analysis
        ? { id: uid(), sender: 'CENTS', type: 'text', text: analysis }
        : { id: uid(), sender: 'CENTS', type: 'text', text: "I couldn't read anything useful from that file. If it's a statement or receipt, a clear PDF or CSV works best." };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.warn('[Cents document error]', msg);
      reply = {
        id: uid(), sender: 'CENTS', type: 'text',
        text: msg === 'cents-overloaded'
          ? "I'm getting a lot of requests right now. Give it a few seconds and send the file again."
          : "I couldn't analyze that file right now. Check your connection and try again.",
      };
    }
    set((st) => ({ chat: [...st.chat, reply], isThinking: false }));
  },
    }),
    {
      name: 'savecents-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      partialize: (s) => buildSnapshot(s),
      // v2 = the M5 redesign ships light-first: existing installs are switched
      // to the light theme ONCE (users can still pick dark in Profile after).
      // v3 = the M5.5 auth redesign re-asserts light as the default: installs
      // that ended up dark during testing are reset to light ONE more time
      // (the auth switcher and Profile picker still persist choices after).
      // v4 = M5.6: lastRollover added; existing installs start at the current
      // month so their budgets are not retroactively recomputed on upgrade.
      migrate: (persisted, version) => {
        let p = persisted as FinanceState;
        if (version < 3) p = { ...p, themeMode: 'light' as const };
        if (version < 4) p = { ...p, lastRollover: monthKey() };
        return p;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          setCurrencySymbol(state.currency); // resync module-level symbol
          setNumberLocale(COUNTRIES[state.country]?.locale ?? 'en-PH');
          state.setHasHydrated(true);
          state.rolloverBudgetsIfNeeded(); // month may have changed since last open
        }
      },
    },
  ),
);

// M5.5: everything Cents' brain should know per call, including conversation
// memory so follow-ups ("yes", "how about 500?", "what was that item again?")
// resolve naturally.
function buildBrainContext(s: FinanceState) {
  const history = s.chat
    .slice(-12)
    .map((m) => {
      const text =
        m.type === 'text' ? (m.text || (m.imageUri ? 'Shared a photo to scan' : ''))
        : m.type === 'confirmation' || m.type === 'negotiation' ? m.prompt
        : m.type === 'receiptScan' ? `Receipt for ${peso(m.amount)} from ${m.store}`
        : m.type === 'consultItem' ? `Purchase check: ${m.item} at ${peso(m.amount)}`
        : m.type === 'mismatch' ? `${m.item} (${peso(m.amount)}) didn't fit any budget`
        : '';
      return text ? { sender: m.sender, text } : null;
    })
    .filter((x): x is { sender: 'USER' | 'CENTS'; text: string } => !!x);

  // M5.24: surface any open which-account question so the brain treats the
  // next message as its answer instead of redoing the action.
  let openQuestion: string | undefined;
  if (s.pendingSourceTxIds?.length) {
    const total = s.transactions
      .filter((tx) => s.pendingSourceTxIds!.includes(tx.id))
      .reduce((a, tx) => a + tx.amount, 0);
    openQuestion = `Which account paid for the already-logged expense of ${peso(total)}? The app assigns the answer (including a newly added card) itself.`;
  } else if (s.pendingGoalMove) {
    const g = s.goals.find((x) => x.id === s.pendingGoalMove!.goalId);
    openQuestion = s.pendingGoalMove.direction === 'into'
      ? `Which account should the ${peso(s.pendingGoalMove.amount)} set aside for ${g?.name ?? 'the goal'} come from? The app applies the answer itself.`
      : `Where should the ${peso(s.pendingGoalMove.amount)} taken out of ${g?.name ?? 'the goal'} go? The app applies the answer itself.`;
  }

  return {
    categories: s.categories,
    goals: s.goals,
    accounts: s.accounts,
    currency: s.currency,
    nickname: s.profile.nickname || s.profile.name,
    history,
    recentTransactions: s.transactions.slice(0, 8),
    openQuestion,
  };
}

function buildReplyFromResult(result: CentsResult, st2: FinanceState, assumedCategories: string[] = []): ChatMessage {
    const withCoach = (m: ChatMessage): ChatMessage => {
      // M5.19: carry the brain's held-back coaching on confirmable ask cards.
      if ((m.type === 'confirmation' || m.type === 'negotiation') && (result.coachNote ?? '').trim()) {
        return { ...m, coachNote: result.coachNote!.trim() };
      }
      return m;
    };
    const { intent, amount, categoryName, lang } = result;
    const fil = lang === 'fil';
    const item = result.item || categoryName;
    const category = st2.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    // A category being created by an EARLIER card in the same multi-step batch
    // counts as existing, so "add Groceries and log there" reads naturally.
    const assumed = !category && assumedCategories.some((n) => n.toLowerCase() === categoryName.toLowerCase());

    let reply: ChatMessage;
    switch (intent) {
      case 'LogTransaction': {
        if (category || assumed) {
          const name = category?.name ?? categoryName;
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `I-log ang ${peso(amount)} para sa ${item !== name ? `${item} sa ` : ''}${name}?`
              : `Log ${peso(amount)} for ${item !== name ? `${item} under ` : ''}${name}?`,
            action: { kind: 'LogTransaction', amount, categoryName: name, accountName: result.accountName || undefined, item: item !== name ? item : undefined },
            confirmed: false, handled: false, lang,
          };
        } else {
          // Nothing fits — file under Others (auto-created on confirm).
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `Walang budget na bagay sa "${item}" (${peso(amount)}). I-log sa Others?`
              : `"${item}" (${peso(amount)}) doesn't fit your current budgets. Log it under Others?`,
            action: { kind: 'LogToOthers', item, amount, accountName: result.accountName || undefined },
            confirmed: false, handled: false, lang,
          };
        }
        break;
      }
      case 'PrePurchaseCheck': {
        const goal = st2.goals[0];
        // Real affordability math: weekly savings rate from this month's flow.
        const income = st2.transactions.filter((t) => t.isIncome).reduce((a, t) => a + t.amount, 0);
        const spentTotal = st2.categories.reduce((a, c) => a + c.spent, 0);
        const weeklyRate = Math.max((income - spentTotal) / 4.33, 100);
        const delayWeeks = Math.max(1, Math.ceil(amount / weeklyRate));
        const target = category ?? st2.categories[0];
        if (target) {
          const remaining = target.limit - target.spent;
          const after = remaining - amount;
          const budgetLine = fil
            ? (after >= 0
                ? `May ${peso(remaining)} ka pa sa ${target.name}; matitira ${peso(after)}.`
                : `LALAGPAS ito sa ${target.name} budget mo ng ${peso(-after)}.`)
            : (after >= 0
                ? `You have ${peso(remaining)} left in ${target.name}; this leaves ${peso(after)}.`
                : `This OVERSHOOTS your ${target.name} budget by ${peso(-after)}.`);
          const goalLine = goal
            ? (fil
                ? ` Maaantala din ang '${goal.name}' ng ~${delayWeeks} linggo.`
                : ` It also delays '${goal.name}' by about ${delayWeeks} week${delayWeeks === 1 ? '' : 's'}.`)
            : '';
          reply = {
            id: uid(), sender: 'CENTS', type: 'negotiation',
            prompt: `${budgetLine}${goalLine}${fil ? ' Ituloy pa rin?' : ' Proceed?'}`,
            action: { kind: 'NegotiatePurchase', item, amount, categoryName: target.name, accountName: result.accountName || undefined },
            confirmed: false, handled: false, lang,
          };
        } else {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: `You have no budgets yet. Add one in Goals and I can weigh this ${peso(amount)} purchase for you.`,
          };
        }
        break;
      }
      case 'CategoryMismatch':
        reply = { id: uid(), sender: 'CENTS', type: 'mismatch', item, amount, confirmed: false, handled: false };
        break;
      case 'AddCategory':
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: `Add a ${categoryName} budget of ${peso(amount)}/month?`,
          action: { kind: 'AddCategory', name: categoryName, limit: amount },
          confirmed: false, handled: false,
        };
        break;
      case 'RemoveCategory':
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: `Remove the ${categoryName} budget?`,
          action: { kind: 'RemoveCategory', name: categoryName },
          confirmed: false, handled: false,
        };
        break;
      case 'AddIncome': {
        const st = result; // clarity: fields off the result
        const acctBit = st.accountName ? (fil ? ` sa ${st.accountName}` : ` to ${st.accountName}`) : '';
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Idagdag ang ${peso(amount)} na income${acctBit}?`
            : `Add ${peso(amount)} income${acctBit}?`,
          action: { kind: 'AddIncome', amount, accountName: st.accountName || undefined },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'AddGoal': {
        const rawDate = (result.targetDate ?? '').trim();
        const parsedDate = rawDate && !Number.isNaN(Date.parse(rawDate)) ? rawDate : undefined;
        const dateLabel = parsedDate
          ? new Date(parsedDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : '';
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Gumawa ng goal na "${item}" na may ${peso(amount)} target${dateLabel ? ` hanggang ${dateLabel}` : ''}?`
            : `Create a "${item}" goal with a ${peso(amount)} target${dateLabel ? ` by ${dateLabel}` : ''}?`,
          action: { kind: 'AddGoal', name: item, target: amount, date: parsedDate },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'AddToGoal': {
        const goal = st2.goals.find((g) => {
          const n = g.name.toLowerCase(); const t2 = item.toLowerCase();
          return n === t2 || n.includes(t2) || t2.includes(n);
        });
        if (!goal) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: st2.goals.length
              ? `I couldn't find a goal named ${item}. Your goals: ${st2.goals.map((g) => g.name).join(', ')}.`
              : `You don't have any goals yet. Want to create one first?`,
          };
          break;
        }
        // M5.24 (owner): only name a source the USER named; otherwise the
        // follow-up question asks after confirm.
        const src = matchAccount(result.accountName, st2.accounts);
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Maglagay ng ${peso(amount)} sa ${goal.name} goal mo${src ? ` galing sa ${src.name}` : ''}?`
            : `Set aside ${peso(amount)} for your ${goal.name} goal${src ? ` from ${src.name}` : ''}?`,
          action: { kind: 'AddToGoal', goalName: goal.name, amount, accountName: src?.name },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'WithdrawFromGoal': {
        const goal = st2.goals.find((g) => {
          const n = g.name.toLowerCase(); const t2 = item.toLowerCase();
          return n === t2 || n.includes(t2) || t2.includes(n);
        });
        if (!goal) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: st2.goals.length
              ? `I couldn't find a goal named ${item}. Your goals: ${st2.goals.map((g) => g.name).join(', ')}.`
              : `You don't have any goals to withdraw from yet.`,
          };
          break;
        }
        // M5.28: never offer a nonsense withdrawal - validate what's saved.
        if (goal.current <= 0) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: fil
              ? `Wala pang laman ang ${goal.name} goal mo, walang makukuha doon.`
              : `Your ${goal.name} goal has nothing saved yet, so there's nothing to take out.`,
          };
          break;
        }
        const take = Math.min(amount, goal.current);
        const partial = take < amount;
        const src = matchAccount(result.accountName, st2.accounts);
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? partial
              ? `${peso(goal.current)} lang ang naka-ipon sa ${goal.name}. Kunin lahat${src ? ` at ilagay sa ${src.name}` : ''}?`
              : `Kunin ang ${peso(take)} sa ${goal.name} goal mo${src ? ` at ibalik sa ${src.name}` : ''}?`
            : partial
              ? `Only ${peso(goal.current)} is saved in ${goal.name}. Take all of it${src ? `, back into ${src.name}` : ''}?`
              : `Take ${peso(take)} out of your ${goal.name} goal${src ? `, back into ${src.name}` : ''}?`,
          action: { kind: 'WithdrawFromGoal', goalName: goal.name, amount: take, accountName: src?.name },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'SetAccountBalance': {
        const acct = matchAccount(result.accountName || item, st2.accounts);
        if (!acct) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: `I couldn't find that account. Your sources: ${st2.accounts.map((a) => a.name).join(', ')}.`,
          };
          break;
        }
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `I-update ang balanse ng ${acct.name} sa ${peso(amount)}?`
            : `Update ${acct.name}'s balance to ${peso(amount)}?`,
          action: { kind: 'SetAccountBalance', accountName: acct.name, amount },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'AddAccount': {
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Idagdag ang ${item} sa Wallet mo na may ${peso(amount)}?`
            : `Add ${item} to your Wallet with ${peso(amount)}?`,
          action: { kind: 'AddAccount', name: item, initial: amount },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'UpdateBudget':
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: `Update ${categoryName} budget to ${peso(amount)}/month?`,
          action: { kind: 'UpdateBudget', categoryName, newLimit: amount },
          confirmed: false, handled: false,
        };
        break;
      default:
        reply = {
          id: uid(), sender: 'CENTS', type: 'text',
          text: result.reply || "I'm not sure what you meant. Try 'spent 250 on gas'.",
        };
    }
    return withCoach(reply);
}

type Setter = (fn: (s: FinanceState) => Partial<FinanceState>) => void;

// v5.14: the monthly-report flow, shared by typed chat, the composer voice
// note, AND the full Voice mode (sendVoiceClip). Returns true when the
// input was a report request and has been fully handled. Voice turns get
// the confirmations spoken as well as written.
async function handleReportRequest(
  input: string,
  get: () => FinanceState,
  set: Setter,
  opts?: { viaVoice?: boolean },
): Promise<boolean> {
  const reportReq = matchReportRequest(input);
  if (!reportReq) return false;
  const speak = (n = 1) => maybeSpeakReplies(get(), opts, get().chat.slice(-n), 'en');
  const email = get().profile.email?.trim();
  const preparedFor = get().profile.nickname || get().profile.name || 'there';
  if (!email) {
    pushCents(set, "I'd love to email that over, but I don't have an email on file. Add one in Profile and ask me again.");
    set(() => ({ isThinking: false }));
    speak();
    return true;
  }
  try {
    const report = await buildMonthlyReport(get().transactions, reportReq.monthIndex, reportReq.year, preparedFor);
    if (!report) {
      pushCents(set, 'I looked, but there are no transactions logged in that month yet, so there is nothing to report. Log a few and I will happily build it.');
      set(() => ({ isThinking: false }));
      speak();
      return true;
    }
    pushCents(set, `On it. Building your ${report.label} report: ${report.stats.count} transactions, ${peso(report.stats.income)} in, ${peso(report.stats.expenses)} out.`);
    await emailMonthlyReport({
      email,
      monthLabel: report.label,
      preparedFor,
      fileBase: report.fileBase,
      csvBase64: report.csvBase64,
      pdfBase64: report.pdfBase64,
      stats: report.stats,
    });
    pushCents(set, `Sent! Your ${report.label} report is on its way to ${email}, PDF and CSV attached, plus download buttons that work for 7 days. Check your inbox (and spam, just in case).`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    pushCents(set,
      msg === 'report-rate'
        ? "I've sent quite a few reports this hour. Give it a little while and ask me again."
        : "I built the report but couldn't email it right now. You can also export it anytime from Analytics with the share button.");
  }
  set(() => ({ isThinking: false }));
  speak();
  return true;
}

function pushCents(set: Setter, text: string, choices?: { label: string; send: string }[]) {
  set((s) => ({ chat: [...s.chat, { id: uid(), sender: 'CENTS', type: 'text', text, choices }] }));
}

// M5.22: shared source resolution for every expense-creating action. When
// the user named a source, the transaction is stamped with the account and
// the balance moves; otherwise confirmAction follows up with a which-source
// question.
function debitSource(s: { accounts: Account[] }, accountName: string | undefined, amount: number) {
  const acct = matchAccount(accountName, s.accounts);
  return {
    acct,
    accounts: acct
      ? s.accounts.map((a) => (a.id === acct.id ? { ...a, balance: flowBalance(a, false, amount, 1) } : a))
      : s.accounts,
  };
}

function executeAction(action: ActionType, set: Setter) {
  switch (action.kind) {
    case 'LogTransaction': {
      // If the category doesn't exist yet (e.g. the log card of a multi-step
      // batch was confirmed before, or instead of, its AddCategory card),
      // create it on the spot so the log always lands somewhere real.
      let srcName1: string | undefined;
      set((s) => {
        const exists = s.categories.some((c) => c.name.toLowerCase() === action.categoryName.toLowerCase());
        const src = debitSource(s, action.accountName, action.amount);
        srcName1 = src.acct?.name;
        return {
          accounts: src.accounts,
          categories: exists
            ? s.categories.map((c) =>
                c.name.toLowerCase() === action.categoryName.toLowerCase()
                  ? { ...c, spent: c.spent + action.amount } : c,
              )
            : [...s.categories, { id: uid(), name: action.categoryName, limit: action.amount, spent: action.amount, icon: 'pricetag' }],
          transactions: [
            { id: uid(), amount: action.amount, description: action.item?.trim() || action.categoryName, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false, accountId: src.acct?.id },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)}${action.item ? ` for ${action.item}` : ''} under ${action.categoryName}${srcName1 ? ` from ${srcName1}` : ''}.`);
      break;
    }
    case 'NegotiatePurchase':
      set((s) => {
        const src = debitSource(s, action.accountName, action.amount);
        return {
          accounts: src.accounts,
          categories: s.categories.map((c) =>
            c.name.toLowerCase() === action.categoryName.toLowerCase()
              ? { ...c, spent: c.spent + action.amount } : c,
          ),
          transactions: [
            { id: uid(), amount: action.amount, description: action.item, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false, accountId: src.acct?.id },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Done. ${peso(action.amount)} logged to ${action.categoryName}. Keep an eye on that goal!`);
      break;
    case 'AddCategory':
      set((s) => ({
        categories: [...s.categories, { id: uid(), name: action.name, limit: action.limit, spent: 0, icon: 'pricetag' }],
      }));
      pushCents(set, `Added ${action.name} with a ${peso(action.limit)} budget.`);
      break;
    case 'RemoveCategory':
      set((s) => ({ categories: s.categories.filter((c) => c.name.toLowerCase() !== action.name.toLowerCase()) }));
      pushCents(set, `Removed the ${action.name} budget.`);
      break;
    case 'UpdateBudget':
      set((s) => ({
        categories: s.categories.map((c) =>
          c.name.toLowerCase() === action.categoryName.toLowerCase() ? { ...c, limit: action.newLimit } : c,
        ),
      }));
      pushCents(set, `Updated ${action.categoryName} budget to ${peso(action.newLimit)}.`);
      break;
    case 'CreateAndLog':
      set((s) => {
        const src = debitSource(s, action.accountName, action.amount);
        return {
          accounts: src.accounts,
          categories: [...s.categories, { id: uid(), name: action.item, limit: action.amount, spent: action.amount, icon: 'pricetag' }],
          transactions: [
            { id: uid(), amount: action.amount, description: action.item, categoryId: action.item, timestamp: Date.now(), isIncome: false, accountId: src.acct?.id },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Created a new ${action.item} category and logged ${peso(action.amount)}.`);
      break;
    case 'LogToOthers': {
      set((s) => {
        const others = s.categories.find((c) => c.name.toLowerCase() === 'others');
        const categories = others
          ? s.categories.map((c) => (c === others ? { ...c, spent: c.spent + action.amount } : c))
          : [
              ...s.categories,
              {
                id: uid(), name: 'Others', icon: 'pricetag', spent: action.amount,
                // headroom so a fresh Others doesn't instantly read as maxed
                limit: Math.ceil((action.amount * 1.5) / 100) * 100,
              },
            ];
        const src = debitSource(s, action.accountName, action.amount);
        return {
          accounts: src.accounts,
          categories,
          transactions: [
            { id: uid(), amount: action.amount, description: action.item, categoryId: 'Others', timestamp: Date.now(), isIncome: false, accountId: src.acct?.id },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)} for ${action.item} under Others.`);
      break;
    }
    case 'AddIncome': {
      const st = useFinance.getState();
      if (!st.accounts.length) { pushCents(set, 'Add a money source in Wallet first, then I can file income into it.'); break; }
      const acct = matchAccount(action.accountName, st.accounts) ?? st.accounts[0];
      st.addIncome(action.amount, acct.id); // pushes its own ack
      break;
    }
    case 'AddGoal': {
      const st = useFinance.getState();
      if (st.goals.some((g) => g.name.toLowerCase() === action.name.toLowerCase())) {
        pushCents(set, `You already have a goal named ${action.name}.`);
        break;
      }
      // Spoken deadline when given (M5.28); ~4 months default otherwise.
      const d = action.date ?? new Date(Date.now() + 120 * day).toISOString().slice(0, 10);
      st.addGoal(action.name, action.target, d);
      pushCents(set, `Created the ${action.name} goal with a ${peso(action.target)} target${action.date ? ` by ${new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : ''}.`);
      break;
    }
    case 'AddToGoal': {
      const st = useFinance.getState();
      const goal = st.goals.find((g) => {
        const n = g.name.toLowerCase();
        const t = action.goalName.toLowerCase();
        return n === t || n.includes(t) || t.includes(n);
      });
      if (!goal) {
        pushCents(set, st.goals.length
          ? `I couldn't find a goal named ${action.goalName}. Your goals: ${st.goals.map((g) => g.name).join(', ')}.`
          : `You don't have any goals yet. Say something like "create a goal for a new phone, 20,000" first.`);
        break;
      }
      const acct = matchAccount(action.accountName, st.accounts);
      // M5.28 (owner's BPI-at-zero incident): a contribution only happens
      // when a real account can FUND it. Insufficient or unnamed source →
      // the goal is NOT bumped yet; Cents notes the shortfall and asks.
      if (acct && acct.balance >= action.amount) {
        st.addToGoal(goal.id, action.amount, acct.id); // ack + milestones + ledger row
      } else if (st.accounts.length) {
        if (acct) {
          pushCents(set, `${acct.name} only has ${peso(acct.balance)}, not enough for the ${peso(action.amount)}.`);
        }
        set((s2) => ({ pendingGoalMove: { goalId: goal.id, amount: action.amount, direction: 'into' as const }, pendingSourceTxIds: s2.pendingSourceTxIds }));
      } else {
        st.addToGoal(goal.id, action.amount); // no accounts exist at all
      }
      break;
    }
    case 'WithdrawFromGoal': {
      const st = useFinance.getState();
      const goal = st.goals.find((g) => {
        const n = g.name.toLowerCase();
        const t = action.goalName.toLowerCase();
        return n === t || n.includes(t) || t.includes(n);
      });
      if (!goal) {
        pushCents(set, st.goals.length
          ? `I couldn't find a goal named ${action.goalName}. Your goals: ${st.goals.map((g) => g.name).join(', ')}.`
          : `You don't have any goals to withdraw from yet.`);
        break;
      }
      const acct = matchAccount(action.accountName, st.accounts);
      st.withdrawFromGoal(goal.id, action.amount, acct?.id); // pushes its own ack
      if (!acct && st.accounts.length) {
        const take = Math.min(action.amount, goal.current);
        set((s2) => ({ pendingGoalMove: { goalId: goal.id, amount: take, direction: 'outof' as const }, pendingSourceTxIds: s2.pendingSourceTxIds }));
      }
      break;
    }
    case 'SetAccountBalance': {
      const st = useFinance.getState();
      const acct = matchAccount(action.accountName, st.accounts);
      if (!acct) { pushCents(set, `I couldn't find an account named ${action.accountName}.`); break; }
      st.setAccountBalance(acct.id, Math.max(action.amount, 0));
      pushCents(set, `Updated ${acct.name} to ${peso(Math.max(action.amount, 0))}.`);
      // M5.29: money just arrived - resume whatever was waiting on it (the
      // pending goal move or orphan expenses), validated as usual.
      const fresh = useFinance.getState().accounts.find((a) => a.id === acct.id);
      if (fresh) {
        applyGoalMove(fresh, useFinance.getState, set);
        applySourceToTxs(fresh, useFinance.getState, set);
      }
      break;
    }
    case 'AddAccount': {
      const st = useFinance.getState();
      if (st.accounts.some((a) => a.name.toLowerCase() === action.name.toLowerCase())) {
        pushCents(set, `${action.name} is already in your Wallet.`);
        break;
      }
      const monogram = action.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      set((s) => ({
        accounts: [...s.accounts, { id: uid(), name: action.name, balance: Math.max(action.initial, 0), initial: monogram }],
      }));
      pushCents(set, `Added ${action.name} to your Wallet with ${peso(Math.max(action.initial, 0))}.`);
      // M5.24: if this card was the ANSWER to "which one paid for this" (or a
      // goal-move source question), attach it now - never re-log, never drop.
      const created = useFinance.getState().accounts.find((a) => a.name.toLowerCase() === action.name.toLowerCase());
      if (created) {
        applyGoalMove(created, useFinance.getState, set);
        applySourceToTxs(created, useFinance.getState, set);
      }
      break;
    }
    case 'LogToUnassigned':
      set((s) => {
        const src = debitSource(s, action.accountName, action.amount);
        return {
          accounts: src.accounts,
          transactions: [
            { id: uid(), amount: action.amount, description: action.item, categoryId: 'Unassigned', timestamp: Date.now(), isIncome: false, accountId: src.acct?.id },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)} for ${action.item} as unassigned.`);
      break;
  }
}