// M5.6 truth pass — every number here is computed from REAL transactions.
// Replaces: the hardcoded Home savings chart data and the weekly=500 constant
// behind goal pacing. "Saved" always means net (income minus expenses) inside
// the bucket; chart bars clamp at zero, the note text keeps the honest sign.
import { Transaction } from '../models/types';
import { peso } from '../models/types';

export type SavingsPeriod = 'D' | 'W' | 'M' | 'Y';

interface Bucket { label: string; from: number; to: number }

const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Monday-start weeks, matching how PH payroll weeks are usually read.
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const shift = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  return d.getTime() - shift * DAY;
}

function startOfMonth(y: number, m: number): number {
  return new Date(y, m, 1).getTime();
}

function buckets(period: SavingsPeriod, now = Date.now()): Bucket[] {
  const out: Bucket[] = [];
  if (period === 'D') {
    // Last 7 days ending today, labeled by weekday.
    for (let i = 6; i >= 0; i--) {
      const from = startOfDay(now) - i * DAY;
      out.push({
        label: new Date(from).toLocaleDateString('en-US', { weekday: 'short' }),
        from,
        to: from + DAY,
      });
    }
  } else if (period === 'W') {
    // Last 5 weeks ending with the current one.
    const thisWeek = startOfWeek(now);
    for (let i = 4; i >= 0; i--) {
      const from = thisWeek - i * 7 * DAY;
      out.push({ label: `W${5 - i}`, from, to: from + 7 * DAY });
    }
  } else if (period === 'M') {
    // Last 5 calendar months ending with the current one.
    const d = new Date(now);
    for (let i = 4; i >= 0; i--) {
      const y = d.getFullYear();
      const m = d.getMonth() - i;
      const from = startOfMonth(y, m);
      const to = startOfMonth(y, m + 1);
      out.push({ label: new Date(from).toLocaleDateString('en-US', { month: 'short' }), from, to });
    }
  } else {
    // Last 5 calendar years ending with the current one.
    const y = new Date(now).getFullYear();
    for (let i = 4; i >= 0; i--) {
      out.push({
        label: String(y - i),
        from: new Date(y - i, 0, 1).getTime(),
        to: new Date(y - i + 1, 0, 1).getTime(),
      });
    }
  }
  return out;
}

function netInRange(txs: Transaction[], from: number, to: number): number {
  let net = 0;
  for (const tx of txs) {
    if (tx.timestamp >= from && tx.timestamp < to) net += tx.isIncome ? tx.amount : -tx.amount;
  }
  return net;
}

export interface SavingsPoint { label: string; value: number; net: number }

// Chart-ready series: `value` clamps at 0 so bars stay drawable, `net` keeps
// the true signed number for copy.
export function savingsSeries(txs: Transaction[], period: SavingsPeriod, now = Date.now()): SavingsPoint[] {
  return buckets(period, now).map((b) => {
    const net = netInRange(txs, b.from, b.to);
    return { label: b.label, value: Math.max(net, 0), net };
  });
}

const PERIOD_NOUN: Record<SavingsPeriod, [string, string]> = {
  D: ['today', 'yesterday'],
  W: ['this week', 'last week'],
  M: ['this month', 'last month'],
  Y: ['this year', 'last year'],
};

// Honest one-liner under the chart: the latest bucket's real net plus a plain
// comparison to the bucket before it. No invented streaks or superlatives.
export function savingsNote(series: SavingsPoint[], period: SavingsPeriod): string {
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const [nowWord, prevWord] = PERIOD_NOUN[period];
  const amount = cur.net < 0 ? `${peso(Math.abs(cur.net))} more spent than saved` : `${peso(cur.net)} saved`;
  if (!prev || (cur.net === 0 && prev.net === 0)) {
    return `${amount} ${nowWord}. Log expenses and income and this chart tracks them.`;
  }
  if (cur.net === prev.net) return `${amount} ${nowWord}, level with ${prevWord}.`;
  return `${amount} ${nowWord}, ${cur.net > prev.net ? 'up' : 'down'} from ${prevWord}.`;
}

// True weekly saving pace: net over the last 28 days divided by 4. Returns 0
// when the window nets zero or negative — callers must treat 0 as "no pace"
// rather than dividing by it.
export function weeklySavingsRate(txs: Transaction[], now = Date.now()): number {
  const net = netInRange(txs, now - 28 * DAY, now + 1);
  return net > 0 ? net / 4 : 0;
}

// Label for goal cards: real weeks-remaining at the real pace, or honest
// fallbacks instead of a made-up number.
export function paceLabel(target: number, current: number, rate: number): string {
  if (current >= target) return 'Reached';
  if (rate <= 0) return 'No pace yet';
  return `${Math.ceil((target - current) / rate)} wks left`;
}
