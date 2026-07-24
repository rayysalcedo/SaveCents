// Port of FinanceViewModel.kt — same mock data, same action semantics.
// M2 will swap processChatInput's local stub for the Gemini backend call.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, ActionType, Category, ChatMessage, Goal, Transaction, UserProfile, uid, peso, setCurrencySymbol,
} from '../models/types';
import { COUNTRIES } from '../data/countries';
import { localParseIntent, parseCentsIntent, CentsResult } from '../services/cents';

interface FinanceState {
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

  selectGoal: (id: string) => void;
  setThemeMode: (m: 'light' | 'dark' | 'system') => void;
  setCountry: (code: string) => void;
  addAccount: (name: string, color?: string, initial?: string) => void;
  updateProfile: (name: string, email: string) => void;
  biometricsEnabled: boolean;
  setBiometricsEnabled: (v: boolean) => void;
  removeAccount: (id: string) => void;
  setAccountBalance: (id: string, balance: number) => void;
  addBudget: (name: string, limit: number, icon?: string) => void;
  updateBudget: (id: string, name: string, limit: number, icon: string) => void;
  removeBudget: (id: string) => void;
  removeGoal: (id: string) => void;
  login: (name: string, email: string) => void;
  logout: () => void;
  addGoal: (name: string, target: number, date: string) => void;
  sendChat: (input: string) => Promise<void>;
  confirmAction: (messageId: string, confirm: boolean) => void;
  simulateReceiptScan: () => void;
  simulateConsultItem: () => void;
}

const now = Date.now();
const day = 86_400_000;

export const useFinance = create<FinanceState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
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
  themeMode: 'dark',
  country: 'PH',
  currency: '\u20B1',

  selectGoal: (id) => set({ selectedGoalId: id }),
  setThemeMode: (m) => set({ themeMode: m }),

  setCountry: (code) => {
    const c = COUNTRIES[code];
    if (!c) return;
    setCurrencySymbol(c.symbol);
    set({ country: code, currency: c.symbol });
  },

  addAccount: (name, color, initial) => {
    const s = get();
    if (s.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    set({ accounts: [...s.accounts, { id: uid(), name, balance: 0, color, initial }] });
  },
  updateProfile: (name, email) => set((s) => ({ profile: { ...s.profile, name, email } })),
  biometricsEnabled: true,
  setBiometricsEnabled: (v) => set({ biometricsEnabled: v }),
  removeAccount: (id) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),
  setAccountBalance: (id, balance) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, balance } : a)) })),

  addBudget: (name, limit, icon = 'pricetag') => {
    const s = get();
    if (s.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    set({ categories: [...s.categories, { id: uid(), name, limit, spent: 0, icon }] });
  },
  updateBudget: (id, name, limit, icon) =>
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name, limit, icon } : c)),
    })),
  removeBudget: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),
  removeGoal: (id) =>
    set((s) => ({
      goals: s.goals.filter((g) => g.id !== id),
      selectedGoalId: s.selectedGoalId === id ? null : s.selectedGoalId,
    })),

  login: (name, email) => set((s) => ({ profile: { ...s.profile, name, email, isLoggedIn: true } })),
  logout: () => set((s) => ({ profile: { ...s.profile, isLoggedIn: false } })),

  addGoal: (name, target, date) =>
    set((s) => ({ goals: [...s.goals, { id: uid(), name, target, current: 0, date }] })),

  // M2: real Gemini intent parsing via Firebase AI Logic, with the local
  // heuristic as an offline/unconfigured fallback.
  sendChat: async (input) => {
    set((st) => ({
      chat: [...st.chat, { id: uid(), sender: 'USER', type: 'text', text: input }],
      isThinking: true,
    }));

    const s = get();
    const ctx = {
      categories: s.categories,
      goals: s.goals,
      accounts: s.accounts,
      currency: s.currency,
    };

    let result: CentsResult;
    try {
      result = await parseCentsIntent(input, ctx);
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);
      console.warn('[Cents brain error]', errMsg);
      result = localParseIntent(input, ctx);
      if (__DEV__ && result.intent === 'Unknown') {
        result.reply += `\n\n[debug — brain error: ${String(errMsg).slice(0, 160)}]`;
      }
    }

    const { intent, amount, categoryName, lang } = result;
    const fil = lang === 'fil';
    const item = result.item || categoryName;
    const st2 = get();
    const category = st2.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());

    let reply: ChatMessage;
    switch (intent) {
      case 'LogTransaction': {
        if (category) {
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `I-log ang ${peso(amount)} para sa ${item !== category.name ? `${item} sa ` : ''}${category.name}?`
              : `Log ${peso(amount)} for ${item !== category.name ? `${item} under ` : ''}${category.name}?`,
            action: { kind: 'LogTransaction', amount, categoryName: category.name },
            confirmed: false, handled: false, lang,
          };
        } else {
          // Nothing fits — file under Others (auto-created on confirm).
          reply = {
            id: uid(), sender: 'CENTS', type: 'confirmation',
            prompt: fil
              ? `Walang budget na bagay sa "${item}" (${peso(amount)}) — i-log sa Others?`
              : `"${item}" (${peso(amount)}) doesn't fit your current budgets — log it under Others?`,
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
            text: `You have no budgets yet — add one in Plan and I can weigh this ${peso(amount)} purchase for you.`,
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
          text: result.reply || "I'm not sure what you meant — try 'spent 250 on gas'.",
        };
    }

    set((st) => ({ chat: [...st.chat, reply], isThinking: false }));
  },

  confirmAction: (messageId, confirm) => {
    const s = get();
    const msg = s.chat.find((m) => m.id === messageId);
    if (!msg || !('handled' in msg) || msg.handled) return;

    if (confirm) {
      if (msg.type === 'confirmation' || msg.type === 'negotiation') {
        executeAction(msg.action, set);
      } else if (msg.type === 'receiptScan') {
        executeAction({ kind: 'LogTransaction', amount: msg.amount, categoryName: 'Pets' }, set);
        pushCents(set, `Logged ${peso(msg.amount)} under Pets.`);
      } else if (msg.type === 'consultItem') {
        pushCents(set, `Okay — logged the ${msg.item} for ${peso(msg.amount)}. I'll adjust your ${msg.goalName} trajectory.`);
      } else if (msg.type === 'mismatch') {
        executeAction({ kind: 'CreateAndLog', item: msg.item, amount: msg.amount }, set);
      }
    } else if (msg.type === 'receiptScan') {
      pushCents(set, 'Receipt scan cancelled.');
    }

    set((st) => ({
      chat: st.chat.map((m) =>
        m.id === messageId && 'handled' in m ? { ...m, confirmed: confirm, handled: true } : m,
      ),
    }));
  },

  simulateReceiptScan: () => {
    set((s) => ({ chat: [...s.chat, { id: uid(), sender: 'USER', type: 'text', text: '📷 Scanned Receipt' }] }));
    setTimeout(() => {
      set((s) => ({
        chat: [...s.chat, { id: uid(), sender: 'CENTS', type: 'receiptScan', amount: 800, store: 'Pet Store', confirmed: false, handled: false }],
      }));
    }, 1000);
  },

  simulateConsultItem: () => {
    set((s) => ({ chat: [...s.chat, { id: uid(), sender: 'USER', type: 'text', text: '📷 Consult Item' }] }));
    setTimeout(() => {
      const goal = get().goals[0];
      set((s) => ({
        chat: [...s.chat, {
          id: uid(), sender: 'CENTS', type: 'consultItem',
          item: 'Shoes', amount: 3500, delayWeeks: 2, goalName: goal?.name ?? 'Savings Goal',
          confirmed: false, handled: false,
        }],
      }));
    }, 1000);
  },
    }),
    {
      name: 'savecents-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({
        accounts: s.accounts,
        categories: s.categories,
        goals: s.goals,
        transactions: s.transactions,
        chat: s.chat.slice(-30), // keep only the last 30 messages
        profile: s.profile,
        selectedGoalId: s.selectedGoalId,
        themeMode: s.themeMode,
        country: s.country,
        currency: s.currency,
        biometricsEnabled: s.biometricsEnabled,
      }),
      migrate: (persisted, _version) => persisted as FinanceState, // no-op at v1
      onRehydrateStorage: () => (state) => {
        if (state) {
          setCurrencySymbol(state.currency); // resync module-level symbol
          state.setHasHydrated(true);
        }
      },
    },
  ),
);

type Setter = (fn: (s: FinanceState) => Partial<FinanceState>) => void;

function pushCents(set: Setter, text: string) {
  set((s) => ({ chat: [...s.chat, { id: uid(), sender: 'CENTS', type: 'text', text }] }));
}

function executeAction(action: ActionType, set: Setter) {
  switch (action.kind) {
    case 'LogTransaction':
      set((s) => ({
        categories: s.categories.map((c) =>
          c.name.toLowerCase() === action.categoryName.toLowerCase()
            ? { ...c, spent: c.spent + action.amount } : c,
        ),
        transactions: [
          { id: uid(), amount: action.amount, description: action.categoryName, categoryId: action.categoryName, timestamp: Date.now(), isIncome: false },
          ...s.transactions,
        ],
      }));
      pushCents(set, `Logged ${peso(action.amount)} under ${action.categoryName}.`);
      break;
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
      pushCents(set, `Done — ${peso(action.amount)} logged to ${action.categoryName}. Keep an eye on that goal!`);
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