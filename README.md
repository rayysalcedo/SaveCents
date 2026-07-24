# SaveCents (React Native + Expo)

AI-powered behavioral personal finance. Rewrite of the Kotlin/Compose prototype
for dual iOS + Android via Expo (SDK 54 — matches the App Store version of Expo Go). Fintech Glassmorphism / Deep Obsidian theme.

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
app/                    # expo-router screens (file-based routing)
  _layout.tsx           # obsidian background + ambient glows
  index.tsx             # auth gate
  auth.tsx              # login / signup / OTP (mock until M3)
  (tabs)/
    dashboard.tsx       # hero, insights carousel, donut, budgets, activity
    chat.tsx            # Cents AI chat, all bubble types, camera sheet
    goals.tsx           # goal trajectories + add-goal sheet
    profile.tsx         # accounts, settings, logout
src/
  theme/colors.ts       # ported from Color.kt
  models/types.ts       # ported from Models.kt
  store/finance.ts      # ported from FinanceViewModel.kt (zustand)
  components/
    GlassCard.tsx       # blur + lit border glass surface
    Charts.tsx          # segmented donut + glowing bezier trajectory (SVG)
```

## Milestone status

- [x] M0 — Expo scaffold, runs on iPhone via Expo Go
- [x] M1 — Full UI shell with mock data (parity with the Kotlin prototype)
- [x] M2 — Real Gemini brain via Firebase AI Logic (no key in app)
- [ ] M3 — SQLite persistence + Firebase Auth + Firestore sync
- [ ] M4 — Real camera vision (receipts, consult) + streaming voice CC
- [ ] M5 — Polish: animations, error/empty states, budget rollover
- [ ] M6 — TestFlight + Play Store launch

## M2: connect the Gemini brain (5 minutes, free)

Cents runs on an offline parser until Firebase is connected:

1. https://console.firebase.google.com → Add project → name it, Analytics off.
2. Build → **AI Logic** → Get started → choose **Gemini Developer API** (free) → enable.
3. Project overview → **</>** (Web) icon → register app → copy the
   `firebaseConfig` object → paste into `src/services/firebaseConfig.ts`.
4. Restart `npx expo start`. Chat now hits Gemini: try Taglish —
   "Kakabili ko lang ng dog food 800".

No Gemini API key exists in this codebase; Firebase AI Logic proxies the
model server-side. Before public launch, enable Firebase App Check to stop
abuse of the public config.

## Notes

- Chat is Gemini-first (Firebase AI Logic) with an offline heuristic fallback,
  so the app always answers even unconfigured or without network.
- Receipt scan / consult item are simulated (same as the Kotlin build) until M4.
- No API keys anywhere in this app, by design — Gemini calls go through a
  backend starting in M2.
