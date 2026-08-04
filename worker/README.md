# SaveCents OTP Worker

Branded OTP emails via Brevo, hosted on a free Cloudflare Worker. No Blaze,
no credit card.

## One-time setup (Windows PC, ~15 minutes)

1. **Brevo** (free, 300 emails/day): create an account at brevo.com →
   Settings → Senders: add and VERIFY your sender email (your Gmail works) →
   SMTP & API → API Keys → Generate a new API key (v3) → copy it.
2. **Cloudflare** (free): create an account at dash.cloudflare.com.
3. In PowerShell, from the repo root:
   ```
   npm i -g wrangler
   cd worker
   wrangler login                       # opens the browser once
   wrangler kv namespace create OTP_KV  # prints an id
   ```
   Paste the printed id into `wrangler.toml` (replace REPLACE_ME).
   Check SENDER_EMAIL in `wrangler.toml` matches your verified Brevo sender.
   ```
   wrangler secret put BREVO_API_KEY    # paste the Brevo key when asked
   wrangler deploy                      # prints your Worker URL
   ```
4. Open `src/services/otp.ts` in the app and set:
   ```
   const OTP_ENDPOINT = 'https://savecents-otp.<your-subdomain>.workers.dev';
   ```
5. Ship it: `git add -A`, `git commit`, `git push`, then
   `eas update --branch production --message "branded OTP"`.

## No-link password reset (optional extra step, ~5 minutes)

The Worker can also power the in-app "forgot password" code flow (no links to
click). It needs the Firebase service account:

1. Firebase Console → Project settings → **Service accounts** →
   **Generate new private key** → a JSON file downloads.
2. Open the JSON in Notepad, copy the WHOLE thing (one line is fine), then:
   ```
   wrangler secret put FIREBASE_SA_JSON     # paste the JSON when asked
   wrangler deploy
   ```
Done - the app's Forgot password now opens the code sheet. Without this
secret the Worker answers 501 and the app quietly falls back to the classic
Firebase link email, so nothing breaks either way.

## What it does
- POST /send-otp {email}: 6-digit code, SHA-256 hash in KV, 10-minute TTL,
  5 attempts, max 3 sends per hour per email, then a SaveCents-styled email
  (dark emerald card, big code digits) through Brevo.
- POST /verify-otp {email, code}: checks and burns the code.
- POST /reset-request {email}: mints Firebase's real single-use reset secret
  (admin token from the service account), emails a friendly 6-digit code.
  Unknown emails get a generic ok (no account enumeration).
- POST /reset-verify {email, code}: on success releases the reset secret;
  the app finishes with confirmPasswordReset. New password, zero links.

The app falls back to its old behavior (dev alert in development, Firebase
reset email in production) whenever OTP_ENDPOINT is null, so fresh clones
still build and run.
