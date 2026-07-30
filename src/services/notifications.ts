// M5.6 part 3 — the full local notification set. Cents is a coach, so the
// notifications behave like one: they check in, they recap, they warn before
// bills, and they celebrate progress. All on-device (works in Expo Go on iOS
// and the dev build; no push backend), all quiet banners, all governed by the
// single Profile notifications toggle.
//
// SCHEDULED (wipe-and-rescheduled by src/hooks/useNotificationSync.ts):
//   1. Bill due tomorrow: 9:00 AM the day before each budget dueDate.
//   2. Bill due today: 9:00 AM on the day itself.
//   3. Evening check-in: the NEXT 8:00 PM only. If the user already logged
//      something today, today's is skipped and tomorrow's is scheduled. Only
//      one is ever pending, so a user who stops opening the app gets exactly
//      one nudge and then silence, never a pile.
//   4. Weekly recap: next Sunday 7:00 PM, anchored to their goal by name.
//      Copy quotes no numbers, because content is frozen at schedule time and
//      a stale number would be a lie.
//
// EVENT-DRIVEN (fired by the store the moment data changes):
//   5. Budget at 90 percent / fully used (notifyBudgetCrossings).
//   6. Goal milestones at 25 / 50 / 75 / 100 percent (notifyGoalMilestones).
//      NOTE: nothing mutates goal.current yet, so this cannot fire until the
//      Goals redesign adds contributions; wire it there (see HANDOFF).
//
// IMPORTANT: this module must NOT import the finance store (the store imports
// the crossing notifiers from here; a cycle would break Hermes module init).
// Callers pass the data in.
import * as Notifications from 'expo-notifications';
import { Category, Goal, Transaction, peso } from '../models/types';

// Show alerts even while the app is foregrounded (quiet: no sound/badge).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let permissionGranted: boolean | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) { permissionGranted = true; return true; }
    if (!current.canAskAgain) { permissionGranted = false; return false; }
    const asked = await Notifications.requestPermissionsAsync();
    permissionGranted = asked.granted;
    return asked.granted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

const DAY = 86_400_000;

const at = (dayTs: number, hour: number): Date => {
  const d = new Date(dayTs);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// Rotating check-in lines so the nudge does not go stale. Deterministic by
// date, so reschedules on the same day keep the same words.
const CHECKIN_LINES = [
  'Log today while it is fresh and your picture stays honest.',
  'How did today treat your wallet? A ten second log keeps the math real.',
  'Anything spent or earned today? Tell Cents and your budgets stay true.',
  'One quick log tonight beats guessing at the end of the month.',
];

interface ScheduleInputs {
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];
  enabled: boolean;
}

// Rebuild every scheduled notification to match current data. Cheap (a
// handful of items), so wipe-and-reschedule keeps it simple and correct.
export async function syncScheduledNotifications({ categories, transactions, goals, enabled }: ScheduleInputs): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!enabled) return;
    if (!(await ensureNotificationPermission())) return;

    const now = Date.now();
    const schedule = (title: string, body: string, date: Date) =>
      Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });

    // 1 + 2. Bill reminders: the day before and the day of.
    for (const c of categories) {
      if (!c.dueDate) continue;
      const remaining = Math.max(c.limit - c.spent, 0);
      const dayBefore = at(c.dueDate - DAY, 9);
      if (dayBefore.getTime() > now) {
        await schedule(
          `${c.name} is due tomorrow`,
          remaining > 0
            ? `${peso(remaining)} of the ${peso(c.limit)} budget is still unspent.`
            : 'This budget is fully used, double-check the bill is covered.',
          dayBefore,
        );
      }
      const dayOf = at(c.dueDate, 9);
      if (dayOf.getTime() > now) {
        await schedule(`${c.name} is due today`, 'Settle it now and tell Cents so the budget stays true.', dayOf);
      }
    }

    // 3. Evening check-in: the next 8 PM, skipping today if already logged.
    const todayStart = at(now, 0).getTime();
    const loggedToday = transactions.some((tx) => tx.timestamp >= todayStart);
    let checkin = at(now, 20);
    if (checkin.getTime() <= now || loggedToday) checkin = at(now + DAY, 20);
    await schedule(
      'Evening check-in with Cents',
      CHECKIN_LINES[new Date(checkin).getDate() % CHECKIN_LINES.length],
      checkin,
    );

    // 4. Weekly recap: next Sunday 7 PM, goal-anchored, number-free.
    const d = new Date(now);
    const daysToSunday = (7 - d.getDay()) % 7;
    let recap = at(now + daysToSunday * DAY, 19);
    if (recap.getTime() <= now) recap = at(recap.getTime() + 7 * DAY, 19);
    const goal = goals[0];
    await schedule(
      'Your week with Cents',
      goal
        ? `Week wrapped. Open SaveCents to see how ${goal.name} moved.`
        : 'Week wrapped. Your savings chart has this week\u2019s story.',
      recap,
    );
  } catch {
    // Notifications are a courtesy; never let them break a money action.
  }
}

const fireNow = (title: string, body: string) =>
  (async () => {
    if (!(await ensureNotificationPermission())) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  })().catch(() => {});

// 5. Immediate alert when a spend pushes a budget across 90 percent (special
// copy at fully used). Compared by id so renames do not false-positive.
export function notifyBudgetCrossings(prev: Category[], next: Category[], enabled: boolean): void {
  if (!enabled) return;
  const before = new Map(prev.map((c) => [c.id, c]));
  for (const c of next) {
    if (c.limit <= 0) continue;
    const old = before.get(c.id);
    if (!old || old.limit <= 0) continue;
    const wasBelow = old.spent / old.limit < 0.9;
    const ratio = c.spent / c.limit;
    if (!wasBelow || ratio < 0.9) continue;
    const pct = Math.min(Math.round(ratio * 100), 100);
    const remaining = Math.max(c.limit - c.spent, 0);
    fireNow(
      ratio >= 1 ? `${c.name} budget fully used` : `${c.name} budget at ${pct} percent`,
      ratio >= 1
        ? `You have spent ${peso(c.spent)} of the ${peso(c.limit)} limit.`
        : `${peso(remaining)} left of ${peso(c.limit)} this month.`,
    );
  }
}

// 6. Goal milestone celebrations. Fires the HIGHEST newly crossed threshold
// so one big contribution produces one notification, not four.
const MILESTONES: { at: number; title: (g: Goal) => string; body: (g: Goal) => string }[] = [
  { at: 1, title: (g) => `${g.name}: goal reached`, body: (g) => `${peso(g.target)} saved. Time to enjoy what you built.` },
  { at: 0.75, title: (g) => `${g.name}: 75 percent there`, body: (g) => `${peso(Math.max(g.target - g.current, 0))} to go. The last stretch is the sweetest.` },
  { at: 0.5, title: (g) => `${g.name}: halfway`, body: (g) => `${peso(g.current)} saved of ${peso(g.target)}. Keep the pace.` },
  { at: 0.25, title: (g) => `${g.name}: first quarter done`, body: (g) => `${peso(g.current)} saved. Momentum looks good.` },
];

export function notifyGoalMilestones(prev: Goal[], next: Goal[], enabled: boolean): void {
  if (!enabled) return;
  const before = new Map(prev.map((g) => [g.id, g]));
  for (const g of next) {
    if (g.target <= 0) continue;
    const old = before.get(g.id);
    if (!old || old.target <= 0) continue;
    const oldRatio = old.current / old.target;
    const ratio = g.current / g.target;
    const hit = MILESTONES.find((m) => oldRatio < m.at && ratio >= m.at);
    if (hit) fireNow(hit.title(g), hit.body(g));
  }
}
