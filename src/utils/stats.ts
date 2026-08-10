// M5.6 truth pass — every number here is computed from REAL transactions.
// Replaces: the hardcoded Home savings chart data and the weekly=500 constant
// behind goal pacing. "Saved" always means net (income minus expenses) inside
// the bucket; chart bars clamp at zero, the note text keeps the honest sign.
import { SaveCadence, Transaction } from '../models/types';
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

// Planner v1: deadline driven goal plans.
// Goals created by the UI store a real `deadline` timestamp. Older goals only
// carry a display string in `date`, which historically came in TWO shapes:
// ISO "2026-12-10" (chat created) and "Mar 2026" (UI created). Hermes only
// reliably parses the ISO shape, so "MMM YYYY" is parsed by hand and lands on
// the END of that month (the generous reading of "by March").

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseGoalDate(date: string): number | null {
  const trimmed = (date ?? '').trim();
  if (!trimmed) return null;
  // "MMM YYYY" is checked FIRST: some engines parse it as the 1st of the
  // month, Hermes rejects it outright. Handling it by hand keeps every
  // platform on the same generous end of month reading.
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(trimmed);
  if (m) {
    const idx = MONTH_ABBR.indexOf(m[1].slice(0, 3).toLowerCase());
    // new Date(y, m+1, 0) = last day of month m. Noon avoids TZ edge cases.
    if (idx >= 0) { const d = new Date(+m[2], idx + 1, 0); d.setHours(12, 0, 0, 0); return d.getTime(); }
  }
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return iso;
  return null;
}

export function goalDeadline(g: { deadline?: number; date: string }): number | null {
  return g.deadline ?? parseGoalDate(g.date);
}

export type GoalStatus = 'reached' | 'pastDue' | 'onTrack' | 'behind' | 'noDeadline';

// How the plan copy talks about each rhythm ("save 500 a week").
export const CADENCE_NOUN: Record<SaveCadence, string> = {
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
};

// Weeks per unit, for converting the weekly rate into the user's rhythm.
// 4.345 = 365.25 / 12 / 7, the honest average weeks in a month.
const CADENCE_WEEKS: Record<SaveCadence, number> = { daily: 1 / 7, weekly: 1, monthly: 4.345 };

export interface GoalPlan {
  status: GoalStatus;
  // Save this much per week and the deadline is met. null when reached, past
  // due, or the deadline never parsed. Use cadenceAsk for the user's rhythm.
  neededWeekly: number | null;
  deadline: number | null;
  weeksLeft: number | null; // fractional, floored at 0
}

// The honest weekly ask: remaining amount over remaining weeks, compared to
// the user's REAL 28 day rate to say on track or behind. Deadlines closer
// than a week clamp to one week so the ask stays a sane weekly number.
export function goalPlan(
  g: { target: number; current: number; deadline?: number; date: string },
  weeklyRate: number,
  now = Date.now(),
): GoalPlan {
  const deadline = goalDeadline(g);
  if (g.current >= g.target) return { status: 'reached', neededWeekly: null, deadline, weeksLeft: null };
  if (deadline == null) return { status: 'noDeadline', neededWeekly: null, deadline: null, weeksLeft: null };
  const weeksLeft = Math.max((deadline - now) / (7 * DAY), 0);
  if (weeksLeft <= 0) return { status: 'pastDue', neededWeekly: null, deadline, weeksLeft: 0 };
  const neededWeekly = (g.target - g.current) / Math.max(weeksLeft, 1);
  return {
    status: weeklyRate >= neededWeekly ? 'onTrack' : 'behind',
    neededWeekly,
    deadline,
    weeksLeft,
  };
}

// The ask converted into the user's saving rhythm: remaining amount over the
// remaining units of that rhythm, each clamped to at least one unit so the
// number stays sane right before a deadline.
export function cadenceAsk(plan: GoalPlan, remaining: number, cadence: SaveCadence): number | null {
  if (plan.weeksLeft == null || plan.weeksLeft <= 0 || remaining <= 0) return null;
  const units = plan.weeksLeft / CADENCE_WEEKS[cadence];
  return remaining / Math.max(units, 1);
}

// The user's real saving rate expressed in the same rhythm.
export function cadenceRate(weeklyRate: number, cadence: SaveCadence): number {
  return weeklyRate * CADENCE_WEEKS[cadence];
}
