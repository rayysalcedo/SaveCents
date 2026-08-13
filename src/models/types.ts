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
  // Wallet v5 (owner request): the day of month the statement is DUE to be
  // paid (1..31). When the billing day arrives, the app turns whatever is
  // owed into a "<Card> Bill" budget carrying this due date with reminders
  // on, so the bill shows up in the Budgets list like any other due.
  dueDay?: number;
  // YYYY-MM of the last statement budget generated, so the sweep runs once
  // per card per month no matter how often the app opens.
  lastStatement?: string;
  network?: 'visa' | 'mastercard' | 'none'; // card mark; defaults from the institution
  // v4.7: ISO currency code for this balance. Absent = the home currency.
  currency?: string;
  // v4.8: tells multiple cards from the same bank apart ("Salary", "Joint").
  nickname?: string;
}

export interface Category {
  id: string;
  name: string;      // display name of the budget (defaults to the category)
  limit: number;
  spent: number;
  icon: string;
  category?: string; // base category used for icons and AI filing
  dueDate?: number;  // optional bill due date (ms since epoch)
  // Planner v2.1: how the due date behaves. 'monthly' recurs on dueDay every
  // month (no year needed, resets with the budget month). 'once' is a single
  // date that clears itself after its month passes. Absent = monthly, which
  // matches how rollover always treated due dates.
  dueType?: 'once' | 'monthly';
  dueDay?: number;   // 1-31, the intended day for monthly dues (clamped to short months)
  // Planner v2: whether the 7-3-1 due date reminders fire for this budget.
  // Absent = true, so every existing budget with a due date keeps reminding.
  remind?: boolean;
  // Planner v2.3: auto-pay for monthly bills. On the due day, whatever is
  // left of the budget gets logged as an expense from autoPayAccountId. If
  // that account cannot cover it, the user gets a heads up instead, and the
  // charge logs itself as soon as balance lands (rechecked on app open and
  // whenever income arrives).
  autoPay?: boolean;
  autoPayAccountId?: string;
  autoPayLast?: string;         // YYYY-MM of the last successful auto-pay
  autoPayFailNotified?: string; // YYYY-MM we already flagged as short on balance
  // Wallet v5: set = this budget IS a credit card's statement bill, created
  // by runCreditStatementsIfDue for that card. Expenses logged to it from a
  // DIFFERENT account count as payments and reduce the card's owed balance,
  // so the budget and the card always tell the same story.
  creditAccountId?: string;
}

export type SaveCadence = 'daily' | 'weekly' | 'monthly';

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  date: string;
  // Planner v1: real deadline timestamp (ms). `date` stays the display string
  // for backward compatibility; older goals without this field get their
  // deadline re-derived from `date` by parseGoalDate (src/utils/stats.ts).
  deadline?: number;
  // Planner v1.1: how often the user plans to add savings. Drives the ask
  // ("save 200 a day" vs "save 6,000 a month"). Absent = weekly.
  cadence?: SaveCadence;
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
  // v5.38: dueDay set = create a BILL (dated budget, monthly due, reminders
  // on); absent = a plain spending envelope. Same discriminator the Budgets
  // tabs use, so Cents-created budgets land in the right tab.
  | { kind: 'AddCategory'; name: string; limit: number; dueDay?: number }
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
  | { kind: 'SetAccountBalance'; accountName: string; amount: number }
  // M5.34 (Cents parity phase 1): ledger edits and budget due dates by chat
  // or voice. Transactions are RESOLVED AT ASK TIME (buildReplyFromResult
  // stamps the exact txId) so the confirmed action can never hit the wrong
  // row; label carries the human description for acks.
  | { kind: 'RemoveTransaction'; txId: string; label: string }
  | { kind: 'UpdateTransaction'; txId: string; newAmount: number; label: string }
  | { kind: 'SetBudgetDue'; categoryName: string; dueDay: number; remind?: boolean }
  // v5.43: read-only - arms the Transactions tab's filters (search text
  // and/or a budget) so "show my Grab expenses" lands on a filtered ledger.
  | { kind: 'ShowTransactions'; query?: string; categoryName?: string };

interface ChatBase {
  id: string;
  sender: Sender;
}

export type ChatMessage =
  | (ChatBase & {
      type: 'text'; text: string; imageUri?: string;
      // v5.9: when Cents asks about a FIXED thing (cards, goals, budgets),
      // the store attaches tappable options so nobody types names out.
      choices?: { label: string; send: string }[];
    })
  // M5.19: coachNote = an insight/recommendation written at ASK time but
  // delivered only AFTER the user confirms (ask first, coach after).
  | (ChatBase & { type: 'confirmation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil'; coachNote?: string })
  | (ChatBase & { type: 'negotiation'; prompt: string; action: ActionType; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil'; coachNote?: string })
  // M5.34 (owner request): a multi-item ask is ONE summary card. steps are
  // the human lines shown as a numbered plan; actions execute in order on a
  // single yes, through the same executeAction chokepoint as everything.
  | (ChatBase & { type: 'batchConfirmation'; prompt: string; steps: string[]; actions: ActionType[]; confirmed: boolean; handled: boolean; lang?: 'en' | 'fil'; coachNote?: string })
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

// Planner v3: split the bill. The payer covered the whole thing; `people`
// are the OTHERS who owe their share back. headcount includes the payer so
// the math display stays honest (total / headcount = share).
export interface SplitPerson {
  id: string;
  name: string;
  email?: string;
  share: number;
  paid: boolean;
  emailedAt?: number; // last time their share was emailed
  txId?: string;      // me mode: the income logged when they repaid
}

// Planner v4: Lend. Money handed out that should come back. Unpaid past the
// due date is money at risk; repaid flows straight back into an account and
// the savings math. Borrower emails (7, 3 and 1 days before due) only go out
// when the user confirms the borrower agreed to be contacted, they only ever
// go to the borrower, and the tone stays a polite reminder.
export interface Lend {
  id: string;
  name: string;        // who borrowed
  email?: string;
  amount: number;
  dueDate: number;     // ms since epoch
  note?: string;
  createdAt: number;
  accountId?: string;  // where the money left from (absent = track only)
  expenseTxId?: string;
  repaid: boolean;
  repaidAt?: number;
  repaidTxId?: string;
  consent?: boolean;      // borrower agreed to email reminders
  sentStages?: number[];  // which of the 7-3-1 reminders already went out
}

export interface SplitBill {
  id: string;
  title: string;     // what it was, e.g. Dinner at Mesa
  total: number;
  payerName: string; // who covered it
  headcount: number; // total people including the payer
  people: SplitPerson[];
  createdAt: number;
  // Planner v3.2: who covered the bill decides how money flows.
  // 'me': the user paid. The total logs as an expense from payerAccountId,
  //   and each repayment logs as income when the user confirms it received.
  // 'other': someone else paid. They get a private manage link; the user's
  //   own share (if included) logs as an expense when they pay it.
  // Absent = a v3 legacy split: plain ticks, no money logging.
  mode?: 'me' | 'other';
  // Planner v5: how shares were decided. 'even' divides the total equally
  // (the only pre-v5 behavior, so absent = even); 'custom' means each person
  // owes the specific amount typed in for them, with the payer covering the
  // remainder of the total.
  splitKind?: 'even' | 'custom';
  // Planner v5: the user's own share in other mode. Absent = the even share
  // (pre-v5 bills), which is what paySplitMyShare used to read off people[0].
  myShareAmount?: number;
  payerEmail?: string;     // other mode
  payerAccountId?: string; // me mode: the account the bill came out of
  expenseTxId?: string;    // me mode: the logged total expense
  myShare?: { included: boolean; paid: boolean; txId?: string }; // other mode
  remoteToken?: string;    // other mode: the worker side bill token
}

let CURRENCY_SYMBOL = '\u20B1';
export const setCurrencySymbol = (s: string) => { CURRENCY_SYMBOL = s; };

// M5.6: number grouping follows the selected country instead of a hardcoded
// en-PH (setCountry and store rehydration both call setNumberLocale).
let NUMBER_LOCALE = 'en-PH';
export const setNumberLocale = (l: string) => { NUMBER_LOCALE = l; };
export const peso = (n: number) =>
  CURRENCY_SYMBOL + n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// v4.7: currencies an account balance can be held in. The home currency is
// whatever the selected country uses; foreign balances format with their own
// symbol and stay out of home-currency totals (no invented FX rates).
export const CURRENCIES: { code: string; symbol: string; name: string }[] = [
  { code: 'PHP', symbol: '\u20B1', name: 'Philippine peso' },
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '\u20AC', name: 'Euro' },
  { code: 'GBP', symbol: '\u00A3', name: 'British pound' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit' },
  { code: 'JPY', symbol: '\u00A5', name: 'Japanese yen' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar' },
];
export const currencySymbol = (code?: string) =>
  CURRENCIES.find((c) => c.code === code)?.symbol ?? CURRENCY_SYMBOL;
export const fmtMoney = (n: number, code?: string) =>
  currencySymbol(code) + n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });