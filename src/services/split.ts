// Planner v3: emails each person their share of a split bill.
// Primary path: the Cloudflare Worker's /send-split endpoint (branded email
// via Brevo, same worker that sends OTPs and reports). Fallback: a prefilled
// mailto link that opens the user's own mail app, so the feature still works
// before the worker is redeployed or when it is unreachable.
//
// By design there is no reply-to plumbing: the email tells the person in
// plain text to let the payer know directly once they have paid.
import { Linking } from 'react-native';
import { WORKER_ENDPOINT } from './otp';

export interface SplitEmailPayload {
  email: string;      // recipient
  name: string;       // recipient's name
  userName: string;   // the SaveCents user sending this
  payerName: string;  // who covered the bill
  title: string;      // what the bill was
  totalFmt: string;   // preformatted, e.g. P1,240.00
  shareFmt: string;   // preformatted share
  headcount: number;
}

export async function sendSplitEmail(p: SplitEmailPayload): Promise<'sent' | 'failed'> {
  if (!WORKER_ENDPOINT) return 'failed';
  try {
    const res = await fetch(`${WORKER_ENDPOINT}/send-split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) {
      // Surfaced in the Metro console so a failed send is never a mystery.
      // 404 = the worker has not been redeployed with /send-split yet.
      console.log('[split] send failed', res.status, await res.text().catch(() => ''));
      return 'failed';
    }
    const data = await res.json();
    if (!data?.ok) console.log('[split] worker refused', JSON.stringify(data));
    return data?.ok ? 'sent' : 'failed';
  } catch (e) {
    console.log('[split] network error', String(e));
    return 'failed';
  }
}

// Same message as the worker email, as a mailto link. Opened in the user's
// own mail app when the worker cannot send.
export function splitMailto(p: SplitEmailPayload): string {
  const subject = `Your share of ${p.title}: ${p.shareFmt}`;
  const body = [
    `Hi ${p.name},`,
    '',
    `${p.userName} split the bill for ${p.title}.`,
    '',
    `The math: ${p.totalFmt} divided by ${p.headcount} people = ${p.shareFmt} each.`,
    `Your share: ${p.shareFmt}`,
    '',
    `${p.payerName} covered the whole bill. Once you have paid your part, message ${p.payerName} directly to let them know.`,
    '',
    'Sent via SaveCents.',
  ].join('\n');
  return `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openSplitMail(p: SplitEmailPayload): Promise<boolean> {
  try {
    await Linking.openURL(splitMailto(p));
    return true;
  } catch {
    return false;
  }
}

// Planner v3.2: hosted manage link for bills someone else covered.
export interface RemoteSplitInput {
  payerName: string;
  payerEmail?: string;
  userName: string;
  title: string;
  totalFmt: string;
  shareFmt: string;
  headcount: number;
  people: { id: string; name: string }[];
  includeUser: boolean;
  userLabel: string;
}

export async function createRemoteSplit(input: RemoteSplitInput): Promise<{ token: string; url: string; emailed: boolean } | null> {
  if (!WORKER_ENDPOINT) return null;
  try {
    const res = await fetch(`${WORKER_ENDPOINT}/split-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) { console.log('[split] create link failed', res.status); return null; }
    const data = await res.json();
    return data?.ok ? { token: data.token, url: data.url, emailed: !!data.emailed } : null;
  } catch (e) {
    console.log('[split] create link error', String(e));
    return null;
  }
}

export async function fetchRemoteSplitState(token: string): Promise<{ people: { id: string; paid: boolean }[]; myPaid: boolean } | null> {
  if (!WORKER_ENDPOINT) return null;
  try {
    const res = await fetch(`${WORKER_ENDPOINT}/split-state/${token}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? { people: data.people ?? [], myPaid: !!data.myPaid } : null;
  } catch {
    return null;
  }
}

// Push a tick to the payer's page so both sides always agree.
export async function pushRemoteSplitTick(token: string, tick: { pid?: string; paid?: boolean; mine?: boolean }): Promise<boolean> {
  if (!WORKER_ENDPOINT) return false;
  try {
    const res = await fetch(`${WORKER_ENDPOINT}/split-set/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tick),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function remoteSplitUrl(token: string): string {
  return `${WORKER_ENDPOINT}/split/${token}`;
}
