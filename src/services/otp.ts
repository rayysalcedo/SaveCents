// M5.32: email OTP, now with a REAL delivery channel.
//
// Production path (no Blaze needed): a free Cloudflare Worker (see /worker in
// this repo) generates and stores the code, and sends a SaveCents-branded
// email through Brevo's free tier. Point OTP_ENDPOINT at the deployed Worker
// URL to switch it on. The Worker owns the code (hashed, 10-minute TTL,
// 5 attempts, rate-limited) - the app never sees it.
//
// With OTP_ENDPOINT null (fresh clones, offline dev):
//  - in development the generated code is returned to the caller so the flow
//    is fully testable on device (surfaced in a dev-only alert),
//  - in production the caller falls back to Firebase's built-in
//    password-reset email (real, secure, zero backend).

const OTP_ENDPOINT: string | null = 'https://savecents-otp.savecents-app.workers.dev';

// Planner v3: the same Worker sends split bill emails (see /worker).
export const WORKER_ENDPOINT = OTP_ENDPOINT;

// v5.11: the same Worker also emails Cents' monthly reports (see /worker):
// themed email + CSV/PDF attachments + 7-day download buttons.
export async function emailMonthlyReport(payload: {
  email: string;
  monthLabel: string;
  preparedFor: string;
  fileBase: string;
  csvBase64: string;
  pdfBase64: string;
  stats: { income: number; expenses: number; net: number; count: number };
}): Promise<void> {
  if (!OTP_ENDPOINT) throw new Error('report-unavailable');
  const res = await fetch(`${OTP_ENDPOINT}/send-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) throw new Error('report-rate');
  if (!res.ok) throw new Error('report-failed');
}

interface PendingOtp {
  code: string;
  email: string;
  expiresAt: number;
  attemptsLeft: number;
}

let pending: PendingOtp | null = null; // local fallback only
let remoteEmail: string | null = null; // which email the Worker is holding a code for

export class OtpUnavailableError extends Error {
  constructor() { super('No OTP delivery channel configured'); }
}

export interface OtpRequestResult {
  sent: boolean;
  devCode?: string; // only present in __DEV__ with no endpoint configured
}

export async function requestPasswordOtp(email: string): Promise<OtpRequestResult> {
  const clean = email.trim().toLowerCase();

  if (OTP_ENDPOINT) {
    const res = await fetch(`${OTP_ENDPOINT}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clean }),
    });
    if (res.status === 429) throw new Error('Too many codes requested. Wait a bit and try again.');
    if (!res.ok) throw new Error('Could not send the code. Try again.');
    remoteEmail = clean;
    return { sent: true };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  pending = { code, email: clean, expiresAt: Date.now() + 10 * 60_000, attemptsLeft: 5 };

  if (__DEV__) return { sent: true, devCode: code };

  pending = null;
  throw new OtpUnavailableError();
}

// M5.5: the same code channel also verifies new sign-ups on the auth screen.
export const requestEmailOtp = requestPasswordOtp;

export async function verifyPasswordOtp(input: string): Promise<{ ok: boolean; reason?: string }> {
  const code = input.trim();

  if (OTP_ENDPOINT && remoteEmail) {
    try {
      const res = await fetch(`${OTP_ENDPOINT}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: remoteEmail, code }),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (data.ok) remoteEmail = null;
      return { ok: data.ok === true, reason: data.reason };
    } catch {
      return { ok: false, reason: 'Could not check the code. Are you online?' };
    }
  }

  if (!pending) return { ok: false, reason: 'Request a new code first.' };
  if (Date.now() > pending.expiresAt) {
    pending = null;
    return { ok: false, reason: 'That code expired. Request a new one.' };
  }
  if (pending.attemptsLeft <= 0) {
    pending = null;
    return { ok: false, reason: 'Too many attempts. Request a new code.' };
  }
  if (code !== pending.code) {
    pending.attemptsLeft -= 1;
    return { ok: false, reason: `That code is not right. ${pending.attemptsLeft} tries left.` };
  }
  pending = null;
  return { ok: true };
}

export const verifyEmailOtp = verifyPasswordOtp;

// M5.33: NO-LINK forgot password. The Worker asks Firebase (admin) for the
// real single-use reset secret, emails the user a friendly 6-digit code, and
// releases the secret only when the code checks out; the app then finishes
// with confirmPasswordReset. Throws OtpUnavailableError when the Worker (or
// its service account) isn't configured, so callers fall back to the link
// email.
export async function requestResetOtp(email: string): Promise<void> {
  if (!OTP_ENDPOINT) throw new OtpUnavailableError();
  const res = await fetch(`${OTP_ENDPOINT}/reset-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (res.status === 501) throw new OtpUnavailableError();
  if (res.status === 429) throw new Error('Too many codes requested. Wait a bit and try again.');
  if (!res.ok) throw new Error('Could not send the code. Try again.');
}

export async function verifyResetOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean; reason?: string; oobCode?: string }> {
  if (!OTP_ENDPOINT) return { ok: false, reason: 'Reset codes are not set up.' };
  try {
    const res = await fetch(`${OTP_ENDPOINT}/reset-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
    });
    return (await res.json()) as { ok: boolean; reason?: string; oobCode?: string };
  } catch {
    return { ok: false, reason: 'Could not check the code. Are you online?' };
  }
}
