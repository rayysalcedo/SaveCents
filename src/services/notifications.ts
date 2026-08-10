// M5.6 part 3 — the full local notification set. Cents is a coach, so the
// notifications behave like one: they check in, they recap, they warn before
// bills, and they celebrate progress. All on-device (works in Expo Go on iOS
// and the dev build; no push backend), all quiet banners, all governed by the
// single Profile notifications toggle.
//
// SCHEDULED (wipe-and-rescheduled by src/hooks/useNotificationSync.ts).
// Because there is no push backend, away-time nudges work as a dead man's
// switch: every app open plants the chain below into the OS, and the next
// open wipes and replants it from day zero. Keep using the app and the chain
// silently resets; go quiet and it fires on its own.
//   1. Bill countdown: 9:00 AM at 7, 3 and 1 days before each budget
//      dueDate, honoring the per-budget remind toggle (absent = on).
//   2. Bill due today: 9:00 AM on the day itself.
//   3. Forever check-ins: WEEKLY repeating triggers on Monday, Thursday and
//      Saturday at 8:00 PM. Registered once with the OS, they fire every
//      week indefinitely with no app open needed. Repeats cannot be skipped
//      per-day and their copy is fixed until the next open refreshes it, so
//      they carry evergreen goal-anchored lines only.
//   4. Daily log nudge: 8:00 PM one-shots for days 0 through 6, filling the
//      first week's gaps on days the repeats do not cover, so unlogged
//      expenses and income never sit longer than a day while the habit is
//      forming. Tonight's is skipped if something was already logged today.
//   5. Week-away check-in: day 7 at 10:00 AM, a single warmer goal-anchored
//      nudge for someone who has not opened the app all week. A morning
//      slot, so it never stacks on an evening repeat.
//   6. Weekly recap: WEEKLY repeating trigger, Sunday 7:00 PM, anchored to
//      their goal by name, forever.
//      All away copy quotes no numbers, because content is frozen at
//      schedule time and a stale number would be a lie.
//
// EVENT-DRIVEN (fired by the store the moment data changes):
//   7. Budget at 90 percent / fully used (notifyBudgetCrossings).
//   8. Goal milestones at 25 / 50 / 75 / 100 percent (notifyGoalMilestones).
//      NOTE: nothing mutates goal.current yet, so this cannot fire until the
//      Goals redesign adds contributions; wire it there (see HANDOFF).
//
// IMPORTANT: this module must NOT import the finance store (the store imports
// the crossing notifiers from here; a cycle would break Hermes module init).
// Callers pass the data in.
import * as Notifications from 'expo-notifications';
import { Category, Goal, Lend, Transaction, peso } from '../models/types';

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

// Rotating nudge lines so a week of dailies does not go stale. Deterministic
// by fire date, so reschedules on the same day keep the same words. No
// numbers anywhere: content freezes at schedule time (see header).
const CHECKIN_LINES = [
  'Log today while it is fresh and your picture stays honest.',
  'How did today treat your wallet? A ten second log keeps the math real.',
  'Anything spent or earned today? Tell Cents and your budgets stay true.',
  'One quick log tonight beats guessing at the end of the month.',
  'Any expenses or income still in your head? Give them to Cents.',
  'A day unlogged is a day guessed. Ten seconds fixes that.',
  'Small spends count too. Log them and keep the month honest.',
];

// Goal-anchored variants, mixed into the rotation when a goal exists.
const GOAL_CHECKIN_LINES: ((name: string) => string)[] = [
  (name) => `${name} moves when you log. Even a small entry counts today.`,
  (name) => `Quick check-in: anything spent or saved for ${name} today?`,
  (name) => `${name} is built one honest log at a time. Add today's.`,
];

interface ScheduleInputs {
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];
  lends?: Lend[];
  enabled: boolean;
}

// Rebuild every scheduled notification to match current data. Cheap (a
// handful of items), so wipe-and-reschedule keeps it simple and correct.
export async function syncScheduledNotifications({ categories, transactions, goals, lends = [], enabled }: ScheduleInputs): Promise<void> {
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

    // 1 + 2. Bill reminders: 7, 3 and 1 days before the due date, then the
    // day itself, all at 9 AM. A budget can opt out with remind: false
    // (absent = on). Copy quotes remaining budget, safe to freeze because the
    // whole chain is wiped and replanted on every app open.
    for (const c of categories) {
      if (!c.dueDate || c.remind === false) continue;
      const remaining = Math.max(c.limit - c.spent, 0);
      const dueLabel = new Date(c.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const leadBody = remaining > 0
        ? `${peso(remaining)} of the ${peso(c.limit)} budget is still unspent.`
        : 'This budget is fully used, double-check the bill is covered.';
      for (const lead of [7, 3, 1]) {
        const when = at(c.dueDate - lead * DAY, 9);
        if (when.getTime() <= now) continue;
        await schedule(
          lead === 1 ? `${c.name} is due tomorrow` : `${c.name} is due in ${lead} days`,
          lead === 1 ? leadBody : `Due ${dueLabel}. ${leadBody}`,
          when,
        );
      }
      const dayOf = at(c.dueDate, 9);
      if (dayOf.getTime() > now) {
        await schedule(`${c.name} is due today`, 'Settle it now and tell Cents so the budget stays true.', dayOf);
      }
    }

    // 2b. Planner v4: lend paybacks. The USER gets 7, 3 and 1 day pings
    // before each unpaid lend's due date, plus the day itself, at 9 AM.
    // These are local notifications for the user only; borrower emails are a
    // separate, consented flow (see src/services/lend.ts).
    for (const l of lends) {
      if (l.repaid || !l.dueDate) continue;
      const dueLabel = new Date(l.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      for (const lead of [7, 3, 1]) {
        const when = at(l.dueDate - lead * DAY, 9);
        if (when.getTime() <= now) continue;
        await schedule(
          lead === 1 ? `${l.name}'s payback is due tomorrow` : `${l.name}'s payback is due in ${lead} days`,
          `${peso(l.amount)} due ${dueLabel}. A friendly nudge now beats an awkward one later.`,
          when,
        );
      }
      const dayOf = at(l.dueDate, 9);
      if (dayOf.getTime() > now) {
        await schedule(`${l.name}'s payback is due today`, `${peso(l.amount)} is due back today. Tick it off in Planner once it lands.`, dayOf);
      }
    }

    // 3. Forever check-ins: weekly repeats on Monday, Thursday and Saturday
    // at 8 PM. The OS fires these every week indefinitely; no app open is
    // ever needed again. Copy is evergreen and refreshed on every open (so
    // a renamed goal heals on the next launch).
    const topGoal = goals[0];
    const scheduleWeekly = (body: string, weekday: number, hour: number, title = 'Evening check-in with Cents') =>
      Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour, minute: 0 },
      });
    // Expo weekday numbering: 1 = Sunday ... 7 = Saturday.
    const REPEAT_WEEKDAYS = [2, 5, 7]; // Monday, Thursday, Saturday
    await scheduleWeekly(
      topGoal ? GOAL_CHECKIN_LINES[0](topGoal.name) : CHECKIN_LINES[0],
      2, 20,
    );
    await scheduleWeekly(
      topGoal ? GOAL_CHECKIN_LINES[1](topGoal.name) : CHECKIN_LINES[1],
      5, 20,
    );
    await scheduleWeekly(CHECKIN_LINES[3], 7, 20);

    // 4. Daily log nudges: 8 PM one-shots for days 0 through 6, but only on
    // days the weekly repeats do not already cover, so no evening ever gets
    // two banners. Tonight's is skipped if something was already logged.
    const todayStart = at(now, 0).getTime();
    const loggedToday = transactions.some((tx) => tx.timestamp >= todayStart);
    for (let offset = 0; offset <= 6; offset += 1) {
      const nudge = at(now + offset * DAY, 20);
      if (nudge.getTime() <= now) continue;
      if (offset === 0 && loggedToday) continue;
      if (REPEAT_WEEKDAYS.includes(nudge.getDay() + 1)) continue;
      const dayIndex = nudge.getDate();
      const body = topGoal && dayIndex % 3 === 0
        ? GOAL_CHECKIN_LINES[dayIndex % GOAL_CHECKIN_LINES.length](topGoal.name)
        : CHECKIN_LINES[dayIndex % CHECKIN_LINES.length];
      await schedule('Evening check-in with Cents', body, nudge);
    }

    // 5. Week-away check-in: day 7 at 10 AM. Only reachable by someone who
    // has not opened the app all week, so the tone is a welcome back, not a
    // scold. Morning slot keeps it clear of the evening repeats.
    const winBack = at(now + 7 * DAY, 10);
    await schedule(
      'A quiet week at SaveCents',
      topGoal
        ? `${topGoal.name} is still waiting for you. A ten second log picks it right back up.`
        : 'Your budgets are still here. A ten second log picks things right back up.',
      winBack,
    );

    // 6. Weekly recap: Sunday 7 PM, repeating forever. Goal-anchored,
    // number-free, refreshed on every open.
    await scheduleWeekly(
      topGoal
        ? `Week wrapped. Open SaveCents to see how ${topGoal.name} moved.`
        : 'Week wrapped. Your savings chart has this week\u2019s story.',
      1, 19,
      'Your week with Cents',
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

// Planner v2.3: immediate banner for auto-pay outcomes (paid, or short on
// balance). Same fire-and-forget contract as every other notifier here.
export function notifyAutoPay(title: string, body: string, enabled: boolean): void {
  if (!enabled) return;
  fireNow(title, body);
}

// 7. Immediate alert when a spend pushes a budget across 90 percent (special
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

// 8. Goal milestone celebrations. Fires the HIGHEST newly crossed threshold
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
