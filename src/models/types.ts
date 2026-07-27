// Ported from Models.kt

export interface Account {
  id: string;
  name: string;
  balance: number;
  color?: string;
  initial?: string;
}

export interface Category {
  id: string;
  name: string;
  limit: number;
  spent: number;
  icon: string;
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
}

export type Sender = 'USER' | 'CENTS';

export type ActionType =
  | { kind: 'UpdateBudget'; categoryName: string; newLimit: number }
  | { kind: 'LogTransaction'; amount: number; categoryName: string }
  | { kind: 'AddCategory'; name: string; limit: number }
  | { kind: 'RemoveCategory'; name: string }
  | { kind: 'NegotiatePurchase'; item: string; amount: number; categoryName: string }
  | { kind: 'CreateAndLog'; item: string; amount: number }
  | { kind: 'LogToUnassigned'; item: string; amount: number }
  | { kind: 'LogToOthers'; item: string; amount: number };

interface ChatBase {
  id: string;
  sender: Sender;
}

export type ChatMessage =
  | (ChatBase & { type: 'text'; text: string; imageUri?: string })
  | (ChatBase & { type: 'confirmation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil' })
  | (ChatBase & { type: 'negotiation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil' })
  | (ChatBase & { type: 'receiptScan'; amount: number; store: string; confirmed: boolean; handled: boolean })
  | (ChatBase & { type: 'consultItem'; item: string; amount: number; delayWeeks: number; goalName: string; confirmed: boolean; handled: boolean })
  | (ChatBase & { type: 'mismatch'; item: string; amount: number; confirmed: boolean; handled: boolean });

export interface UserProfile {
  name: string;
  email: string;
  isLoggedIn: boolean;
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

let CURRENCY_SYMBOL = '\u20B1';
export const setCurrencySymbol = (s: string) => { CURRENCY_SYMBOL = s; };
export const peso = (n: number) =>
  CURRENCY_SYMBOL + n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });