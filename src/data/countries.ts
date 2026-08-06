// Country registry: currency + most-used wallets/banks for one-tap account adding.
// Tiles use brand-colored monograms; swap in licensed logo assets here later.

export interface Institution {
  name: string;
  initial: string;
  color: string;
  // v4.5: bank = traditional, digital = digital-native bank, wallet =
  // e-wallet, fintech = cross-border money app, cash = physical.
  kind: 'wallet' | 'bank' | 'digital' | 'fintech' | 'cash';
  // v4.4: card network the institution commonly issues (drawn as a mark on
  // the card face; cash and remittance apps carry none).
  network?: 'visa' | 'mastercard';
}

export interface Country {
  code: string;
  name: string;
  flag: string;
  symbol: string;
  institutions: Institution[];
  locale: string;
}

export const COUNTRIES: Record<string, Country> = {
  PH: {
    code: 'PH', locale: 'en-PH', name: 'Philippines', flag: 'PH', symbol: '\u20B1',
    institutions: [
      // Traditional banks
      { name: 'BDO', initial: 'BD', color: '#003A70', kind: 'bank', network: 'mastercard' },
      { name: 'BPI', initial: 'B', color: '#B11116', kind: 'bank', network: 'mastercard' },
      { name: 'Metrobank', initial: 'M', color: '#00539F', kind: 'bank', network: 'mastercard' },
      { name: 'LandBank', initial: 'LB', color: '#007A33', kind: 'bank', network: 'mastercard' },
      { name: 'China Bank', initial: 'CB', color: '#D22630', kind: 'bank', network: 'mastercard' },
      { name: 'RCBC', initial: 'R', color: '#0033A0', kind: 'bank', network: 'mastercard' },
      { name: 'Security Bank', initial: 'SB', color: '#00A551', kind: 'bank', network: 'mastercard' },
      { name: 'PNB', initial: 'P', color: '#0057B8', kind: 'bank', network: 'mastercard' },
      { name: 'DBP', initial: 'DB', color: '#C8102E', kind: 'bank', network: 'mastercard' },
      { name: 'UnionBank', initial: 'U', color: '#FF6F00', kind: 'bank', network: 'visa' },
      { name: 'Citibank', initial: 'C', color: '#056DAE', kind: 'bank', network: 'visa' },
      { name: 'Bank of China', initial: 'BC', color: '#C41E2F', kind: 'bank' },
      { name: 'Maybank', initial: 'MY', color: '#FFC20E', kind: 'bank', network: 'visa' },
      // Digital banks
      { name: 'GoTyme', initial: 'GT', color: '#00C2C7', kind: 'digital', network: 'visa' },
      { name: 'MariBank', initial: 'MR', color: '#00D0C2', kind: 'digital', network: 'mastercard' },
      { name: 'Maya Bank', initial: 'MB', color: '#12B76A', kind: 'digital', network: 'visa' },
      { name: 'CIMB Bank', initial: 'CI', color: '#ED1C24', kind: 'digital', network: 'visa' },
      { name: 'Atome', initial: 'A', color: '#C3D600', kind: 'digital', network: 'mastercard' },
      { name: 'SeaBank', initial: 'SE', color: '#F94D2A', kind: 'digital', network: 'mastercard' },
      // Cross-border fintech
      { name: 'Wise', initial: 'W', color: '#9FE870', kind: 'fintech', network: 'mastercard' },
      { name: 'Payoneer', initial: 'PY', color: '#FF4800', kind: 'fintech', network: 'mastercard' },
      { name: 'Airwallex', initial: 'AW', color: '#612EFF', kind: 'fintech', network: 'visa' },
      { name: 'Revolut', initial: 'RV', color: '#16161A', kind: 'fintech', network: 'visa' },
      { name: 'Remitly', initial: 'RM', color: '#3748AC', kind: 'fintech' },
      // E-wallets
      { name: 'GCash', initial: 'G', color: '#0071F2', kind: 'wallet', network: 'visa' },
      { name: 'Maya', initial: 'MA', color: '#12B76A', kind: 'wallet', network: 'visa' },
      { name: 'GrabPay', initial: 'GP', color: '#00B14F', kind: 'wallet', network: 'mastercard' },
      { name: 'ShopeePay', initial: 'SP', color: '#EE4D2D', kind: 'wallet' },
      { name: 'Cash', initial: '\u20B1', color: '#2E9E5B', kind: 'cash' },
    ],
  },
  US: {
    code: 'US', locale: 'en-US', name: 'United States', flag: '🇺🇸', symbol: '$',
    institutions: [
      { name: 'Chase', initial: 'C', color: '#117ACA', kind: 'bank', network: 'visa' },
      { name: 'Bank of America', initial: 'BA', color: '#E31837', kind: 'bank', network: 'visa' },
      { name: 'Wells Fargo', initial: 'W', color: '#D71E28', kind: 'bank', network: 'visa' },
      { name: 'Venmo', initial: 'V', color: '#3D95CE', kind: 'wallet', network: 'mastercard' },
      { name: 'Cash App', initial: '$', color: '#00D632', kind: 'wallet', network: 'visa' },
      { name: 'PayPal', initial: 'P', color: '#003087', kind: 'wallet', network: 'mastercard' },
      { name: 'Cash', initial: '$', color: '#10B981', kind: 'cash' },
    ],
  },
  SG: {
    code: 'SG', locale: 'en-SG', name: 'Singapore', flag: '🇸🇬', symbol: 'S$',
    institutions: [
      { name: 'DBS', initial: 'D', color: '#ED1B24', kind: 'bank', network: 'visa' },
      { name: 'OCBC', initial: 'O', color: '#EE0000', kind: 'bank', network: 'visa' },
      { name: 'UOB', initial: 'U', color: '#002B5C', kind: 'bank', network: 'visa' },
      { name: 'GrabPay', initial: 'GP', color: '#00B14F', kind: 'wallet', network: 'mastercard' },
      { name: 'Cash', initial: 'S$', color: '#10B981', kind: 'cash' },
    ],
  },
  MY: {
    code: 'MY', locale: 'ms-MY', name: 'Malaysia', flag: '🇲🇾', symbol: 'RM',
    institutions: [
      { name: 'Maybank', initial: 'M', color: '#FFC20E', kind: 'bank', network: 'visa' },
      { name: 'CIMB', initial: 'C', color: '#ED1C24', kind: 'bank', network: 'visa' },
      { name: "Touch 'n Go", initial: 'T', color: '#1A56DB', kind: 'wallet' },
      { name: 'GrabPay', initial: 'GP', color: '#00B14F', kind: 'wallet', network: 'mastercard' },
      { name: 'Public Bank', initial: 'PB', color: '#C8102E', kind: 'bank', network: 'visa' },
      { name: 'Cash', initial: 'RM', color: '#10B981', kind: 'cash' },
    ],
  },
};

export function institutionFor(country: string, name: string): Institution | undefined {
  return COUNTRIES[country]?.institutions.find((i) => i.name === name);
}

// Standard budgeting categories. Cents auto-files scanned/spoken expenses into
// these; "Others" catches anything that doesn't fit a necessity category.
export interface BudgetCategory {
  name: string;
  icon: string; // Ionicons name
}

export const BUDGET_CATEGORIES: BudgetCategory[] = [
  { name: 'Housing', icon: 'home' },
  { name: 'Utilities', icon: 'flash' },
  { name: 'Groceries', icon: 'cart' },
  { name: 'Transport', icon: 'car' },
  { name: 'Dining', icon: 'restaurant' },
  { name: 'Health', icon: 'medkit' },
  { name: 'Education', icon: 'school' },
  { name: 'Family', icon: 'people' },
  { name: 'Pets', icon: 'paw' },
  { name: 'Subscriptions', icon: 'tv' },
  { name: 'Shopping', icon: 'bag-handle' },
  { name: 'Entertainment', icon: 'film' },
  { name: 'Gaming', icon: 'game-controller' },
  { name: 'Travel', icon: 'airplane' },
  { name: 'Savings', icon: 'wallet' },
  { name: 'Others', icon: 'pricetag' },
];
