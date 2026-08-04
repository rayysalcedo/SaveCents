// SaveCents OTP Worker (M5.32)
// Free Cloudflare Worker + Brevo free tier = branded OTP emails, no Blaze.
//
// Endpoints:
//   POST /send-otp   { email }         -> generates a 6-digit code, stores a
//                                         SHA-256 hash in KV (10 min TTL,
//                                         5 attempts), emails it via Brevo.
//                                         Rate limit: 3 sends/hour per email.
//   POST /verify-otp { email, code }   -> { ok, reason? }
//
// Setup (once, on the owner's PC - see worker/README.md):
//   wrangler kv namespace create OTP_KV   -> paste the id into wrangler.toml
//   wrangler secret put BREVO_API_KEY     -> paste the Brevo v3 API key
//   wrangler deploy                       -> paste the URL into src/services/otp.ts

const CODE_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;
const SENDS_PER_HOUR = 3;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;

// Mint a Google access token from the Firebase service account (secret
// FIREBASE_SA_JSON = the whole downloaded JSON, pasted as one line). Cached
// until near expiry. Powers the no-link password reset.
let tokenCache = { token: null, exp: 0 };
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && now < tokenCache.exp - 60) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SA_JSON);
  const b64u = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  let sigStr = '';
  for (const b of sig) sigStr += String.fromCharCode(b);
  const jwt = `${unsigned}.${b64u(sigStr)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token mint failed');
  tokenCache = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return tokenCache.token;
}

function emailHtml(code, senderName, title, sub) {
  const digits = String(code)
    .split('')
    .map(
      (d) =>
        `<td style="width:44px;height:56px;background:#0B2E22;border:1px solid #1E4D3B;border-radius:12px;text-align:center;font-size:26px;font-weight:800;color:#6EE7B7;font-family:'SF Mono',Menlo,Consolas,monospace;">${d}</td><td style="width:8px;"></td>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F4FBF7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4FBF7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#05130D;border-radius:24px;overflow:hidden;">
    <tr><td style="padding:32px 32px 0;">
      <span style="display:inline-block;background:#10B981;color:#04140D;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;letter-spacing:0.5px;border-radius:999px;padding:8px 16px;">&#8369; ${senderName}</span>
    </td></tr>
    <tr><td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#FFFFFF;font-size:22px;font-weight:800;line-height:1.3;">${title}</div>
      <div style="color:#9CB8AC;font-size:14px;line-height:1.6;margin-top:10px;">${sub}</div>
    </td></tr>
    <tr><td style="padding:22px 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
    </td></tr>
    <tr><td style="padding:18px 32px 30px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#6B8A7C;font-size:12px;line-height:1.6;">Didn't request this? You can safely ignore this email - your account stays untouched. Never share this code with anyone; ${senderName} will never ask for it.</div>
    </td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;color:#8AA79A;font-size:11px;padding-top:16px;">Sent by ${senderName} &middot; Manila, Philippines</div>
</td></tr>
</table>
</body></html>`;
}

async function sendViaBrevo(env, toEmail, code, kind) {
  const title = kind === 'reset' ? 'Reset your password' : 'Your verification code';
  const sub = kind === 'reset'
    ? `Enter this code in the ${env.SENDER_NAME} app to set a new password. It works for the next 10 minutes.`
    : `Enter this code in the ${env.SENDER_NAME} app to continue. It works for the next 10 minutes.`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: kind === 'reset'
        ? `${code} is your ${env.SENDER_NAME} password reset code`
        : `${code} is your ${env.SENDER_NAME} code`,
      htmlContent: emailHtml(code, env.SENDER_NAME, title, sub),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ ok: false, reason: 'POST only' }, 405);

    const url = new URL(request.url);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'Bad request' }, 400);
    }
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!validEmail(email)) return json({ ok: false, reason: 'Bad email' }, 400);

    if (url.pathname === '/send-otp') {
      // Per-email rate limit: SENDS_PER_HOUR.
      const rlKey = `rl:${email}`;
      const sends = parseInt((await env.OTP_KV.get(rlKey)) ?? '0', 10);
      if (sends >= SENDS_PER_HOUR) return json({ ok: false, reason: 'rate' }, 429);
      await env.OTP_KV.put(rlKey, String(sends + 1), { expirationTtl: 3600 });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const record = { hash: await sha256(`${email}:${code}`), attemptsLeft: MAX_ATTEMPTS };
      await env.OTP_KV.put(`otp:${email}`, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });

      try {
        await sendViaBrevo(env, email, code, 'verify');
      } catch (e) {
        await env.OTP_KV.delete(`otp:${email}`);
        console.log('send failed', String(e));
        return json({ ok: false, reason: 'send-failed' }, 502);
      }
      return json({ ok: true });
    }

    if (url.pathname === '/reset-request') {
      // No-link password reset: Firebase mints the real oobCode (admin), the
      // user only ever sees a friendly 6-digit code.
      if (!env.FIREBASE_SA_JSON) return json({ ok: false, reason: 'not-configured' }, 501);
      const rlKey = `rlr:${email}`;
      const sends = parseInt((await env.OTP_KV.get(rlKey)) ?? '0', 10);
      if (sends >= SENDS_PER_HOUR) return json({ ok: false, reason: 'rate' }, 429);
      await env.OTP_KV.put(rlKey, String(sends + 1), { expirationTtl: 3600 });

      let oobCode = null;
      try {
        const token = await getAccessToken(env);
        const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, returnOobLink: true }),
        });
        const data = await res.json();
        if (data?.oobLink) oobCode = new URL(data.oobLink).searchParams.get('oobCode');
        else if (!/EMAIL_NOT_FOUND/i.test(JSON.stringify(data))) throw new Error(JSON.stringify(data).slice(0, 150));
      } catch (e) {
        console.log('reset mint failed', String(e));
        return json({ ok: false, reason: 'send-failed' }, 502);
      }

      // Unknown emails get a generic ok (no account enumeration, no email).
      if (!oobCode) return json({ ok: true });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const record = { hash: await sha256(`${email}:${code}`), attemptsLeft: MAX_ATTEMPTS, oobCode };
      await env.OTP_KV.put(`reset:${email}`, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });
      try {
        await sendViaBrevo(env, email, code, 'reset');
      } catch (e) {
        await env.OTP_KV.delete(`reset:${email}`);
        console.log('reset send failed', String(e));
        return json({ ok: false, reason: 'send-failed' }, 502);
      }
      return json({ ok: true });
    }

    if (url.pathname === '/reset-verify') {
      const code = String(body.code ?? '').trim();
      if (!/^\d{6}$/.test(code)) return json({ ok: false, reason: 'That code is not right.' });
      const raw = await env.OTP_KV.get(`reset:${email}`);
      if (!raw) return json({ ok: false, reason: 'That code expired. Request a new one.' });
      const record = JSON.parse(raw);
      if (record.attemptsLeft <= 0) {
        await env.OTP_KV.delete(`reset:${email}`);
        return json({ ok: false, reason: 'Too many attempts. Request a new code.' });
      }
      const match = record.hash === (await sha256(`${email}:${code}`));
      if (!match) {
        record.attemptsLeft -= 1;
        await env.OTP_KV.put(`reset:${email}`, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });
        return json({ ok: false, reason: `That code is not right. ${record.attemptsLeft} tries left.` });
      }
      await env.OTP_KV.delete(`reset:${email}`);
      return json({ ok: true, oobCode: record.oobCode });
    }

    if (url.pathname === '/verify-otp') {
      const code = String(body.code ?? '').trim();
      if (!/^\d{6}$/.test(code)) return json({ ok: false, reason: 'That code is not right.' });

      const raw = await env.OTP_KV.get(`otp:${email}`);
      if (!raw) return json({ ok: false, reason: 'That code expired. Request a new one.' });
      const record = JSON.parse(raw);

      if (record.attemptsLeft <= 0) {
        await env.OTP_KV.delete(`otp:${email}`);
        return json({ ok: false, reason: 'Too many attempts. Request a new code.' });
      }

      const match = record.hash === (await sha256(`${email}:${code}`));
      if (!match) {
        record.attemptsLeft -= 1;
        await env.OTP_KV.put(`otp:${email}`, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });
        return json({ ok: false, reason: `That code is not right. ${record.attemptsLeft} tries left.` });
      }

      await env.OTP_KV.delete(`otp:${email}`);
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'Not found' }, 404);
  },
};
