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

// v5.11: every SaveCents email wears the app's editorial theme - warm
// paper background, white card with a hairline border, forest green
// accents, charcoal ink. Shared shell for OTP and report emails.
function emailShell(senderName, inner, logoUrl) {
  const brand = logoUrl
    ? `<img src="${logoUrl}" width="164" style="display:block;border:0;margin:0 auto;" alt="${senderName}" />`
    : `<span style="display:inline-block;background:#165B33;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13px;letter-spacing:0.4px;border-radius:999px;padding:8px 16px;">&#162; ${senderName}</span>`;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#FAF9F6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF9F6;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFFFF;border:1px solid #E9ECEF;border-radius:20px;overflow:hidden;">
    <tr><td align="center" style="padding:30px 30px 0;">
      ${brand}
    </td></tr>
    <tr><td style="padding:18px 30px 0;"><div style="height:1px;background:#E9ECEF;"></div></td></tr>
    ${inner}
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;color:#ADB5BD;font-size:11px;padding-top:16px;">Sent by ${senderName} &middot; Manila, Philippines</div>
</td></tr>
</table>
</body></html>`;
}

function emailHtml(code, senderName, title, sub, logoUrl) {
  const digits = String(code)
    .split('')
    .map(
      (d) =>
        `<td style="width:44px;height:56px;background:#F1F6F2;border:1px solid #CFE3D6;border-radius:12px;text-align:center;font-size:26px;font-weight:800;color:#165B33;font-family:'SF Mono',Menlo,Consolas,monospace;">${d}</td><td style="width:8px;"></td>`,
    )
    .join('');
  return emailShell(senderName, `
    <tr><td style="padding:24px 30px 8px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#1A1D20;font-size:22px;font-weight:800;line-height:1.3;">${title}</div>
      <div style="color:#6C757D;font-size:14px;line-height:1.6;margin-top:8px;">${sub}</div>
    </td></tr>
    <tr><td style="padding:18px 30px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
    </td></tr>
    <tr><td style="padding:16px 30px 28px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#ADB5BD;font-size:12px;line-height:1.6;">Didn't request this? You can safely ignore this email - your account stays untouched. Never share this code with anyone; ${senderName} will never ask for it.</div>
    </td></tr>`, logoUrl);
}

function reportEmailHtml(senderName, monthLabel, preparedFor, stats, links, logoUrl) {
  const fmt = (n) => '\u20B1' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const statCell = (label, value, color) => `
    <td width="33%" style="padding:12px 14px;background:#FAF9F6;border:1px solid #E9ECEF;border-radius:12px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:700;">${label}</div>
      <div style="color:${color};font-size:18px;font-weight:800;margin-top:2px;">${value}</div>
    </td>`;
  const btn = (href, label, solid) => `
    <a href="${href}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;text-decoration:none;border-radius:12px;padding:13px 22px;margin-right:10px;${solid
      ? 'background:#165B33;color:#FFFFFF;'
      : 'background:#FFFFFF;color:#165B33;border:1px solid #CFE3D6;'}">${label}</a>`;
  return emailShell(senderName, `
    <tr><td style="padding:24px 30px 6px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#1A1D20;font-size:22px;font-weight:800;line-height:1.3;">Your ${monthLabel} report</div>
      <div style="color:#6C757D;font-size:14px;line-height:1.6;margin-top:8px;">Hi ${preparedFor}, Cents put together your money month: ${stats.count} transaction${stats.count === 1 ? '' : 's'} from the 1st to the last day of ${monthLabel}.</div>
    </td></tr>
    <tr><td style="padding:14px 30px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>
        ${statCell('INCOME', fmt(stats.income), '#165B33')}
        ${statCell('EXPENSES', fmt(stats.expenses), '#1A1D20')}
        ${statCell('NET', (stats.net < 0 ? '-' : '') + fmt(Math.abs(stats.net)), stats.net < 0 ? '#DC2626' : '#165B33')}
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 30px 8px;font-family:Arial,Helvetica,sans-serif;">
      ${btn(links.pdf, 'Download PDF', true)}
      ${btn(links.csv, 'Download CSV', false)}
    </td></tr>
    <tr><td style="padding:8px 30px 28px;font-family:Arial,Helvetica,sans-serif;">
      <div style="color:#ADB5BD;font-size:12px;line-height:1.6;">Both files are also attached to this email. The download buttons work for 7 days.</div>
    </td></tr>`, logoUrl);
}

async function sendViaBrevo(env, toEmail, code, kind, logoUrl) {
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
      htmlContent: emailHtml(code, env.SENDER_NAME, title, sub, logoUrl),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
  }
}

// v5.12: the SaveCents wordmark, served at /logo.png for the emails
// (remote images render everywhere; data URIs get stripped by Gmail).
const LOGO_B64 = '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';

const token24 = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // v2 path busts Gmail's image-proxy cache of the old (black) render.
    if (request.method === 'GET' && (url.pathname === '/logo.png' || url.pathname === '/logo-v2.png')) {
      const bytes = Uint8Array.from(atob(LOGO_B64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800', ...CORS },
      });
    }

    // Report downloads: the email buttons hit this with a one-time token.
    if (request.method === 'GET' && url.pathname.startsWith('/report/')) {
      const token = url.pathname.split('/')[2] ?? '';
      const raw = token ? await env.OTP_KV.get(`rep:${token}`) : null;
      if (!raw) return new Response('This download link has expired.', { status: 404, headers: { 'Content-Type': 'text/plain', ...CORS } });
      const file = JSON.parse(raw);
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          'Content-Type': file.mime,
          'Content-Disposition': `attachment; filename="${file.name}"`,
          ...CORS,
        },
      });
    }

    if (request.method !== 'POST') return json({ ok: false, reason: 'POST only' }, 405);
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
        await sendViaBrevo(env, email, code, 'verify', `${url.protocol}//${url.host}/logo-v2.png`);
      } catch (e) {
        await env.OTP_KV.delete(`otp:${email}`);
        console.log('send failed', String(e));
        return json({ ok: false, reason: 'send-failed' }, 502);
      }
      return json({ ok: true });
    }

    // v5.11: Cents monthly report. Stores both files in KV for 7 days (the
    // email buttons) AND attaches them to the email itself.
    if (url.pathname === '/send-report') {
      const rlKey = `rlrep:${email}`;
      const sends = parseInt((await env.OTP_KV.get(rlKey)) ?? '0', 10);
      if (sends >= 6) return json({ ok: false, reason: 'rate' }, 429);
      await env.OTP_KV.put(rlKey, String(sends + 1), { expirationTtl: 3600 });

      const monthLabel = String(body.monthLabel ?? '').slice(0, 40);
      const preparedFor = String(body.preparedFor ?? 'there').slice(0, 60);
      const fileBase = String(body.fileBase ?? 'SAVECENTS-REPORT').replace(/[^A-Z0-9-]/gi, '').slice(0, 60) || 'SAVECENTS-REPORT';
      const stats = body.stats ?? { income: 0, expenses: 0, net: 0, count: 0 };
      const csvB64 = String(body.csvBase64 ?? '');
      const pdfB64 = String(body.pdfBase64 ?? '');
      if (!monthLabel || !csvB64 || !pdfB64) return json({ ok: false, reason: 'Bad request' }, 400);
      if (csvB64.length > 4_000_000 || pdfB64.length > 12_000_000) return json({ ok: false, reason: 'too-big' }, 413);

      const SEVEN_DAYS = 7 * 24 * 3600;
      const csvTok = token24();
      const pdfTok = token24();
      await env.OTP_KV.put(`rep:${csvTok}`, JSON.stringify({ mime: 'text/csv', name: `${fileBase}.csv`, data: csvB64 }), { expirationTtl: SEVEN_DAYS });
      await env.OTP_KV.put(`rep:${pdfTok}`, JSON.stringify({ mime: 'application/pdf', name: `${fileBase}.pdf`, data: pdfB64 }), { expirationTtl: SEVEN_DAYS });
      const origin = `${url.protocol}//${url.host}`;
      const links = { csv: `${origin}/report/${csvTok}`, pdf: `${origin}/report/${pdfTok}` };

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL },
          to: [{ email }],
          subject: `Your ${monthLabel} report from ${env.SENDER_NAME}`,
          htmlContent: reportEmailHtml(env.SENDER_NAME, monthLabel, preparedFor, stats, links, `${origin}/logo-v2.png`),
          attachment: [
            { name: `${fileBase}.pdf`, content: pdfB64 },
            { name: `${fileBase}.csv`, content: csvB64 },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.log('report send failed', res.status, t.slice(0, 200));
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
        await sendViaBrevo(env, email, code, 'reset', `${url.protocol}//${url.host}/logo-v2.png`);
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
