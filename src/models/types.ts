// Ported from Models.kt

export interface Account {
  id: string;
  name: string;
  // Debit/wallet/cash: money available. Credit: current amount OWED.
  balance: number;
  color?: string;
  initial?: string;
  // v4.3 Wallet: card type (default 'debit' when absent, so every account
  // from an older snapshot keeps working unchanged).
  kind?: 'debit' | 'credit';
  creditLimit?: number; // credit only
  billingDay?: number;  // credit only: statement day of month (1..31)
  network?: 'visa' | 'mastercard' | 'none'; // card mark; defaults from the institution
}

export interface Category {
  id: string;
  name: string;      // display name of the budget (defaults to the category)
  limit: number;
  spent: number;
  icon: string;
  category?: string; // base category used for icons and AI filing
  dueDate?: number;  // optional bill due date (ms since epoch)
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  date: string;
}

export interface Transaction {
  id: string;
  amount: number;
  description: string;
  categoryId: string;
  timestamp: number;
  isIncome: boolean;
  accountId?: string; // M5: which card/e-wallet this routed through
  // M5.25: set = this is a SAVINGS MOVE (goal contribution when isIncome is
  // false, withdrawal when true). Moves balances, NEVER budgets.
  goalId?: string;
}

export type Sender = 'USER' | 'CENTS';

// M5.22: accountName = the payment source/destination the user mentioned;
// executeAction resolves it to an account, stamps the transaction, and moves
// the balance so every log is reflected in the money it came from.
export type ActionType =
  | { kind: 'UpdateBudget'; categoryName: string; newLimit: number }
  | { kind: 'LogTransaction'; amount: number; categoryName: string; accountName?: string; item?: string }
  | { kind: 'AddCategory'; name: string; limit: number }
  | { kind: 'RemoveCategory'; name: string }
  | { kind: 'NegotiatePurchase'; item: string; amount: number; categoryName: string; accountName?: string }
  | { kind: 'CreateAndLog'; item: string; amount: number; accountName?: string }
  | { kind: 'LogToUnassigned'; item: string; amount: number; accountName?: string }
  | { kind: 'LogToOthers'; item: string; amount: number; accountName?: string }
  | { kind: 'AddIncome'; amount: number; accountName?: string }
  | { kind: 'AddGoal'; name: string; target: number; date?: string }
  | { kind: 'AddToGoal'; goalName: string; amount: number; accountName?: string }
  | { kind: 'WithdrawFromGoal'; goalName: string; amount: number; accountName?: string }
  | { kind: 'AddAccount'; name: string; initial: number }
  | { kind: 'SetAccountBalance'; accountName: string; amount: number };

interface ChatBase {
  id: string;
  sender: Sender;
}

export type ChatMessage =
  | (ChatBase & { type: 'text'; text: string; imageUri?: string })
  // M5.19: coachNote = an insight/recommendation written at ASK time but
  // delivered only AFTER the user confirms (ask first, coach after).
  | (ChatBase & { type: 'confirmation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil'; coachNote?: string })
  | (ChatBase & { type: 'negotiation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil'; coachNote?: string })
  | (ChatBase & { type: 'receiptScan'; amount: number; store: string; confirmed: boolean; handled: boolean })
  | (ChatBase & { type: 'consultItem'; item: string; amount: number; delayWeeks: number; goalName: string; confirmed: boolean; handled: boolean })
  | (ChatBase & { type: 'mismatch'; item: string; amount: number; confirmed: boolean; handled: boolean });

export interface UserProfile {
  name: string;
  email: string;
  isLoggedIn: boolean;
  nickname?: string; // display name chosen in Profile; falls back to name
  avatarId?: string; // chosen animal avatar (see src/components/Avatar.tsx)
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

let CURRENCY_SYMBOL = '\u20B1';
export const setCurrencySymbol = (s: string) => { CURRENCY_SYMBOL = s; };

// M5.6: number grouping follows the selected country instead of a hardcoded
// en-PH (setCountry and store rehydration both call setNumberLocale).
let NUMBER_LOCALE = 'en-PH';
export const setNumberLocale = (l: string) => { NUMBER_LOCALE = l; };
export const peso = (n: number) =>
  CURRENCY_SYMBOL + n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });