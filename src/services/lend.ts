// Planner v4: borrower payback reminders.
// Hard rules baked in here, not left to callers:
//   - Emails go ONLY to the borrower, never anyone else.
//   - Automatic sends need consent recorded on the lend AND fire at most
//     once per 7-3-1 stage, so three automatic emails total per due date.
//   - Sends happen between 8 AM and 8 PM local; outside that they wait for
//     the next sweep.
//   - Tone lives in the worker template and stays a neutral reminder.
// Manual sends from the card use the same endpoint (with the mail app as a
// fallback), so the user can always nudge by hand regardless of consent,
// which is then a person to person email like any other.
import { Linking } from 'react-native';
import { Lend, peso } from '../models/types';
import { WORKER_ENDPOINT } from './otp';

export interface LendEmailPayload {
  email: string;
  name: string;
  userName: string;
  amountFmt: string;
  dueLabel: string;
}

export async function sendLendReminder(p: LendEmailPayload): Promise<'sent' | 'failed'> {
  if (!WORKER_ENDPOINT) return 'failed';
  try {
    const res = await fetch(`${WORKER_ENDPOINT}/send-lend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) {
      console.log('[lend] send failed', res.status, await res.text().catch(() => ''));
      return 'failed';
    }
    const data = await res.json();
    return data?.ok ? 'sent' : 'failed';
  } catch (e) {
    console.log('[lend] network error', String(e));
    return 'failed';
  }
}

export function lendMailto(p: LendEmailPayload): string {
  const subject = `Friendly reminder: ${p.amountFmt} due ${p.dueLabel}`;
  const body = [
    `Hi ${p.name},`,
    '',
    `Just a friendly reminder about the ${p.amountFmt} ${p.userName} lent you, due ${p.dueLabel}.`,
    '',
    `Once you've sent it, let ${p.userName} know directly.`,
    '',
    `${p.userName}`,
  ].join('\n');
  return `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openLendMail(p: LendEmailPayload): Promise<boolean> {
  try {
    await Linking.openURL(lendMailto(p));
    return true;
  } catch {
    return false;
  }
}

const DAY = 86_400_000;
const STAGES = [7, 3, 1];

export function payloadFor(l: Lend, userName: string): LendEmailPayload | null {
  if (!l.email) return null;
  return {
    email: l.email,
    name: l.name,
    userName,
    amountFmt: peso(l.amount),
    dueLabel: new Date(l.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

// The automatic sweep. Called from the notification sync hook whenever data
// changes (debounced there). Fire and forget; a stage only gets marked sent
// after the worker confirms, so a failed send retries on the next sweep.
export function sweepLendReminders(
  lends: Lend[],
  userName: string,
  markStageSent: (id: string, stage: number) => void,
): void {
  const now = Date.now();
  const hour = new Date().getHours();
  if (hour < 8 || hour >= 20) return; // reasonable hours only
  for (const l of lends) {
    if (l.repaid || !l.email || !l.consent) continue;
    const daysLeft = (l.dueDate - now) / DAY;
    for (const stage of STAGES) {
      if (l.sentStages?.includes(stage)) continue;
      // The stage window opens at `stage` days out and stays open until the
      // NEXT stage begins, so an app opened late still sends the right one
      // and skips the stale ones.
      const nextStage = STAGES[STAGES.indexOf(stage) + 1] ?? 0;
      if (daysLeft <= stage && daysLeft > nextStage) {
        const p = payloadFor(l, userName);
        if (!p) break;
        sendLendReminder(p).then((r) => {
          if (r === 'sent') markStageSent(l.id, stage);
        });
        break; // one email per lend per sweep
      }
    }
  }
}
