// Port of FinanceViewModel.kt — same mock data, same action semantics.
// M2 will swap processChatInput's local stub for the Gemini backend call.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, ActionType, Category, ChatMessage, Goal, Transaction, UserProfile, uid, peso, setCurrencySymbol, setNumberLocale,
} from '../models/types';
import { notifyBudgetCrossings } from '../services/notifications';
import { COUNTRIES } from '../data/countries';
import { analyzeImage, localParseIntent, parseCentsIntent, CentsResult } from '../services/cents';

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

  selectGoal: (id: string) => void;
  setThemeMode: (m: 'light' | 'dark' | 'system') => void;
  setCountry: (code: string) => void;
  addAccount: (name: string, color?: string, initial?: string) => void;
  updateProfile: (name: string, email: string) => void;
  updatePersona: (nickname: string, avatarId: string | null) => void;
  biometricsEnabled: boolean;
  setBiometricsEnabled: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
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
  // M5 quick actions from the Cents hub — direct logging, no chat round-trip.
  addExpense: (amount: number, categoryName: string, accountId?: string, note?: string) => void;
  addIncome: (amount: number, accountId: string, note?: string) => void;
  // M5.6 truth pass
  updateTransaction: (id: string, patch: { amount?: number; description?: string; categoryId?: string }) => void;
  removeTransaction: (id: string) => void;
  rolloverBudgetsIfNeeded: () => void;
  sendChat: (input: string) => Promise<void>;
  sendImage: (base64: string, mimeType: string, mode: 'receipt' | 'price', imageUri?: string) => Promise<void>;
  confirmAction: (messageId: string, confirm: boolean) => void;
}

const now = Date.now();
const day = 86_400_000;

// YYYY-MM for "which month have budgets last been reset for".
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Shared bookkeeping for edit/delete: the state deltas a transaction caused.
// sign +1 applies the transaction, sign -1 reverses it. Balances and budget
// spent clamp at 0 the same way addExpense always has.
function applyTxEffect(s: { accounts: Account[]; categories: Category[] }, tx: Transaction, sign: 1 | -1) {
  const accounts = tx.accountId
    ? s.accounts.map((a) =>
        a.id === tx.accountId
          ? { ...a, balance: Math.max(a.balance + (tx.isIncome ? tx.amount : -tx.amount) * sign, 0) }
          : a,
      )
    : s.accounts;
  const categories = tx.isIncome
    ? s.categories
    : s.categories.map((c) =>
        c.name.toLowerCase() === tx.categoryId.toLowerCase()
          ? { ...c, spent: Math.max(c.spent + tx.amount * sign, 0) }
          : c,
      );
  return { accounts, categories };
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
  themeMode: 'light' | 'dark' | 'system';
  country: string;
  currency: string;
  biometricsEnabled: boolean;
  notificationsEnabled: boolean;
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
  themeMode: 'light' as const, // M5: friendly light/sage is the new default
  country: 'PH',
  currency: '\u20B1',
  biometricsEnabled: true,
  notificationsEnabled: true,
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
  themeMode: s.themeMode,
  country: s.country,
  currency: s.currency,
  biometricsEnabled: s.biometricsEnabled,
  notificationsEnabled: s.notificationsEnabled ?? true,
  lastRollover: s.lastRollover ?? monthKey(),
});

export const useFinance = create<FinanceState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
  ...makeDefaults(),

  selectGoal: (id) => set({ selectedGoalId: id }),
  setThemeMode: (m) => set({ themeMode: m }),

  setCountry: (code) => {
    const c = COUNTRIES[code];
    if (!c) return;
    setCurrencySymbol(c.symbol);
    setNumberLocale(c.locale);
    set({ country: code, currency: c.symbol });
  },

  addAccount: (name, color, initial) => {
    const s = get();
    if (s.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    set({ accounts: [...s.accounts, { id: uid(), name, balance: 0, color, initial }] });
  },
  updateProfile: (name, email) => set((s) => ({ profile: { ...s.profile, name, email } })),
  updatePersona: (nickname, avatarId) =>
    set((s) => ({ profile: { ...s.profile, nickname: nickname.trim() || undefined, avatarId: avatarId ?? undefined } })),
  setBiometricsEnabled: (v) => set({ biometricsEnabled: v }),
  setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
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
          ? s.accounts.map((a) => (a.id === accountId ? { ...a, balance: Math.max(a.balance - amount, 0) } : a))
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
      accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, balance: a.balance + amount } : a)),
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
        categoryId: old.isIncome ? old.categoryId : (patch.categoryId ?? old.categoryId),
      };
      const reversed = applyTxEffect(s, old, -1);
      const applied = applyTxEffect({ ...s, ...reversed }, next, 1);
      return {
        ...applied,
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
      return {
        ...applyTxEffect(s, old, -1),
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
  sendChat: async (input) => {
    set((st) => ({
      chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: input }],
      isThinking: true,
    }));

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

    // Multi-step requests produce one card per action, in order. Categories
    // added earlier in the same batch count as "existing" for later cards
    // (e.g. "add a Groceries budget 9000 and log that receipt there").
    const st = get();
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
      return;
    }

    const reply = buildReplyFromResult(result, st);
    set((s2) => ({ chat: [...s2.chat, reply], isThinking: false }));
  },

  confirmAction: (messageId, confirm) => {
    const s = get();
    const msg = s.chat.find((m) => m.id === messageId);
    if (!msg || !('handled' in msg) || msg.handled) return;

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
    } else if (msg.type === 'receiptScan') {
      pushCents(set, 'Receipt scan cancelled.');
    }

    set((st) => ({
      chat: st.chat.map((m) =>
        m.id === messageId && 'handled' in m ? { ...m, confirmed: confirm, handled: true } : m,
      ),
    }));
  },

  // M4: vision — a photo is just another way to produce a CentsResult, so it
  // flows into the exact same confirmation/negotiation cards as typed chat.
  sendImage: async (base64, mimeType, mode, imageUri) => {
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

  return {
    categories: s.categories,
    goals: s.goals,
    accounts: s.accounts,
    currency: s.currency,
    nickname: s.profile.nickname || s.profile.name,
    history,
    recentTransactions: s.transactions.slice(0, 8),
  };
}

function buildReplyFromResult(result: CentsResult, st2: FinanceState, assumedCategories: string[] = []): ChatMessage {
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
            action: { kind: 'LogTransaction', amount, categoryName: name },
            confirmed: false, handled: false, lang,
          };
        } else {
          // Nothing fits — file under Others (auto-created on confirm).
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `Walang budget na bagay sa "${item}" (${peso(amount)}). I-log sa Others?`
              : `"${item}" (${peso(amount)}) doesn't fit your current budgets. Log it under Others?`,
            action: { kind: 'LogToOthers', item, amount },
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
            action: { kind: 'NegotiatePurchase', item, amount, categoryName: target.name },
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
    return reply;
}

type Setter = (fn: (s: FinanceState) => Partial<FinanceState>) => void;

function pushCents(set: Setter, text: string) {
  set((s) => ({ chat: [...s.chat, { id: uid(), sender: 'CENTS', type: 'text', text }] }));
}

function executeAction(action: ActionType, set: Setter) {
  switch (action.kind) {
    case 'LogTransaction': {
      // If the category doesn't exist yet (e.g. the log card of a multi-step
      // batch was confirmed before, or instead of, its AddCategory card),
      // create it on the spot so the log always lands somewhere real.
      set((s) => {
        const exists = s.categories.some((c) => c.name.toLowerCase() === action.categoryName.toLowerCase());
        return {
          categories: exists
            ? s.categories.map((c) =>
                c.name.toLowerCase() === action.categoryName.toLowerCase()
                  ? { ...c, spent: c.spent + action.amount } : c,
              )
            : [...s.categories, { id: uid(), name: action.categoryName, limit: action.amount, spent: action.amount, icon: 'pricetag' }],
          transactions: [
            { id: uid(), amount: action.amount, description: action.categoryName, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)} under ${action.categoryName}.`);
      break;
    }
    case 'NegotiatePurchase':
      set((s) => ({
        categories: s.categories.map((c) =>
          c.name.toLowerCase() === action.categoryName.toLowerCase()
            ? { ...c, spent: c.spent + action.amount } : c,
        ),
        transactions: [
          { id: uid(), amount: action.amount, description: action.item, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false },
          ...s.transactions,
        ],
      }));
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
      set((s) => ({
        categories: [...s.categories, { id: uid(), name: action.item, limit: action.amount, spent: action.amount, icon: 'pricetag' }],
        transactions: [
          { id: uid(), amount: action.amount, description: action.item, categoryId: action.item, timestamp: Date.now(), isIncome: false },
          ...s.transactions,
        ],
      }));
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
        return {
          categories,
          transactions: [
            { id: uid(), amount: action.amount, description: action.item, categoryId: 'Others', timestamp: Date.now(), isIncome: false },
            ...s.transactions,
          ],
        };
      });
      pushCents(set, `Logged ${peso(action.amount)} for ${action.item} under Others.`);
      break;
    }
    case 'LogToUnassigned':
      set((s) => ({
        transactions: [
          { id: uid(), amount: action.amount, description: action.item, categoryId: 'Unassigned', timestamp: Date.now(), isIncome: false },
          ...s.transactions,
        ],
      }));
      pushCents(set, `Logged ${peso(action.amount)} for ${action.item} as unassigned.`);
      break;
  }
}