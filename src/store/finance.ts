// Port of FinanceViewModel.kt — same mock data, same action semantics.
// M2 will swap processChatInput's local stub for the Gemini backend call.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, ActionType, Category, ChatMessage, Goal, Lend, SaveCadence, SplitBill, Transaction, UserProfile, uid, peso, setCurrencySymbol, setNumberLocale,
} from '../models/types';
import { notifyAutoPay, notifyBudgetCrossings, notifyGoalMilestones } from '../services/notifications';
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
    opts?: { kind?: 'debit' | 'credit'; creditLimit?: number; billingDay?: number; dueDay?: number; balance?: number; network?: 'visa' | 'mastercard' | 'none'; currency?: string; nickname?: string },
  ) => void;
  updateAccount: (id: string, patch: Partial<Pick<Account, 'name' | 'color' | 'initial' | 'kind' | 'creditLimit' | 'billingDay' | 'dueDay' | 'network' | 'currency' | 'nickname'>>) => void;
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
  addBudget: (name: string, limit: number, icon?: string, category?: string, dueDate?: number, remind?: boolean, dueType?: 'once' | 'monthly', dueDay?: number, autoPay?: boolean, autoPayAccountId?: string) => void;
  updateBudget: (id: string, name: string, limit: number, icon: string, category?: string, dueDate?: number, remind?: boolean, dueType?: 'once' | 'monthly', dueDay?: number, autoPay?: boolean, autoPayAccountId?: string) => void;
  // Planner v2.3: settle due monthly auto-pay budgets. Idempotent per month,
  // safe to call on every app open and after income lands.
  runAutoPayIfDue: () => void;
  runCreditStatementsIfDue: () => void;
  // v5.43: Cents arms the Transactions tab's filters; the tab consumes and
  // clears this on focus. Read-only, transient.
  ledgerFilter: { query?: string; categoryName?: string } | null;
  // v5.48: move money between accounts without logging income or expense.
  addTransfer: (fromId: string, toId: string, amount: number, note?: string) => void;
  // v5.48: dashboard "needs attention" deep-link - the planner consumes
  // this, opens Budgets on the right segment, and briefly highlights the
  // item. Transient, never persisted meaningfully.
  plannerFocus: { catId: string; seg: 'bills' | 'spending' } | null;
  setPlannerFocus: (f: { catId: string; seg: 'bills' | 'spending' } | null) => void;
  setLedgerFilter: (f: { query?: string; categoryName?: string } | null) => void;
  removeBudget: (id: string) => void;
  removeGoal: (id: string) => void;
  login: (name: string, email: string) => void;
  logout: () => void;
  replaceAll: (snap: CloudSnapshot) => void;
  resetToDefaults: () => void;
  addGoal: (name: string, target: number, date: string, deadline?: number, cadence?: SaveCadence) => void;
  // Planner v3.2: split the bill, with real money flow.
  splits: SplitBill[];
  addSplit: (input: SplitInput) => void;
  updateSplit: (id: string, input: SplitInput) => void;
  removeSplit: (id: string) => void;
  // Me mode: person repaid, money lands in accountId. Legacy/other mode:
  // pass no accountId and it is a plain tick.
  markSplitPersonPaid: (splitId: string, personId: string, accountId?: string) => void;
  unmarkSplitPersonPaid: (splitId: string, personId: string) => void;
  // Other mode: the user pays their own share from accountId.
  paySplitMyShare: (splitId: string, accountId: string) => void;
  unpaySplitMyShare: (splitId: string) => void;
  setSplitRemote: (splitId: string, token: string) => void;
  applyRemoteSplitState: (splitId: string, remote: { people: { id: string; paid: boolean }[]; myPaid: boolean }) => void;
  markSplitEmailed: (splitId: string, personId: string) => void;
  // Planner v4: Lend.
  lends: Lend[];
  addLend: (input: LendInput) => void;
  updateLend: (id: string, input: LendInput) => void;
  removeLend: (id: string) => void;
  // Repaid money lands in accountId; pass none for a plain track only tick.
  markLendRepaid: (id: string, accountId?: string) => void;
  unmarkLendRepaid: (id: string) => void;
  markLendStageSent: (id: string, stage: number) => void;
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

// Planner v3.2: what the UI hands the store to create or edit a split. The
// UI generates ids up front so the worker's manage link can reference them.
export interface SplitInput {
  id: string;
  title: string;
  total: number;
  headcount: number;
  mode: 'me' | 'other';
  payerName: string;
  payerEmail?: string;
  payerAccountId?: string;
  includeMe?: boolean;
  // Planner v5: 'custom' = each person owes their typed amount (share below);
  // absent/'even' divides the total equally, exactly the pre-v5 behavior.
  splitKind?: 'even' | 'custom';
  myShareAmount?: number; // other mode custom: the user's own typed share
  people: { id: string; name: string; email?: string; share?: number }[];
}

export interface LendInput {
  id: string;
  name: string;
  email?: string;
  amount: number;
  dueDate: number;
  note?: string;
  accountId?: string; // absent = track only, no balance change
  consent?: boolean;
}

// Reverse one transaction: undo its balance effect and drop it. Split
// transactions never touch categories or goals, so this stays lean.
function reverseSplitTx(s: { accounts: Account[]; transactions: Transaction[] }, txId: string | undefined) {
  if (!txId) return { accounts: s.accounts, transactions: s.transactions };
  const old = s.transactions.find((t) => t.id === txId);
  if (!old) return { accounts: s.accounts, transactions: s.transactions };
  const accounts = old.accountId
    ? s.accounts.map((a) => (a.id === old.accountId ? { ...a, balance: flowBalance(a, old.isIncome, old.amount, -1) } : a))
    : s.accounts;
  return { accounts, transactions: s.transactions.filter((t) => t.id !== txId) };
}

function applyTxEffect(s: { accounts: Account[]; categories: Category[] }, tx: Transaction, sign: 1 | -1) {
  // v5.48 TRANSFERS: two balance legs, no income/expense anywhere. The
  // source leg behaves like an outflow (debit down / credit owed up - a
  // cash advance), the destination leg like an inflow (debit up / credit
  // owed DOWN - a transfer to a card IS a payment), and when the
  // destination is a credit card its linked bill budget's paid amount moves
  // too, so the bill and the card never tell different stories. sign -1
  // reverses all of it on edit/delete.
  if (tx.transferToId) {
    const accounts = s.accounts.map((a) => {
      if (a.id === tx.accountId) return { ...a, balance: flowBalance(a, false, tx.amount, sign) };
      if (a.id === tx.transferToId) return { ...a, balance: flowBalance(a, true, tx.amount, sign) };
      return a;
    });
    const destCredit = s.accounts.find((a) => a.id === tx.transferToId && a.kind === 'credit');
    const categories = destCredit
      ? s.categories.map((c) =>
          c.creditAccountId === destCredit.id
            ? { ...c, spent: Math.max(c.spent + tx.amount * sign, 0) }
            : c,
        )
      : s.categories;
    return { accounts, categories };
  }
  let accounts = tx.accountId
    ? s.accounts.map((a) =>
        a.id === tx.accountId
          ? { ...a, balance: flowBalance(a, tx.isIncome, tx.amount, sign) }
          : a,
      )
    : s.accounts;
  accounts = applyCreditBillPayment({ accounts, categories: s.categories }, tx, sign);
  const categories = tx.isIncome || tx.goalId
    ? s.categories
    : s.categories.map((c) =>
        c.name.toLowerCase() === tx.categoryId.toLowerCase()
          ? { ...c, spent: Math.max(c.spent + tx.amount * sign, 0) }
          : c,
      );
  return { accounts, categories };
}

// Wallet v5 (owner decision): paying a credit card's bill budget is a REAL
// payment. An expense filed under a budget carrying creditAccountId (from a
// different source, or no source at all - cash outside the app still pays
// the bank) reduces that card's owed balance by the same amount, so the
// budget and the card never tell different stories. sign -1 (edit/delete
// reversal) puts the owed amount back. Spending ON the card itself
// (accountId = the card) is normal card spending, never a payment.
function applyCreditBillPayment(
  s: { accounts: Account[]; categories: Category[] },
  tx: { isIncome: boolean; goalId?: string; categoryId: string; accountId?: string; amount: number },
  sign: 1 | -1,
): Account[] {
  if (tx.isIncome || tx.goalId) return s.accounts;
  const cat = s.categories.find((c) => c.name.toLowerCase() === tx.categoryId.toLowerCase());
  if (!cat?.creditAccountId || cat.creditAccountId === tx.accountId) return s.accounts;
  return s.accounts.map((a) =>
    a.id === cat.creditAccountId ? { ...a, balance: Math.max(a.balance - tx.amount * sign, 0) } : a,
  );
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
// M5.34: resolve "the jacket expense" / "yesterday's 250 coffee" to the
// NEWEST matching ledger row. Matched by name (description or category,
// containment both ways) and, when the user stated one, the exact amount.
// Savings moves are excluded - those are edited through the goal intents so
// the goal side always reverses with them.
function findTxForEdit(st2: { transactions: Transaction[] }, item: string, amount: number): Transaction | undefined {
  const q = item.trim().toLowerCase();
  return st2.transactions.find((tx) => {
    if (tx.goalId) return false;
    const desc = tx.description.toLowerCase();
    const cat = tx.categoryId.toLowerCase();
    const nameHit = !q || desc.includes(q) || q.includes(desc) || cat === q || cat.includes(q);
    const amtHit = !(amount > 0) || Math.abs(tx.amount - amount) < 0.005;
    return nameHit && amtHit;
  });
}

// Next occurrence of a monthly due day: this month if it hasn't passed
// (12h grace), else next month, clamped to short months like rollover.
function nextMonthlyDueTs(day: number): number {
  const build = (y: number, m: number) => {
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(day, last));
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const base = new Date();
  let d = build(base.getFullYear(), base.getMonth());
  if (d.getTime() < Date.now() - 12 * 3600 * 1000) d = build(base.getFullYear(), base.getMonth() + 1);
  return d.getTime();
}

function ordinalDay(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`;
}

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

  // Multi-step requests: one SUMMARY card for the whole plan (owner request,
  // M5.34) - Cents lists everything it's about to do and ONE yes does it all.
  // Each action still goes through buildReplyFromResult first, because that's
  // where category fitting, goal validation and tx resolution happen; its
  // confirmable cards are folded into the summary, while its plain-text
  // replies (a goal that doesn't exist, an empty withdrawal) surface as-is.
  const st = getS();
  if (result.intent !== 'Unknown' && result.actions.length > 1) {
    const replies: ChatMessage[] = [];
    if (result.reply) replies.push({ id: uid(), sender: 'CENTS', type: 'text', text: result.reply });
    const assumed: string[] = [];
    const built: ChatMessage[] = [];
    for (const a of result.actions) {
      const sub: CentsResult = {
        ...result,
        intent: a.intent,
        amount: a.amount,
        categoryName: a.categoryName,
        item: a.item || a.categoryName,
        // M5.34 fix: per-action fields used to be DROPPED in favor of the
        // top-level ones, so "log the speaker from GoTyme and the fare from
        // GCash" collapsed both onto one source. Per-action wins now.
        accountName: a.accountName || result.accountName,
        targetDate: a.targetDate || result.targetDate,
        toAccountName: a.toAccountName || result.toAccountName,
        dueDay: a.dueDay || result.dueDay,
        reply: '',
      };
      built.push(buildReplyFromResult(sub, st, assumed));
      if (a.intent === 'AddCategory' && a.categoryName) assumed.push(a.categoryName);
    }
    const confirmable = built.filter((m) => m.type === 'confirmation' || m.type === 'negotiation');
    const others = built.filter((m) => !(m.type === 'confirmation' || m.type === 'negotiation'));
    replies.push(...others);
    if (confirmable.length >= 2) {
      const fil = result.lang === 'fil';
      const steps = confirmable.map((m) => ('prompt' in m ? m.prompt.trim().replace(/\?+\s*$/, '') : '')).filter(Boolean);
      const notes = Array.from(new Set(
        confirmable.map((m) => ('coachNote' in m ? (m.coachNote ?? '').trim() : '')).filter(Boolean),
      ));
      replies.push({
        id: uid(), sender: 'CENTS', type: 'batchConfirmation',
        prompt: fil ? 'Ito ang plano. Gawin ko na lahat?' : "Here's the plan. Do all of it?",
        steps,
        actions: confirmable.map((m) => ('action' in m ? m.action : null)).filter(Boolean) as ActionType[],
        confirmed: false, handled: false, lang: result.lang,
        coachNote: notes.length ? notes.join(' ') : undefined,
      });
    } else {
      replies.push(...confirmable);
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
  // Planner v3: split bills. Optional so pre-v3 cloud snapshots load clean.
  splits?: SplitBill[];
  // Planner v4: lends. Optional for the same reason.
  lends?: Lend[];
}

const makeDefaults = (): CloudSnapshot & { isThinking: boolean; splits: SplitBill[]; lends: Lend[] } => ({
  // v5.49 (owner, field report): NEW USERS START FROM ZERO. The demo seed
  // (sample accounts, budgets, the Hong Kong goal, four transactions) dated
  // from the first dev builds and leaked into every fresh signup. Existing
  // users are untouched - persisted state always wins over these defaults.
  accounts: [],
  categories: [],
  goals: [],
  transactions: [],
  chat: [
    {
      id: uid(), sender: 'CENTS', type: 'text',
      text: "Hi there! I'm Cents. Ask me about your budget, log a transaction, or check if you can afford something.",
    },
  ],
  isThinking: false,
  splits: [],
  lends: [],
  profile: { name: '', email: '', isLoggedIn: false },
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
  splits: s.splits ?? [],
  lends: s.lends ?? [],
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
        dueDay: opts?.kind === 'credit' && opts?.dueDay
          ? Math.min(Math.max(Math.round(opts.dueDay), 1), 31)
          : undefined,
        network: opts?.network,
        currency: opts?.currency,
        nickname: opts?.nickname?.trim() || undefined,
      }],
    });
    get().runCreditStatementsIfDue(); // a new card's billing day may already be past
  },
  updateAccount: (id, patch) => {
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    // v5.35: billing/due day edits take effect NOW (statement cut or due-date
    // repair), instead of waiting for the next Home visit.
    get().runCreditStatementsIfDue();
  },
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

  addBudget: (name, limit, icon = 'pricetag', category, dueDate, remind, dueType, dueDay, autoPay, autoPayAccountId) => {
    const s = get();
    if (s.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    set({ categories: [...s.categories, { id: uid(), name, limit, spent: 0, icon, category, dueDate, dueType, dueDay, autoPay, autoPayAccountId, ...(remind === false ? { remind } : {}) }] });
    get().runAutoPayIfDue();
  },
  updateBudget: (id, name, limit, icon, category, dueDate, remind, dueType, dueDay, autoPay, autoPayAccountId) => {
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name, limit, icon, category, dueDate, dueType, dueDay, autoPay, autoPayAccountId, ...(remind === undefined ? {} : { remind }) } : c)),
    }));
    get().runAutoPayIfDue();
  },
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
    set({ ...snap, splits: snap.splits ?? [], lends: snap.lends ?? [], isThinking: false });
  },
  // Wipe to factory state (different user logs in, or account deletion).
  resetToDefaults: () => {
    const d = makeDefaults();
    setCurrencySymbol(d.currency);
    set(d);
  },

  addGoal: (name, target, date, deadline, cadence) =>
    set((s) => ({ goals: [...s.goals, { id: uid(), name, target, current: 0, date, ...(deadline ? { deadline } : {}), ...(cadence ? { cadence } : {}) }] })),

  // Planner v3.2: split the bill with real money flow. Equal shares to the
  // centavo; rounding dust stays with the payer, the classic house rule.
  // Me mode logs the full bill as an expense right away, then each repayment
  // as income when the user confirms it. Other mode logs only the user's own
  // share, when they pay it. Split transactions live under the 'Split bills'
  // name on purpose WITHOUT creating a budget, so the budget list stays clean.
  addSplit: (input) =>
    set((s) => {
      const evenShare = Math.round((input.total / input.headcount) * 100) / 100;
      const custom = input.splitKind === 'custom';
      let accounts = s.accounts;
      let transactions = s.transactions;
      let expenseTxId: string | undefined;
      if (input.mode === 'me' && input.payerAccountId) {
        expenseTxId = uid();
        accounts = accounts.map((a) =>
          a.id === input.payerAccountId ? { ...a, balance: flowBalance(a, false, input.total, 1) } : a,
        );
        transactions = [
          { id: expenseTxId, amount: input.total, description: `Split: ${input.title}`, categoryId: 'Split bills', timestamp: Date.now(), isIncome: false, accountId: input.payerAccountId },
          ...transactions,
        ];
      }
      const bill: SplitBill = {
        id: input.id,
        title: input.title,
        total: input.total,
        payerName: input.payerName,
        headcount: input.headcount,
        createdAt: Date.now(),
        mode: input.mode,
        payerEmail: input.mode === 'other' ? input.payerEmail?.trim() || undefined : undefined,
        payerAccountId: input.mode === 'me' ? input.payerAccountId : undefined,
        expenseTxId,
        splitKind: input.splitKind,
        myShareAmount: input.mode === 'other' && input.includeMe && custom ? input.myShareAmount : undefined,
        myShare: input.mode === 'other' && input.includeMe ? { included: true, paid: false } : undefined,
        people: input.people.map((p) => ({
          id: p.id, name: p.name, email: p.email?.trim() || undefined,
          share: custom ? (p.share ?? evenShare) : evenShare, paid: false,
        })),
      };
      return { splits: [bill, ...s.splits], accounts, transactions };
    }),

  // Edit keeps what is true: paid ticks and logged repayments survive by
  // person id. The original expense is re-logged fresh so total or account
  // changes always net out right. People edited away get their repayment
  // income reversed, since that money claim no longer exists.
  updateSplit: (id, input) =>
    set((s) => {
      const old = s.splits.find((b) => b.id === id);
      if (!old) return s;
      let { accounts, transactions } = { accounts: s.accounts, transactions: s.transactions };
      // Reverse the old logged expense (me mode) and my-share expense if the
      // shape changed; re-log below from the new truth.
      ({ accounts, transactions } = reverseSplitTx({ accounts, transactions }, old.expenseTxId));
      const keptIds = new Set(input.people.map((p) => p.id));
      for (const p of old.people) {
        if (!keptIds.has(p.id)) ({ accounts, transactions } = reverseSplitTx({ accounts, transactions }, p.txId));
      }
      const dropMyShare = !(input.mode === 'other' && input.includeMe);
      if (dropMyShare && old.myShare?.txId) {
        ({ accounts, transactions } = reverseSplitTx({ accounts, transactions }, old.myShare.txId));
      }
      const evenShare = Math.round((input.total / input.headcount) * 100) / 100;
      const custom = input.splitKind === 'custom';
      let expenseTxId: string | undefined;
      if (input.mode === 'me' && input.payerAccountId) {
        expenseTxId = uid();
        accounts = accounts.map((a) =>
          a.id === input.payerAccountId ? { ...a, balance: flowBalance(a, false, input.total, 1) } : a,
        );
        transactions = [
          { id: expenseTxId, amount: input.total, description: `Split: ${input.title}`, categoryId: 'Split bills', timestamp: Date.now(), isIncome: false, accountId: input.payerAccountId },
          ...transactions,
        ];
      }
      const oldPeople = new Map(old.people.map((p) => [p.id, p]));
      const bill: SplitBill = {
        ...old,
        title: input.title,
        total: input.total,
        payerName: input.payerName,
        headcount: input.headcount,
        mode: input.mode,
        payerEmail: input.mode === 'other' ? input.payerEmail?.trim() || undefined : undefined,
        payerAccountId: input.mode === 'me' ? input.payerAccountId : undefined,
        expenseTxId,
        splitKind: input.splitKind,
        myShareAmount: input.mode === 'other' && input.includeMe && custom ? input.myShareAmount : undefined,
        myShare: input.mode === 'other' && input.includeMe
          ? { included: true, paid: old.myShare?.paid ?? false, txId: old.myShare?.txId }
          : undefined,
        remoteToken: input.mode === 'other' ? old.remoteToken : undefined,
        people: input.people.map((p) => {
          const prev = oldPeople.get(p.id);
          return {
            id: p.id,
            name: p.name,
            email: p.email?.trim() || undefined,
            share: custom ? (p.share ?? evenShare) : evenShare,
            paid: prev?.paid ?? false,
            txId: prev?.txId,
            emailedAt: prev?.emailedAt,
          };
        }),
      };
      return { splits: s.splits.map((b) => (b.id === id ? bill : b)), accounts, transactions };
    }),

  // Deleting a split keeps its logged transactions: the money really moved.
  removeSplit: (id) => set((s) => ({ splits: s.splits.filter((b) => b.id !== id) })),

  markSplitPersonPaid: (splitId, personId, accountId) =>
    set((s) => {
      const bill = s.splits.find((b) => b.id === splitId);
      const person = bill?.people.find((p) => p.id === personId);
      if (!bill || !person || person.paid) return s;
      let accounts = s.accounts;
      let transactions = s.transactions;
      let txId: string | undefined;
      if (accountId) {
        txId = uid();
        accounts = accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, true, person.share, 1) } : a));
        transactions = [
          { id: txId, amount: person.share, description: `Split repaid: ${person.name} · ${bill.title}`, categoryId: 'Split bills', timestamp: Date.now(), isIncome: true, accountId },
          ...transactions,
        ];
      }
      return {
        accounts,
        transactions,
        splits: s.splits.map((b) =>
          b.id === splitId ? { ...b, people: b.people.map((p) => (p.id === personId ? { ...p, paid: true, txId } : p)) } : b,
        ),
      };
    }),

  unmarkSplitPersonPaid: (splitId, personId) =>
    set((s) => {
      const bill = s.splits.find((b) => b.id === splitId);
      const person = bill?.people.find((p) => p.id === personId);
      if (!bill || !person) return s;
      const { accounts, transactions } = reverseSplitTx(s, person.txId);
      return {
        accounts,
        transactions,
        splits: s.splits.map((b) =>
          b.id === splitId ? { ...b, people: b.people.map((p) => (p.id === personId ? { ...p, paid: false, txId: undefined } : p)) } : b,
        ),
      };
    }),

  paySplitMyShare: (splitId, accountId) =>
    set((s) => {
      const bill = s.splits.find((b) => b.id === splitId);
      if (!bill?.myShare || bill.myShare.paid) return s;
      // Planner v5: the user's own share is stored explicitly on custom
      // splits; even splits keep the old derivations.
      const share = bill.myShareAmount ?? bill.people[0]?.share ?? Math.round((bill.total / bill.headcount) * 100) / 100;
      const txId = uid();
      const accounts = s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, false, share, 1) } : a));
      const transactions: Transaction[] = [
        { id: txId, amount: share, description: `My share: ${bill.title}`, categoryId: 'Split bills', timestamp: Date.now(), isIncome: false, accountId },
        ...s.transactions,
      ];
      return {
        accounts,
        transactions,
        splits: s.splits.map((b) => (b.id === splitId ? { ...b, myShare: { ...b.myShare!, paid: true, txId } } : b)),
      };
    }),

  unpaySplitMyShare: (splitId) =>
    set((s) => {
      const bill = s.splits.find((b) => b.id === splitId);
      if (!bill?.myShare) return s;
      const { accounts, transactions } = reverseSplitTx(s, bill.myShare.txId);
      return {
        accounts,
        transactions,
        splits: s.splits.map((b) => (b.id === splitId ? { ...b, myShare: { ...b.myShare!, paid: false, txId: undefined } } : b)),
      };
    }),

  setSplitRemote: (splitId, token) =>
    set((s) => ({ splits: s.splits.map((b) => (b.id === splitId ? { ...b, remoteToken: token } : b)) })),

  // Pull from the payer's manage page. Their ticks win for other people;
  // for the user's own share a logged expense in the app is the stronger
  // truth and never gets unset from outside.
  applyRemoteSplitState: (splitId, remote) =>
    set((s) => ({
      splits: s.splits.map((b) => {
        if (b.id !== splitId) return b;
        const remoteById = new Map(remote.people.map((p) => [p.id, p.paid]));
        return {
          ...b,
          people: b.people.map((p) => (remoteById.has(p.id) ? { ...p, paid: remoteById.get(p.id)! } : p)),
          myShare: b.myShare
            ? { ...b.myShare, paid: b.myShare.txId ? b.myShare.paid : (b.myShare.paid || remote.myPaid) }
            : b.myShare,
        };
      }),
    })),

  markSplitEmailed: (splitId, personId) =>
    set((s) => ({
      splits: s.splits.map((b) =>
        b.id === splitId ? { ...b, people: b.people.map((p) => (p.id === personId ? { ...p, emailedAt: Date.now() } : p)) } : b,
      ),
    })),

  // Planner v4: Lend. Lending from an account logs the money OUT right away
  // ("Lent: Marco"), repayment logs it back IN ("Lend repaid: Marco"), both
  // under the Split bills style categoryless name 'Lending' so budgets stay
  // untouched. Track only skips the balance side entirely.
  addLend: (input) =>
    set((s) => {
      let accounts = s.accounts;
      let transactions = s.transactions;
      let expenseTxId: string | undefined;
      if (input.accountId) {
        expenseTxId = uid();
        accounts = accounts.map((a) => (a.id === input.accountId ? { ...a, balance: flowBalance(a, false, input.amount, 1) } : a));
        transactions = [
          { id: expenseTxId, amount: input.amount, description: `Lent: ${input.name}`, categoryId: 'Lending', timestamp: Date.now(), isIncome: false, accountId: input.accountId },
          ...transactions,
        ];
      }
      const lend: Lend = {
        id: input.id,
        name: input.name,
        email: input.email?.trim() || undefined,
        amount: input.amount,
        dueDate: input.dueDate,
        note: input.note?.trim() || undefined,
        createdAt: Date.now(),
        accountId: input.accountId,
        expenseTxId,
        repaid: false,
        consent: input.consent,
        sentStages: [],
      };
      return { lends: [lend, ...s.lends], accounts, transactions };
    }),

  // Edit re-logs the outgoing money fresh so amount or account changes net
  // out. A changed due date resets which reminders count as sent, so the new
  // date gets its own 7-3-1. Repayment state survives untouched.
  updateLend: (id, input) =>
    set((s) => {
      const old = s.lends.find((l) => l.id === id);
      if (!old) return s;
      let { accounts, transactions } = reverseSplitTx(s, old.expenseTxId);
      let expenseTxId: string | undefined;
      if (input.accountId) {
        expenseTxId = uid();
        accounts = accounts.map((a) => (a.id === input.accountId ? { ...a, balance: flowBalance(a, false, input.amount, 1) } : a));
        transactions = [
          { id: expenseTxId, amount: input.amount, description: `Lent: ${input.name}`, categoryId: 'Lending', timestamp: Date.now(), isIncome: false, accountId: input.accountId },
          ...transactions,
        ];
      }
      const dueChanged = old.dueDate !== input.dueDate;
      const lend: Lend = {
        ...old,
        name: input.name,
        email: input.email?.trim() || undefined,
        amount: input.amount,
        dueDate: input.dueDate,
        note: input.note?.trim() || undefined,
        accountId: input.accountId,
        expenseTxId,
        consent: input.consent,
        sentStages: dueChanged ? [] : old.sentStages,
      };
      return { lends: s.lends.map((l) => (l.id === id ? lend : l)), accounts, transactions };
    }),

  // Deleting keeps logged transactions: the money really moved.
  removeLend: (id) => set((s) => ({ lends: s.lends.filter((l) => l.id !== id) })),

  markLendRepaid: (id, accountId) =>
    set((s) => {
      const lend = s.lends.find((l) => l.id === id);
      if (!lend || lend.repaid) return s;
      let accounts = s.accounts;
      let transactions = s.transactions;
      let repaidTxId: string | undefined;
      if (accountId) {
        repaidTxId = uid();
        accounts = accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, true, lend.amount, 1) } : a));
        transactions = [
          { id: repaidTxId, amount: lend.amount, description: `Lend repaid: ${lend.name}`, categoryId: 'Lending', timestamp: Date.now(), isIncome: true, accountId },
          ...transactions,
        ];
      }
      return {
        accounts,
        transactions,
        lends: s.lends.map((l) => (l.id === id ? { ...l, repaid: true, repaidAt: Date.now(), repaidTxId } : l)),
      };
    }),

  unmarkLendRepaid: (id) =>
    set((s) => {
      const lend = s.lends.find((l) => l.id === id);
      if (!lend) return s;
      const { accounts, transactions } = reverseSplitTx(s, lend.repaidTxId);
      return {
        accounts,
        transactions,
        lends: s.lends.map((l) => (l.id === id ? { ...l, repaid: false, repaidAt: undefined, repaidTxId: undefined } : l)),
      };
    }),

  markLendStageSent: (id, stage) =>
    set((s) => ({
      lends: s.lends.map((l) => (l.id === id ? { ...l, sentStages: [...(l.sentStages ?? []), stage] } : l)),
    })),

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
      const tx = { id: uid(), amount, description: note?.trim() || categoryName, categoryId: categoryName, timestamp: Date.now(), isIncome: false, accountId };
      let accounts = accountId
        ? s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, false, amount, 1) } : a))
        : s.accounts;
      // Wallet v5: an expense on a credit-bill budget pays the card down.
      accounts = applyCreditBillPayment({ accounts, categories: s.categories }, tx, 1);
      return {
        categories,
        accounts,
        transactions: [tx, ...s.transactions],
      };
    });
    notifyBudgetCrossings(prevCategories, get().categories, get().notificationsEnabled);
    const acct = accountId ? get().accounts.find((a) => a.id === accountId) : undefined;
    pushCents(set, `Logged ${peso(amount)} under ${categoryName}${acct ? ` from ${acct.name}` : ''}.`);
  },

  addIncome: (amount, accountId, note) => {
    // Planner v2.3: after this income posts, waiting auto-pays get their
    // retry (see the end of this action).
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, balance: flowBalance(a, true, amount, 1) } : a)),
      transactions: [
        { id: uid(), amount, description: note?.trim() || 'Income', categoryId: 'Income', timestamp: Date.now(), isIncome: true, accountId },
        ...s.transactions,
      ],
    }));
    const acct = get().accounts.find((a) => a.id === accountId);
    pushCents(set, `Added ${peso(amount)} to ${acct?.name ?? 'your account'}.`);
    // Money just landed: any auto-pay that was short on balance gets its
    // shot right now instead of waiting for the next app open.
    get().runAutoPayIfDue();
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
        // v5.36: credit-card bill budgets live on the CARD's cycle, not the
        // calendar's. Their spent resets and due date re-arm happen in
        // runCreditStatementsIfDue on the billing day; the generic monthly
        // rollover recomputing spent (wiping a payment made late in the
        // cycle) or clearing their once-type due date would corrupt that.
        if (c.creditAccountId) return c;
        const spent = s.transactions
          .filter((tx) => !tx.transferToId)
          .filter((tx) => !tx.isIncome && tx.timestamp >= monthStart && tx.categoryId.toLowerCase() === c.name.toLowerCase())
          .reduce((a, tx) => a + tx.amount, 0);
        // Planner v2.1: one time dues are done once their month is over.
        // Monthly dues re-arm on their intended day, clamped to short months
        // (a 31st lands on Feb 28 instead of drifting to Mar 3). Legacy
        // budgets without dueDay learn theirs from the old date's day.
        let dueDate = c.dueDate;
        let dueDay = c.dueDay;
        if (dueDate && dueDate < monthStart) {
          if (c.dueType === 'once') {
            dueDate = undefined;
          } else {
            const nowD = new Date();
            if (!dueDay) dueDay = new Date(dueDate).getDate();
            const lastDay = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
            const d = new Date(nowD.getFullYear(), nowD.getMonth(), Math.min(dueDay, lastDay));
            d.setHours(12, 0, 0, 0);
            dueDate = d.getTime();
          }
        }
        return { ...c, spent, dueDate, dueDay };
      }),
    });
  },

  // Planner v2.3: auto-pay. For every monthly budget with auto-pay on whose
  // due day has arrived and which has not been settled this month, log the
  // UNSPENT part of the budget as an expense from the chosen account. The
  // unspent part (not the full limit) means a bill the user already logged
  // by hand never gets double charged. Debit style accounts must cover the
  // amount or the user gets one heads up for the month and the charge waits;
  // credit cards always go through since spending there just grows what is
  // owed. Reruns on app open, on budget edits, and right after income lands,
  // so "logs itself once there is balance" actually happens.
  runAutoPayIfDue: () => {
    const key = monthKey();
    const now = Date.now();
    const enabled = get().notificationsEnabled;
    for (const c of get().categories) {
      // v5.37 (owner decision): credit bill budgets are REMINDER-ONLY,
      // never auto-paid - paying the card is always a deliberate act. The
      // 'once' gate excludes them here, and the statement sweep strips any
      // auto-pay state off a bill budget so the rule can't be worked around.
      if (!c.autoPay || !c.autoPayAccountId || !c.dueDate || c.dueType === 'once') continue;
      if (c.autoPayLast === key) continue;
      if (c.dueDate > now) continue; // due day not here yet
      const amount = Math.max(c.limit - c.spent, 0);
      const stamp = (patch: Partial<Category>) =>
        set((s) => ({ categories: s.categories.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }));
      if (amount <= 0) {
        // Already fully logged by hand this month. Nothing owed, mark done.
        stamp({ autoPayLast: key });
        continue;
      }
      const acct = get().accounts.find((a) => a.id === c.autoPayAccountId);
      if (!acct) {
        if (c.autoPayFailNotified !== key) {
          stamp({ autoPayFailNotified: key });
          notifyAutoPay(`${c.name} auto-pay needs attention`, 'The account it pays from is gone. Pick a new one in Budgets.', enabled);
          pushCents(set, `Heads up: ${c.name} is set to auto-pay but its account is gone. Pick a new one in Budgets and I will take it from there.`);
        }
        continue;
      }
      // What the account can actually cover: balance for debit style,
      // remaining credit for cards. A card without a set limit is let
      // through since there is nothing to check against.
      const available = acct.kind === 'credit'
        ? (acct.creditLimit ? Math.max(acct.creditLimit - acct.balance, 0) : Number.POSITIVE_INFINITY)
        : acct.balance;
      if (available < amount) {
        if (c.autoPayFailNotified !== key) {
          stamp({ autoPayFailNotified: key });
          notifyAutoPay(
            `${c.name} auto-pay is waiting`,
            `${acct.name} does not have ${peso(amount)} free for it. Top it up and it logs itself.`,
            enabled,
          );
          pushCents(set, `Heads up: ${c.name} is due but ${acct.name} only has ${peso(available)} of the ${peso(amount)} needed. Add funds or log some income and I will auto-log it the moment the balance is there.`);
        }
        continue;
      }
      get().addExpense(amount, c.name, acct.id, `Auto-pay: ${c.name}`);
      stamp({ autoPayLast: key });
      notifyAutoPay(`${c.name} auto-paid`, `${peso(amount)} from ${acct.name}, logged for you.`, enabled);
    }
  },

  // Wallet v5 (owner request): when a credit card's billing day arrives,
  // whatever the card owes becomes a "<Card> Bill" budget in the Budgets
  // list, due on the card's dueDay, reminders on. Runs once per card per
  // month (lastStatement stamp), matched by creditAccountId so a renamed
  // bill budget still refreshes instead of duplicating. Owing nothing on
  // the billing day = no bill that cycle. Paying the budget pays the card
  // (applyCreditBillPayment), so the two never disagree.
  ledgerFilter: null,
  setLedgerFilter: (f) => set({ ledgerFilter: f }),
  plannerFocus: null,
  setPlannerFocus: (f) => set({ plannerFocus: f }),

  addTransfer: (fromId, toId, amount, note) => {
    if (!(amount > 0) || fromId === toId) return;
    set((s) => {
      const from = s.accounts.find((a) => a.id === fromId);
      const to = s.accounts.find((a) => a.id === toId);
      if (!from || !to) return s;
      const tx: Transaction = {
        id: uid(), amount,
        description: note?.trim() || `${from.name} → ${to.name}`,
        categoryId: 'Transfer', timestamp: Date.now(), isIncome: false,
        accountId: fromId, transferToId: toId,
      };
      return {
        ...applyTxEffect(s, tx, 1),
        transactions: [tx, ...s.transactions],
      };
    });
  },

  runCreditStatementsIfDue: () => {
    const key = monthKey();
    const now = new Date();
    const enabled = get().notificationsEnabled;
    // Due date = the next occurrence of dueDay AFTER the statement day
    // (same month when it falls later, next month otherwise), clamped to
    // short months like rollover does.
    const dueAfterStatement = (dueDay: number, stmtDay: number): number => {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      if (dueDay <= stmtDay) d.setMonth(d.getMonth() + 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dueDay, lastDay));
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    };
    for (const a of get().accounts) {
      if (a.kind !== 'credit' || !a.billingDay) continue;
      const lastDayThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const stmtDay = Math.min(a.billingDay, lastDayThisMonth);
      // v5.35 REPAIR PASS, v5.36 drift-proofed: an existing linked bill
      // budget re-syncs its due date ONLY when the card's dueDay was set or
      // corrected after the cut - i.e. the budget has no date, or its date's
      // day-of-month no longer matches the card's dueDay (clamp-aware for
      // short months). A date whose day already matches belongs to its own
      // statement and is left alone, so an UNPAID old bill can never have
      // its deadline quietly dragged into the next month.
      const linked0 = get().categories.find((c) => c.creditAccountId === a.id);
      if (linked0 && a.dueDay) {
        const existing = linked0.dueDate ? new Date(linked0.dueDate) : null;
        const clampDay = existing
          ? Math.min(a.dueDay, new Date(existing.getFullYear(), existing.getMonth() + 1, 0).getDate())
          : 0;
        if (!existing || existing.getDate() !== clampDay) {
          const wantDue = dueAfterStatement(a.dueDay, stmtDay);
          set((s) => ({
            categories: s.categories.map((c) =>
              c.id === linked0.id ? { ...c, dueDate: wantDue, dueType: 'once' as const, remind: true } : c,
            ),
          }));
        }
      } else if (linked0 && !a.dueDay && linked0.dueDate) {
        // Card's due day was cleared in Wallet: the bill loses its date too.
        set((s) => ({
          categories: s.categories.map((c) =>
            c.id === linked0.id ? { ...c, dueDate: undefined } : c,
          ),
        }));
      }
      if (a.lastStatement === key) {
        // v5.46 RESURRECTION (owner question exposed the hole): the bill
        // budget can be deleted mid-cycle - by the trash button or by Cents'
        // RemoveCategory - and the once-per-month stamp would have kept it
        // dead until NEXT billing day, with no way to hand-make one that
        // carries the payment link. If this month's statement already cut
        // and the card still owes, the sweep recreates the linked bill on
        // its next run (limit = what's STILL owed, fresh due date).
        if (!linked0 && a.balance > 0) {
          const rezDue = a.dueDay ? dueAfterStatement(a.dueDay, stmtDay) : undefined;
          const rezName = `${a.name}${a.nickname ? ` ${a.nickname}` : ''} Bill`;
          let revived = false;
          set((s) => {
            if (s.categories.some((c) => c.name.toLowerCase() === rezName.toLowerCase())) return s;
            revived = true;
            return {
              categories: [...s.categories, {
                id: uid(), name: rezName, limit: a.balance, spent: 0, icon: 'card', category: 'Bills',
                dueDate: rezDue, dueType: 'once' as const, remind: true, creditAccountId: a.id,
              }],
            };
          });
          if (revived) {
            pushCents(set, `${a.name}'s bill went missing from your Budgets, so I brought it back: ${peso(a.balance)} still owed this cycle.`);
          }
        }
        continue;
      }
      if (now.getDate() < stmtDay) continue; // billing day not here yet
      const stampDone = () =>
        set((s) => ({ accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, lastStatement: key } : x)) }));
      const owed = a.balance;
      if (!(owed > 0)) {
        // v5.36: nothing owed this cycle = no bill. A leftover budget from a
        // previous statement is CLEARED from the list instead of lingering
        // as a paid zombie; its payment transactions stay in the ledger,
        // which is the real record.
        const stale = get().categories.find((c) => c.creditAccountId === a.id);
        if (stale) {
          set((s) => ({ categories: s.categories.filter((c) => c.id !== stale.id) }));
          pushCents(set, `${a.name}'s statement cut at zero owed. Cleared last cycle's bill from your Budgets.`);
        }
        stampDone();
        continue;
      }
      // No dueDay set = a bill without a date; it still lands in the list,
      // just without reminders to anchor (and the repair pass above dates it
      // the moment the owner fills the field in Wallet).
      const dueDate = a.dueDay ? dueAfterStatement(a.dueDay, stmtDay) : undefined;
      const billName = `${a.name}${a.nickname ? ` ${a.nickname}` : ''} Bill`;
      set((s) => {
        const existing = s.categories.find((c) => c.creditAccountId === a.id);
        if (existing) {
          return {
            categories: s.categories.map((c) =>
              c.id === existing.id
                ? { ...c, name: billName, limit: owed, spent: 0, dueDate, dueType: 'once' as const, remind: true, autoPay: undefined, autoPayAccountId: undefined }
                : c,
            ),
          };
        }
        // Name collision with an unrelated budget: refuse to hijack it.
        if (s.categories.some((c) => c.name.toLowerCase() === billName.toLowerCase())) return s;
        return {
          categories: [...s.categories, {
            id: uid(), name: billName, limit: owed, spent: 0, icon: 'card', category: 'Bills',
            dueDate, dueType: 'once' as const, remind: true, creditAccountId: a.id,
          }],
        };
      });
      stampDone();
      const dueBit = dueDate
        ? `, due ${new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : '';
      notifyAutoPay(`${a.name} statement is in`, `${peso(owed)} owed${dueBit}. It's in your Budgets now.`, enabled);
      pushCents(set, `${a.name}'s statement just cut: ${peso(owed)} owed${dueBit}. I added it to your Budgets${dueDate ? ' with reminders on' : ''}.`);
    }
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
      } else if (msg.type === 'batchConfirmation') {
        // M5.34: ONE yes lands the whole plan. Every action runs through the
        // same chokepoint in order; batchDepth holds flushPendingAsk until
        // the end so a plan asks at most one follow-up question.
        batchDepth += 1;
        try {
          for (const a of msg.actions) executeAction(a, set);
        } finally {
          batchDepth -= 1;
        }
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
          state.runCreditStatementsIfDue(); // cut card statements whose billing day arrived
          state.runAutoPayIfDue(); // settle any monthly bills whose day arrived
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
      case 'AddCategory': {
        // v5.38: a stated due day makes this a BILL, not a spending
        // envelope - the ask says so, and the action carries the day.
        const billDay = Math.min(Math.max(Math.round(result.dueDay ?? 0), 0), 31);
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: billDay > 0
            ? (fil
                ? `Idagdag ang ${categoryName} bilang bill: ${peso(amount)} kada buwan, due tuwing ika-${billDay}, may mga paalala?`
                : `Add ${categoryName} as a bill: ${peso(amount)}/month, due every ${ordinalDay(billDay)}, reminders on?`)
            : `Add a ${categoryName} spending budget of ${peso(amount)}/month?`,
          action: { kind: 'AddCategory', name: categoryName, limit: amount, dueDay: billDay > 0 ? billDay : undefined },
          confirmed: false, handled: false, lang,
        };
        break;
      }
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
      case 'MoveFunds': {
        const from = matchAccount(result.accountName, st2.accounts);
        const to = matchAccount(result.toAccountName, st2.accounts);
        if (!from || !to) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: fil
              ? 'Saang account manggagaling at saan mapupunta? Sabihin mo, hal. "ilipat ang 500 mula GCash papuntang BPI".'
              : `Which account is it coming from, and where is it going? Say something like "move 500 from GCash to BPI".`,
          };
          break;
        }
        if (from.id === to.id) {
          reply = { id: uid(), sender: 'CENTS', type: 'text', text: `That's the same account on both sides - nothing to move.` };
          break;
        }
        if (!(amount > 0)) {
          reply = { id: uid(), sender: 'CENTS', type: 'text', text: `How much should I move from ${from.name} to ${to.name}?` };
          break;
        }
        const short = from.kind !== 'credit' && from.balance < amount;
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Ilipat ang ${peso(amount)} mula ${from.name} papuntang ${to.name}?`
            : `Move ${peso(amount)} from ${from.name} to ${to.name}?${to.kind === 'credit' ? ' That pays the card down.' : ''}`,
          action: { kind: 'MoveFunds', fromId: from.id, toId: to.id, amount, label: `${from.name} → ${to.name}` },
          confirmed: false, handled: false, lang,
          coachNote: short ? `${from.name} only holds ${peso(from.balance)} right now - this would take it negative.` : undefined,
        };
        break;
      }
      case 'ShowTransactions': {
        const catHit = result.categoryName
          ? st2.categories.find((c) => c.name.toLowerCase() === result.categoryName!.toLowerCase())
          : undefined;
        const q = (item || '').trim();
        const what = catHit ? catHit.name : q || 'everything';
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Ipakita ang ${what} sa Transactions tab?`
            : `Pull up ${what} in your Transactions tab?`,
          action: { kind: 'ShowTransactions', query: catHit ? undefined : q || undefined, categoryName: catHit?.name },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      // M5.34 (Cents parity phase 1): the exact transaction is resolved NOW,
      // at ask time, and its id rides on the action - the confirm can never
      // hit a different row than the one the card described.
      case 'RemoveTransaction': {
        const tx = findTxForEdit(st2, item, amount);
        if (!tx) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: fil
              ? `Wala akong makitang na-log na "${item}"${amount > 0 ? ` na ${peso(amount)}` : ''}. Tingnan mo sa Analytics ang listahan.`
              : `I couldn't find a logged transaction matching "${item}"${amount > 0 ? ` for ${peso(amount)}` : ''}. The full ledger is in Analytics.`,
          };
          break;
        }
        const when = new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Burahin ang ${peso(tx.amount)} na "${tx.description}" mula ${when}? Babalik ang balanse at budget nito.`
            : `Delete the ${peso(tx.amount)} "${tx.description}" from ${when}? Its balance and budget effects reverse.`,
          action: { kind: 'RemoveTransaction', txId: tx.id, label: tx.description },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'UpdateTransaction': {
        // 'amount' here is the NEW amount, so the match is by name only.
        const tx = findTxForEdit(st2, item, 0);
        if (!tx) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: fil
              ? `Wala akong makitang na-log na "${item}". Tingnan mo sa Analytics ang listahan.`
              : `I couldn't find a logged transaction matching "${item}". The full ledger is in Analytics.`,
          };
          break;
        }
        if (!(amount > 0)) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: fil ? `Magkano dapat ang "${tx.description}"?` : `What should "${tx.description}" be instead?`,
          };
          break;
        }
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Palitan ang "${tx.description}" mula ${peso(tx.amount)} papuntang ${peso(amount)}?`
            : `Change "${tx.description}" from ${peso(tx.amount)} to ${peso(amount)}?`,
          action: { kind: 'UpdateTransaction', txId: tx.id, newAmount: amount, label: tx.description },
          confirmed: false, handled: false, lang,
        };
        break;
      }
      case 'SetBudgetDue': {
        if (!category) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'text',
            text: st2.categories.length
              ? `I couldn't find a budget named ${categoryName}. Your budgets: ${st2.categories.map((c) => c.name).join(', ')}.`
              : `You don't have any budgets yet. Say something like "add a rent budget of 8,000" first.`,
          };
          break;
        }
        const day = Math.min(Math.max(Math.round(result.dueDay ?? 0), 0), 31);
        if (day === 0) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `Itigil ang mga paalala para sa ${category.name}?`
              : `Turn off reminders for ${category.name}?`,
            action: { kind: 'SetBudgetDue', categoryName: category.name, dueDay: 0 },
            confirmed: false, handled: false, lang,
          };
          break;
        }
        reply = {
          id: uid(), sender: 'CENTS', type: 'confirmation',
          prompt: fil
            ? `Gawing due ang ${category.name} tuwing ika-${day} ng buwan, may mga paalala?`
            : `Make ${category.name} due every ${ordinalDay(day)} of the month, reminders on?`,
          action: { kind: 'SetBudgetDue', categoryName: category.name, dueDay: day },
          confirmed: false, handled: false, lang,
        };
        break;
      }
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
        const tx = { id: uid(), amount: action.amount, description: action.item?.trim() || action.categoryName, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false, accountId: src.acct?.id };
        return {
          accounts: applyCreditBillPayment({ accounts: src.accounts, categories: s.categories }, tx, 1),
          categories: exists
            ? s.categories.map((c) =>
                c.name.toLowerCase() === action.categoryName.toLowerCase()
                  ? { ...c, spent: c.spent + action.amount } : c,
              )
            : [...s.categories, { id: uid(), name: action.categoryName, limit: action.amount, spent: action.amount, icon: 'pricetag' }],
          transactions: [tx, ...s.transactions],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)}${action.item ? ` for ${action.item}` : ''} under ${action.categoryName}${srcName1 ? ` from ${srcName1}` : ''}.`);
      break;
    }
    case 'NegotiatePurchase':
      set((s) => {
        const src = debitSource(s, action.accountName, action.amount);
        const tx = { id: uid(), amount: action.amount, description: action.item, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false, accountId: src.acct?.id };
        return {
          accounts: applyCreditBillPayment({ accounts: src.accounts, categories: s.categories }, tx, 1),
          categories: s.categories.map((c) =>
            c.name.toLowerCase() === action.categoryName.toLowerCase()
              ? { ...c, spent: c.spent + action.amount } : c,
          ),
          transactions: [tx, ...s.transactions],
        };
      });
      pushCents(set, `Done. ${peso(action.amount)} logged to ${action.categoryName}. Keep an eye on that goal!`);
      break;
    case 'AddCategory': {
      // v5.38: dueDay = a BILL (dated, monthly due, reminders on) that lands
      // in the Bills tab; without it, a spending envelope as before.
      const bill = action.dueDay && action.dueDay > 0;
      set((s) => ({
        categories: [...s.categories, {
          id: uid(), name: action.name, limit: action.limit, spent: 0, icon: 'pricetag',
          ...(bill ? {
            dueDate: nextMonthlyDueTs(action.dueDay!),
            dueDay: action.dueDay,
            dueType: 'monthly' as const,
            remind: true,
          } : {}),
        }],
      }));
      pushCents(set, bill
        ? `Added ${action.name} to your Bills: ${peso(action.limit)} due every ${ordinalDay(action.dueDay!)}, reminders on.`
        : `Added ${action.name} with a ${peso(action.limit)} spending budget.`);
      break;
    }
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
      // Planner v1: hand the store a real timestamp so the Goals section can
      // do deadline pace math on chat-created goals too.
      const dTs = Date.parse(d);
      st.addGoal(action.name, action.target, d, Number.isNaN(dTs) ? undefined : dTs);
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
    // M5.34: ledger edits by chat/voice. The txId was resolved at ASK time,
    // so these ride the same removeTransaction/updateTransaction machinery
    // Analytics uses - balances, budgets and goals all reverse correctly.
    case 'MoveFunds': {
      useFinance.getState().addTransfer(action.fromId, action.toId, action.amount);
      pushCents(set, `Moved ${peso(action.amount)} (${action.label}). Balances updated - no expense logged.`);
      break;
    }
    case 'ShowTransactions': {
      set(() => ({ ledgerFilter: { query: action.query, categoryName: action.categoryName } }));
      const what = action.categoryName ?? action.query ?? 'your latest';
      pushCents(set, `Done - the Transactions tab is filtered to ${what}. Tap "All budgets" or clear the search there to reset it.`);
      break;
    }
    case 'RemoveTransaction': {
      const st = useFinance.getState();
      const tx = st.transactions.find((x) => x.id === action.txId);
      if (!tx) { pushCents(set, `That entry is already gone from the ledger.`); break; }
      st.removeTransaction(action.txId);
      pushCents(set, `Deleted the ${peso(tx.amount)} ${action.label} entry. Balances and budgets adjusted back.`);
      break;
    }
    case 'UpdateTransaction': {
      const st = useFinance.getState();
      const tx = st.transactions.find((x) => x.id === action.txId);
      if (!tx) { pushCents(set, `I couldn't find that entry in the ledger anymore.`); break; }
      st.updateTransaction(action.txId, { amount: action.newAmount });
      pushCents(set, `Updated ${action.label} from ${peso(tx.amount)} to ${peso(action.newAmount)}.`);
      break;
    }
    case 'SetBudgetDue': {
      const st = useFinance.getState();
      const cat = st.categories.find((c) => c.name.toLowerCase() === action.categoryName.toLowerCase());
      if (!cat) { pushCents(set, `I couldn't find a budget named ${action.categoryName}.`); break; }
      if (!(action.dueDay > 0)) {
        set((s) => ({ categories: s.categories.map((c) => (c.id === cat.id ? { ...c, remind: false } : c)) }));
        pushCents(set, `Okay, no more reminders for ${cat.name}.`);
        break;
      }
      set((s) => ({
        categories: s.categories.map((c) =>
          c.id === cat.id
            ? { ...c, dueDate: nextMonthlyDueTs(action.dueDay), dueDay: action.dueDay, dueType: 'monthly' as const, remind: true }
            : c,
        ),
      }));
      pushCents(set, `${cat.name} is due every ${ordinalDay(action.dueDay)} now, reminders on.`);
      break;
    }
  }
}