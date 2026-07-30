// Country registry: currency + most-used wallets/banks for one-tap account adding.
// Tiles use brand-colored monograms; swap in licensed logo assets here later.

export interface Institution {
  name: string;
  initial: string;
  color: string;
  kind: 'wallet' | 'bank' | 'cash';
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
    code: 'PH', locale: 'en-PH', name: 'Philippines', flag: '🇵🇭', symbol: '₱',
    institutions: [
      { name: 'GCash', initial: 'G', color: '#0071F2', kind: 'wallet' },
      { name: 'Maya', initial: 'M', color: '#12B76A', kind: 'wallet' },
      { name: 'GoTyme', initial: 'GT', color: '#00C2C7', kind: 'bank' },
      { name: 'BPI', initial: 'B', color: '#B11116', kind: 'bank' },
      { name: 'BDO', initial: 'BD', color: '#003A70', kind: 'bank' },
      { name: 'UnionBank', initial: 'U', color: '#FF6F00', kind: 'bank' },
      { name: 'SeaBank', initial: 'S', color: '#F94D2A', kind: 'bank' },
      { name: 'CIMB', initial: 'C', color: '#ED1C24', kind: 'bank' },
      { name: 'Cash', initial: '₱', color: '#10B981', kind: 'cash' },
    ],
  },
  US: {
    code: 'US', locale: 'en-US', name: 'United States', flag: '🇺🇸', symbol: '$',
    institutions: [
      { name: 'Chase', initial: 'C', color: '#117ACA', kind: 'bank' },
      { name: 'Bank of America', initial: 'BA', color: '#E31837', kind: 'bank' },
      { name: 'Wells Fargo', initial: 'W', color: '#D71E28', kind: 'bank' },
      { name: 'Venmo', initial: 'V', color: '#3D95CE', kind: 'wallet' },
      { name: 'Cash App', initial: '$', color: '#00D632', kind: 'wallet' },
      { name: 'PayPal', initial: 'P', color: '#003087', kind: 'wallet' },
      { name: 'Cash', initial: '$', color: '#10B981', kind: 'cash' },
    ],
  },
  SG: {
    code: 'SG', locale: 'en-SG', name: 'Singapore', flag: '🇸🇬', symbol: 'S$',
    institutions: [
      { name: 'DBS', initial: 'D', color: '#ED1B24', kind: 'bank' },
      { name: 'OCBC', initial: 'O', color: '#EE0000', kind: 'bank' },
      { name: 'UOB', initial: 'U', color: '#002B5C', kind: 'bank' },
      { name: 'GrabPay', initial: 'GP', color: '#00B14F', kind: 'wallet' },
      { name: 'Cash', initial: 'S$', color: '#10B981', kind: 'cash' },
    ],
  },
  MY: {
    code: 'MY', locale: 'ms-MY', name: 'Malaysia', flag: '🇲🇾', symbol: 'RM',
    institutions: [
      { name: 'Maybank', initial: 'M', color: '#FFC20E', kind: 'bank' },
      { name: 'CIMB', initial: 'C', color: '#ED1C24', kind: 'bank' },
      { name: "Touch 'n Go", initial: 'T', color: '#1A56DB', kind: 'wallet' },
      { name: 'GrabPay', initial: 'GP', color: '#00B14F', kind: 'wallet' },
      { name: 'Public Bank', initial: 'PB', color: '#C8102E', kind: 'bank' },
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
