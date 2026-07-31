# SaveCents — Project Handoff Document
**Last updated:** July 31, 2026 · **Current build:** savecents-m5.7-v31 (goal contributions + live milestones)
**Owner:** Rayy (rayysalcedo@gmail.com) · **Dev environment:** Windows PC + iPhone (Expo Go)

---

## 1. What SaveCents is

AI-powered behavioral personal finance app for Filipinos. Cents (the AI coach) intercepts purchases: users log expenses by chatting naturally (English/Tagalog/Taglish), scan items and receipts with an in-app camera, ask "can I afford this?", and get real trade-off math ("this delays your Hong Kong Trip by 3 weeks"). Zero-based budgeting across PH wallets/banks (GCash, Maya, BPI…), goals with trajectory projections.

**Design direction (LOCKED):** user-friendly, user-focused, NOT techy. Green/White/Sage light theme default (deep-green dark theme available; light is enforced as default via persist migration v3). Matte liquid glassmorphism in the app; the AUTH screens are deliberately SIMPLE solid cards (owner call, v17). Brand yellow `t.centsYellow = #FFDE59` (sampled from the logo) marks everything Cents. **Hard content rules: no emojis, no em dashes, no feature disclaimers anywhere in user-facing copy. Every visible button must do something real.**

React Native + Expo **SDK 54** (do NOT upgrade until the dev build lands). TypeScript, expo-router, zustand (persist **version 4**).

---

## 2. Current state — what is DONE

### M0–M2 ✅ (scaffold, full UI v1, real Gemini brain)
Firebase AI Logic (`firebase/ai`, GoogleAIBackend, NO API key in the app), Taglish intent extraction with live budget/goal context, structured JSON intents, model fallback chain (gemini-3.5-flash → 3.6-flash → 3.1-flash-lite → flash-latest; move to Remote Config at launch), offline heuristic parser, Hermes AbortSignal polyfills (KEEP `src/polyfills.ts` imported first in index.ts).

### M3 ✅ — Persistence + real accounts
zustand persist + AsyncStorage (migrations in `finance.ts` `migrate()`), `buildSnapshot` = single source of truth for local persist AND Firestore sync, Firebase email/password auth with RN session persistence (ts-ignore quirk in `auth.ts` is deliberate), per-user offline-first sync, Face ID relock, in-app account deletion.

### M4 ✅ — Vision foundations
Receipt + price-tag analysis via Gemini vision. Voice: premium overlay shipped; native STT still needs the dev build (`src/services/voice.ts` `loadVoiceModule` seam).

### M5 / M5.5 ✅ — Full UI/UX overhaul + Cents overhaul
Home (ATM card carousel with swipe physics — both carousels NATIVE-driven as of v20, page dots animate scaleX not width), Wallet, Analytics (search + CSV/PDF export + tap-to-edit transactions), Profile, icons-only liquid-glass nav with docked-notch Cents button (SVG mask, arc rules in §3.6), full-screen matte-glass Cents chat (bubbles use translucent FILLS not per-bubble blur as of v25 — perf, sanctioned by rule §3.4), ScanOverlay in-app camera, multi-step brain actions, overload retry chain.

### M5.5-auth ✅ (v16–v19) — Auth redesign
`app/auth.tsx`: reference layout in the sage language. Solid card (white light / deep-green dark, NO glow, NO blur), owner wordmark `assets/logo-wordmark.png` (shadow baked into the artwork, never add runtime shadow props), light/dark switcher pill (drives `setThemeMode`), segmented Login/Register with sliding emerald thumb, labeled fields + password eye, Remember Me (persists email under `savecents.rememberedEmail`, Login only), sign-up password rules chips (8+ chars, a letter, a number, match) + Retype field enforced on submit, register fits one screen. Steps: FORM → OTP → SUCCESS (green Congratulations card, Home Page button). Sign-up OTP goes through `services/otp.ts` (`requestEmailOtp`/`verifyEmailOtp`, same channel as password change: dev shows the code in a chip; prod without the M6 endpoint falls back to Firebase `sendEmailVerification` and the screen adapts). OTP UI = six boxes skinning ONE hidden TextInput (paste + iOS oneTimeCode autofill work), 30s resend cooldown. **Google Sign-In fully plumbed but blocked on setup** (see §4): `src/services/googleAuth.ts` (expo-auth-session) → `signInWithGoogleIdToken` in `auth.ts`; paste 3 OAuth client ids at the top of googleAuth.ts; Google refuses OAuth inside Expo Go (exp:// redirect), completes in the dev build with zero code changes; Google logins skip OTP.

### Cents brand + quick dial ✅ (v20–v26)
Yellow Cents mark replaces the sparkles glyph everywhere (`assets/cents-mark.png`, `-white` variant, thick `cents-scan-mark.png`). **Quick dial:** the center button is ONE PanResponder (`CentsButton` in `(tabs)/_layout.tsx`): tap = hub; swipe up or hold 220ms = three icon-only gradient circles fan out ON AN ARC (Scanner up-left, chat-bubble Cents AI top, mic Voice up-right — AI deliberately does NOT wear the cent mark, it read as a duplicate button); drag highlights nearest (2D `quickIndexForGesture`, yellow ring + swell + small WHITE name pill; highlighted button gets zIndex 10/elevation 20 so the pill renders over neighbors); release launches; release in place pins for tapping; backdrop/button tap dismisses. State in `store/ui.ts` (`quickOpen/quickDragging/quickIndex`); overlay `CentsQuickDial.tsx` mounted in TabLayout. Voice from the dial = `openVoice()` standalone: X returns to wherever the user was; a finished transcript opens chat to show the reply; "Type instead" opens chat. Chat header: title "Cents AI" + dot, no subtitle, top scan button removed (spacer keeps centering), mini avatars = plain mark in a neutral hairline circle.

### M5.6 ✅ (v27–v30) — Truth pass, notifications, sheet drags
1. **Real numbers** (`src/utils/stats.ts`): Home savings D/W/M/Y computed from transactions with honest comparison notes; goal pace = real 28-day rate (`paceLabel`: "Reached"/"No pace yet"/"N wks left"); the weekly=500 constant and all sample series are gone.
2. **Budget month rollover:** persist v4 added `lastRollover` (YYYY-MM). `rolloverBudgetsIfNeeded()` (post-hydration + Home mount, idempotent) RECOMPUTES spent from the current month's transactions and advances past-month dueDates monthly.
3. **Transaction edit/delete:** `updateTransaction`/`removeTransaction` built on `applyTxEffect(sign)` — reverses old effects, applies new; balances and budget spent stay consistent. Analytics rows open a drag-dismissable `TxEditor` sheet; Home recent rows route to Analytics.
4. **Notifications** (`src/services/notifications.ts` + `hooks/useNotificationSync.ts`, expo-notifications, all LOCAL, quiet banners, one Profile toggle which now really requests iOS permission): bill due tomorrow 9AM + due today 9AM; evening check-in 8PM (only the NEXT one is ever scheduled; skipped if the user already logged today — one nudge then silence for lapsed users); Sunday 7PM recap (goal-anchored, deliberately NUMBER-FREE because scheduled content freezes at schedule time); event-driven budget 90%/fully-used crossings (fired from addExpense, updateTransaction, confirmAction); goal milestones 25/50/75/100 (`notifyGoalMilestones`) **wired but DORMANT — nothing mutates goal.current yet**, see roadmap item 1. NEVER call it from replaceAll: cloud restores must not fire celebrations. notifications.ts must NOT import the store (require cycle; hook lives separately for that reason).
5. **Locale:** `peso()` groups via `setNumberLocale`; each Country has a `locale`; synced on setCountry + rehydrate.
6. **Drag-to-dismiss on all six sheets** (`hooks/useDragToDismiss.ts`): hub, New goal, New/Edit budget, Add account, balance editor, TxEditor. Responder attaches to a GRAB ZONE around the handle ONLY (whole-sheet responders steal inner scrolls — rule §3.10). Budget category picking no longer overwrites the typed name (blank name still falls back to category at submit).
7. **Empty states:** Home goal-insight slide shows a "No goal yet" card instead of blank.

### M5.7 ✅ (v31) — Goal contributions + live milestone notifications (Session A, part 1)
1. **`addToGoal(goalId, amount, accountId?)`** in `store/finance.ts`: bumps `goal.current` (NOT capped at target; UI caps the percent display), optionally debits a source account with the app-wide clamp-at-0, never touches budgets (saving is not spending), mirrors into chat like every other money action. It is the ONLY caller of `notifyGoalMilestones` — the 25/50/75/100 celebrations are now LIVE. `replaceAll` still never fires them (cloud restores stay silent). No persist bump needed: `goal.current` always existed.
2. **Goals tab:** every goal card gets an "Add savings" control (emerald-tint pill, matches the dueDate button language); reached goals swap the percent for a mint "Reached" chip and keep accepting savings. New drag-dismissable Add savings sheet (7th sheet, grab-zone responder per rule §3.9): autofocused MoneyInput, "TAKE IT FROM" chips — "Track only" (default, no balance touched) plus every account with its balance; honest inline note when the amount exceeds the chosen source ("balance will stop at zero"). Both empty states (goals AND budgets) now carry a real gradient CTA that opens the matching sheet.
3. Verified: `npx tsc --noEmit` clean, `npx expo export --platform ios` bundles.

---

## 3. CRITICAL RULES — every future session must respect these

**Design (owner-locked, device screenshots on file):**
1. Chat: centered "Cents AI" + dot header, soft top glow, left-aligned hero, tinted icon chips, matte bubbles via translucent fills (per-bubble blur is BANNED for perf — tune the Glass gradient instead), bare photos hairline-bordered. No sheen, no gradient hairline borders.
2. White on emerald in BOTH themes (`onEmerald = '#FFFFFF'`). Cents things are yellow `#FFDE59` on emerald. Auth screens stay simple solid cards. Logos ship with baked shadows; never add runtime shadow props to them.
3. Nav: icons only, docked-notch center button wearing the cent mark EXCLUSIVELY (dial AI button wears a chat bubble). Dial: icon-only circles, labels only as the white highlight pill + accessibilityLabel.

**Engineering gotchas (every one of these bit us — the touch-lag saga alone was rules 5, 9, 10, 11):**
4. **Never define components inside a render body.** Module scope + props. Violations were found LIVE in dashboard/wallet/profile as late as v20 and caused the app-wide "tap several times" bug via subtree remounts. Audit any new screen.
5. **Never run an unbounded JS-driven Animated loop** (useNativeDriver:false loops, animated SVG props). The Charts marker pulse starved the JS thread app-wide. Finite or native only.
6. Notch arc: SVG large-arc-flag = 1; render the path (cairosvg) before shipping geometry changes. Formulas in the old §3.5 comment block inside `(tabs)/_layout.tsx`. If bar geometry changes, also update `QUICK_OPTIONS` rises and `quickButtonBottom` in CentsQuickDial.tsx.
7. Never shadow + overflow:'hidden' on the same view. Every BlurView needs a radius-matched clipping parent (or use a translucent fill).
8. No KeyboardAvoidingView inside absolute/transformed overlays — use `useKeyboardInset`.
9. **Never wrap a ScrollView/FlatList in a Pressable/Touchable** — the responder negotiation kills scroll starts (v25 chat bug). Sheet drag responders attach to grab zones only, never the whole sheet.
10. **flex:1 children inside auto-sized parents collapse to height 0** (v22 "chips render as lines"). Give the intermediate wrapper flex or the child an explicit size.
11. Overlay elements that must read above siblings need zIndex (iOS) + elevation (Android) — the dial's highlighted button does this for its name pill.
12. Horizontal carousels with shadowed items need contentContainer paddingVertical + negative marginVertical.
13. Dark sheets use deep-green glass fills, never white-over-blur. 14. `npm install --legacy-peer-deps` always (npm, not npx).

---

## 4. Firebase / Google Cloud state — ONE UNRESOLVED BLOCKER

Project `savecents-78a95` (per this doc historically), Spark plan, AI Logic via Gemini Developer API. **`src/services/firebaseConfig.ts` is NOT in the zip — re-paste after every extraction.** App Check enforcement OFF — re-enable with App Attest/Play Integrity before launch.

**Google Sign-In setup stalled here:** the Google provider IS enabled in Firebase console, but in Google Cloud console the owner's signed-in account shows only `savecents-503919` (a DUPLICATE project created by mistake — safe to shut down) and an unrelated project; the real Firebase project was not in the picker (checked the All tab). Diagnosis next session: open Firebase console → Project settings → read the REAL Project ID (also visible as `projectId` in firebaseConfig.ts), check which Google ACCOUNT the Firebase console avatar shows, and sign into cloud.google.com with THAT account. Then: OAuth consent screen (External, add owner as test user) → copy the Web client ID from Firebase's Google provider "Web SDK configuration" → create the iOS client (bundle `com.rxsfin.savecents`) → paste both into `GOOGLE_CLIENT_IDS` in `src/services/googleAuth.ts`. Android client waits for the EAS SHA-1 (M4 build). The client-ID number prefix must match the real project's number — that is the sanity check.

---

## 5. Repo structure

```
index.ts                        # polyfills FIRST, then expo-router entry
app/
  _layout.tsx                   # themed bg + aurora; mounts useCloudSync + useNotificationSync
  index.tsx / auth.tsx          # auth gate; redesigned auth (FORM/OTP/SUCCESS)
  profile.tsx                   # Profile; notifications toggle requests real permission
  (tabs)/_layout.tsx            # notched glass bar; CentsButton PanResponder (tap/hold/swipe);
                                #   overlay stack: CentsQuickDial, Hub, Chat, Scan, Voice
  (tabs)/dashboard.tsx          # Home; native-driven carousels; real savings chart; rollover call
  (tabs)/wallet.tsx / goals.tsx / analytics.tsx   # analytics has TxEditor
src/
  components/GlassCard.tsx / Avatar.tsx / Charts.tsx / MoneyInput.tsx
  components/cents/             # CentsHub, CentsChatModal, ScanOverlay, VoiceOverlay, CentsQuickDial
  hooks/useKeyboardInset.ts / useDragToDismiss.ts / useNotificationSync.ts
  data/countries.ts             # + locale per country
  models/types.ts               # peso() locale-aware via setNumberLocale
  services/cents.ts / auth.ts / googleAuth.ts / otp.ts / notifications.ts / voice.ts / sync.ts
  store/finance.ts              # persist v4; rollover; updateTransaction/removeTransaction
  store/ui.ts                   # + quickOpen/quickDragging/quickIndex
  utils/stats.ts                # savingsSeries/savingsNote/weeklySavingsRate/paceLabel
  theme/colors.ts               # + centsYellow
assets/ logo-wordmark.png, cents-mark.png, cents-mark-white.png, cents-scan-mark.png
```

**Deps added since m5-v15:** expo-auth-session + expo-web-browser + expo-crypto (Google), expo-notifications. Still pinned: expo-camera ~17.0.10, masked-view 0.3.2, expo-file-system ~19 (Analytics imports `expo-file-system/legacy`).

---

## 6. Dev workflow

1. Project at `C:\Projects\savecents-rn`. **Replacing from a zip: DELETE the old folder first** (leftover route files shadow new screens).
2. Re-paste `src/services/firebaseConfig.ts`, `npm install --legacy-peer-deps`, first start `npx expo start -c`.
3. Pre-handoff checks: `npx tsc --noEmit` clean + `npx expo export --platform ios` bundles.
4. Perf judgments: test with `npx expo start --no-dev --minify` (dev mode is 2 to 5x slower).
5. **Strongly recommended, again, at v30 of zip-swapping: `git init` + GitHub.** Diffs beat folder replacement.

---

## 7. Known tech debt / seams

| Item | Where | Plan |
|---|---|---|
| Google OAuth client ids not pasted; wrong GCP account signed in | §4; services/googleAuth.ts | Resolve account, paste web+iOS ids; Android id after EAS SHA-1 |
| OTP email needs a backend | services/otp.ts `OTP_ENDPOINT` | M6 Cloud Function; dev shows code, prod falls back to Firebase emails |
| Voice STT needs the dev build | services/voice.ts seam | M4 build + expo-speech-recognition |
| Subscription = Free plan card | profile.tsx | M6: RevenueCat or free v1 |
| App Check off; model names hardcoded | console; cents.ts | M6 |
| Bank tiles are monograms | countries.ts | Licensed assets later |
| Wordmark baked shadow designed for LIGHT bg | assets | If dark-mode auth reads muddy: render a shadowless dark variant, swap by theme |

---

## 8. NEXT STEPS — the roadmap

### ▶ Session A — M5.5-finish: remaining tab redesigns
1. ~~Goals tab redesign + contributions~~ DONE in v31 (see M5.7 above).
2. **Wallet tab:** card-style source list (mini bank cards), reorder support.
3. **Analytics tab:** restyle summary/chart shells to match.

### ▶ Session B — M4-completion: the development build (one-time)
`eas build --profile development` (Apple free provisioning). Unlocks: Google Sign-In (after §4 is resolved), expo-speech-recognition via the voice.ts seam, Face ID in-app, SDK upgrades; retires Expo Go and its dev-mode sluggishness. Grab the Android SHA-1 from `eas credentials` and create the Android OAuth client while there.

### ▶ M6 — Launch
Cloud Function for OTP email; App Check enforced; models via Remote Config; Sentry/Crashlytics; privacy policy + data-safety forms; billing decision; iOS $99 → TestFlight → review; Android $25 → closed testing → production.

---

## 9. Paste-ready brief for the next session

> "Continuing SaveCents (React Native + Expo SDK 54 — read HANDOFF.md, build savecents-m5.6-v30, ESPECIALLY §3 CRITICAL RULES before writing any UI code — the touch-lag saga made rules 4/5/9/10 blood-earned). Done through M5.6: redesigned auth with OTP + Google plumbing (blocked on §4 account issue), Cents quick dial (arc, drag-select, PanResponder on the center button), truth pass (real savings chart, real goal pace, month rollover, tx edit/delete), coaching notifications (check-ins/recap/bills/budget-90; goal milestones DORMANT until contributions exist), drag-dismissable sheets, locale-aware peso(). Today: Session A — redesign Goals (WITH contributions wired to notifyGoalMilestones, never from replaceAll), Wallet card list + reorder, Analytics restyle. Workflow: DELETE old folder before extracting, re-paste firebaseConfig.ts, npm install --legacy-peer-deps, npx expo start -c."

---

## 10. Quick regression script (run after any change, light + dark)

1. **Auth:** light by default; theme switcher; register fits one screen; password rule chips; OTP dev-code chip; Congratulations card; Face ID relock; forgot password; Google button explains (Expo Go).
2. **Nav + dial:** icons only; tap Cents = hub; swipe up = arc of three circles; drag highlights with yellow ring + WHITE pill readable over neighbors; release launches; hold-release pins, chips tappable, backdrop closes; Voice X returns to the current screen.
3. **Home:** card swipe physics smooth (native), dots stretch, eye toggle masks, savings chart D/W/M/Y moves when logging real expenses, note text stays honest, no-goal insight shows the empty card, recent rows push Analytics.
4. **Sheets:** all six drag-dismiss from the handle, abort-drag springs back; budget category tap does NOT overwrite a typed name.
5. **Transactions:** edit amount in Analytics → account balance and budget spent adjust; delete → both restore.
6. **Notifications:** toggle requests permission; expense crossing 90% fires a banner; scheduled check-in skips a day you logged (see chat log for the 2-minute test edit).
7. **Chat:** scrolls immediately with no dead zone; old messages render instantly while scrolling up; bubbles matte in both themes; multi-step actions; overload retry line.
8. **Goal contributions:** Add savings with Track only bumps the goal and no balance moves; picking an account debits it (clamps at 0, warn line shows when the amount exceeds it); crossing 25/50/75/100 fires exactly ONE banner (highest threshold only); a reached goal shows the mint Reached chip and still accepts savings; goal empty state's Create a goal and budget empty state's Create a budget both open their sheets; the new sheet drag-dismisses from the handle only.
9. **Rollover (monthly):** on a new month, budget spent recomputes from that month's transactions and due dates advance.
