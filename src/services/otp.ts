// M5: email OTP for password changes.
//
// Sending email from the client requires a backend. The production path is a
// tiny Cloud Function (M6, alongside App Check and Remote Config): it receives
// { email, code } and emails the code. Point OTP_ENDPOINT at it when deployed.
//
// Until then:
//  - in development the generated code is returned to the caller so the flow
//    is fully testable on device (surfaced in a dev-only alert),
//  - in production without an endpoint the caller falls back to Firebase's
//    built-in password-reset email (real, secure, zero backend).
//
// Codes are 6 digits, expire after 10 minutes, and allow 5 attempts.

const OTP_ENDPOINT: string | null = null; // e.g. 'https://<region>-<project>.cloudfunctions.net/sendOtp'

interface PendingOtp {
  code: string;
  email: string;
  expiresAt: number;
  attemptsLeft: number;
}

let pending: PendingOtp | null = null;

export class OtpUnavailableError extends Error {
  constructor() { super('No OTP delivery channel configured'); }
}

export interface OtpRequestResult {
  sent: boolean;
  devCode?: string; // only present in __DEV__ with no endpoint configured
}

export async function requestPasswordOtp(email: string): Promise<OtpRequestResult> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  pending = { code, email, expiresAt: Date.now() + 10 * 60_000, attemptsLeft: 5 };

  if (OTP_ENDPOINT) {
    const res = await fetch(OTP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) throw new Error('Could not send the code. Try again.');
    return { sent: true };
  }

  if (__DEV__) return { sent: true, devCode: code };

  pending = null;
  throw new OtpUnavailableError();
}

// M5.5: the same code channel now also verifies new sign-ups on the auth
// screen. Same rules (6 digits, 10 min, 5 tries), same delivery seam, same
// Cloud Function at M6. Aliased so call sites read correctly.
export const requestEmailOtp = requestPasswordOtp;

export function verifyPasswordOtp(input: string): { ok: boolean; reason?: string } {
  if (!pending) return { ok: false, reason: 'Request a new code first.' };
  if (Date.now() > pending.expiresAt) {
    pending = null;
    return { ok: false, reason: 'That code expired. Request a new one.' };
  }
  if (pending.attemptsLeft <= 0) {
    pending = null;
    return { ok: false, reason: 'Too many attempts. Request a new code.' };
  }
  if (input.trim() !== pending.code) {
    pending.attemptsLeft -= 1;
    return { ok: false, reason: `That code is not right. ${pending.attemptsLeft} tries left.` };
  }
  pending = null;
  return { ok: true };
}

export const verifyEmailOtp = verifyPasswordOtp;
