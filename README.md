# SaveCents (React Native + Expo)

AI-powered behavioral personal finance. Users log money by talking to **Cents**
(the AI money buddy) in chat or voice, scanning receipts and price tags with the
in-app camera, or typing naturally — and budgets, goals, and charts update
themselves. Local-first: the entire finance engine works offline; Gemini, cloud
sync, and split emails are the online layer on top.

Built with Expo **SDK 54** (do not upgrade until the dev build lands),
TypeScript, expo-router, and zustand (persist **v4**). Identity: **Minted Gold**
— warm parchment light theme, espresso dark theme, one coin gold throughout.

**Current build:** m5.50-v80 · **Current phase:** 1.5 "Expo Go window" (see
`ROADMAP.md`, the source of truth for the launch plan). `HANDOFF.md` carries the
full build history and engineering rules.

## Run it on your iPhone (Windows PC + iPhone)

1. Install Node.js LTS on your PC: https://nodejs.org
2. Install **Expo Go** on your iPhone from the App Store.
3. In this folder, run:
   ```
   npm install
   npx expo start
   ```
4. Make sure your PC and iPhone are on the **same Wi-Fi**.
5. Scan the QR code in the terminal with your iPhone camera → opens in Expo Go.
6. Edit any file, save — the app hot-reloads on your phone instantly.

If the QR connection fails (some routers block it), run `npx expo start --tunnel`.

## Project structure

```
app/                        # expo-router screens (file-based routing)
  _layout.tsx               # theme root + splash gate
  index.tsx                 # auth gate
  auth.tsx                  # login / signup / OTP / Google (theme-aware wordmark)
  oauthredirect.tsx         # Google OAuth return
  profile.tsx               # account, settings, security, notifications
  (tabs)/
    dashboard.tsx           # home: card carousel, savings stats, insights
    wallet.tsx              # accounts, budgets (Bills/Spending), move funds
    analytics.tsx           # transactions, search, tap-to-edit, CSV/PDF export
    goals.tsx               # goal trajectories + add-goal sheet
    _layout.tsx             # icons-only glass nav + docked Cents quick dial
src/
  theme/colors.ts           # Minted Gold tokens (light + dark)
  models/types.ts           # domain types
  store/                    # zustand: finance.ts (persist v4 + sync), ui.ts
  components/
    cents/                  # CentsHub, CentsChatModal, ScanOverlay,
                            #   VoiceOverlay, CentsQuickDial
    Charts.tsx, TrendChart.tsx, GlassCard.tsx, ...
  services/                 # cents (Gemini brain), auth, googleAuth, otp,
                            #   sync, split, lend, notifications, speech, voice
  hooks/                    # notification sync, keyboard inset, drag-to-dismiss
  data/                     # brands, countries (locale + currency)
  utils/                    # real stats, report/CSV/PDF export
worker/                     # Cloudflare Worker — live at api.savecents.app
                            #   (split links, manage pages, branded emails)
assets/                     # brand assets — see Brand below
```

## Milestone status

- [x] M0 — Expo scaffold, runs on iPhone via Expo Go
- [x] M1 — Full UI shell with mock data
- [x] M2 — Real Gemini brain via Firebase AI Logic (no key in app)
- [x] M3 — Persistence (zustand + AsyncStorage), Firebase Auth, offline-first
      Firestore sync, Face ID relock, in-app account deletion
- [x] M4 — Gemini vision for receipts + price tags; premium voice overlay
      (native STT waits on the dev build)
- [x] M5 / M5.5 — Full UI/UX overhaul: tab redesign, Cents quick dial,
      Minted Gold retheme, real stats, budget month rollover, transaction
      edit/delete, local notifications, auth redesign, coin-flip splash
- [ ] Phase 1.5 (now) — entitlements + trial caps, security package, guest
      mode, Quick Scan parser core (everything buildable inside Expo Go)
- [ ] Phase 2–3 — EAS dev build, RevenueCat IAP, ML Kit OCR, App Check
- [ ] Phase 4–5 — store readiness → soft launch → global

## Brand (Minted Gold)

One gold everywhere: **coin gold `#F2BE22`** (bright accent `#F5C64A`), espresso
ink/dark `#221B10` / `#15110C`, parchment `#FBF8F2`. Code tokens in
`src/theme/colors.ts` match the shipped assets — keep them in sync.

- `cents-mark.png` / `cents-scan-mark.png` / `cents-splash.png` — the gold coin
  mark (`cents-mark-white.png` is intentionally white for dark overlays)
- `logo-wordmark.png` / `logo-wordmark-dark.png` — the save¢ents lockup;
  auth screens switch on theme automatically. Shadow is baked into the
  artwork — never add runtime shadow props.
- `icon.png` — espresso + gold app icon (opaque, iOS rounds it);
  `android-icon-foreground/background/monochrome.png` — adaptive set
- No green remains anywhere; legacy green assets were retired.

Content rules (app-wide): no emojis, no em dashes, no feature disclaimers in
user-facing copy. Every visible button must do something real.

## Live infrastructure

- **savecents.app** — landing site (separate repo `savecents-site`, static HTML
  on Cloudflare, auto-deploys from GitHub `main`). Drop real media at
  `assets/video/app-demo.mp4` and `assets/screens/1-4.png` in that repo.
- **api.savecents.app** — the `worker/` deployed via `wrangler deploy`
  (split manage pages + gold email templates)
- **Mail** — Brevo, domain-authenticated; sender `SaveCents
  <noreply@savecents.app>`, support routed through `support@savecents.app`
- Coming soon (not live): App Store / Google Play — the app is pre-release

## Connect the Gemini brain (5 minutes, free)

Cents runs on an offline parser until Firebase is connected:

1. https://console.firebase.google.com → Add project → name it, Analytics off.
2. Build → **AI Logic** → Get started → choose **Gemini Developer API** (free)
   → enable.
3. Project overview → **</>** (Web) icon → register app → copy the
   `firebaseConfig` object → paste into `src/services/firebaseConfig.ts`
   (see `firebaseConfig.example.ts`).
4. Restart `npx expo start`. Chat now hits Gemini — try
   "just grabbed coffee, 6.50".

No Gemini API key exists in this codebase; Firebase AI Logic proxies the model
server-side. Before public launch, Firebase App Check goes on to stop abuse of
the public config (Phase 3).

## Notes

- Chat is Gemini-first with an offline heuristic fallback, so the app always
  answers — even unconfigured or without network.
- `src/polyfills.ts` must stay imported first in `index.ts` (Hermes
  AbortSignal polyfills).
- `ROADMAP.md` = launch plan and product model (source of truth).
  `HANDOFF.md` = build history + engineering rules. `AGENTS.md` / `CLAUDE.md` =
  AI-assistant working instructions.