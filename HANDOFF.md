# SaveCents — Project Handoff Document
**Last updated:** July 30, 2026 · **Current build:** savecents-m5.6-v30 (draggable sheets + budget name fix)
**Owner:** Rayy (rayysalcedo@gmail.com) · **Dev environment:** Windows PC + iPhone (Expo Go)

---

## 1. What SaveCents is

AI-powered behavioral personal finance app for Filipinos. Cents (the AI coach) intercepts purchases: users log expenses by chatting naturally (English/Tagalog/Taglish), scan items and receipts with an in-app camera, ask "can I afford this?", and get real trade-off math ("this delays your Hong Kong Trip by 3 weeks"). Zero-based budgeting across PH wallets/banks (GCash, Maya, BPI…), goals with trajectory projections.

**Design direction (LOCKED):** user-friendly, user-focused, NOT techy. Green/White/Sage light theme default (deep-green dark theme in Profile). Matte liquid glassmorphism throughout. **Hard content rules: no emojis, no em dashes, no feature disclaimers anywhere in user-facing copy. Every visible button must do something real.**

React Native + Expo **SDK 54** (do NOT upgrade until the dev build lands in the roadmap). TypeScript, expo-router, zustand.

---

## 2. Current state — what is DONE

### M0–M2 ✅ (scaffold, full UI v1, real Gemini brain)
Firebase AI Logic (`firebase/ai`, GoogleAIBackend, NO API key in the app), Taglish intent extraction with live budget/goal context, structured JSON intents, model fallback chain, offline heuristic parser, Hermes AbortSignal polyfills (KEEP `src/polyfills.ts` imported first in index.ts).

### M3 ✅ — Persistence + real accounts
zustand `persist` + AsyncStorage (**persist version 2**, migrations in `finance.ts` `migrate()`), `buildSnapshot` = single source of truth for local persist AND Firestore sync. Firebase email/password auth with RN session persistence (ts-ignore quirk in `auth.ts` is deliberate), per-user offline-first sync, Face ID relock, in-app account deletion (Apple 5.1.1(v)).

### M4 ✅ — Vision foundations
Receipt + price-tag analysis via Gemini vision (base64 → same structured schema → existing action-card flows). Voice: premium overlay shipped; native STT still needs the dev build (`src/services/voice.ts` `loadVoiceModule` seam).

### M5 ✅ — Full UI/UX overhaul
Redesigned Home (ATM card carousel with swipe physics, Today strip, Insights, budgets with due dates), Wallet, Analytics (search + CSV/PDF export), Profile (animal avatars, nickname, OTP-gated password change, plan card). Budgets have `name` / `category` / `dueDate`. Cents became the center-button hub instead of a chat tab.

### M5.5 (Cents overhaul, v4→v15, device-verified through v13; v14–v15 geometry fixes pending device check) ✅

**Cents chat (`src/components/cents/CentsChatModal.tsx`)** — full-screen liquid-glass overlay: the screen behind stays visible through blur 80 + theme veil + soft emerald top glow. Header: centered "Cents" + status dot + "AI coach", glass chevron-down (close) and scan buttons. Fresh conversations (chat has only the seed message) show a left-aligned hero greeting + three suggestion cards. Matte frosted bubbles (blur + one soft fill + thin border), emerald-gradient user bubbles, tinted emerald icon chips. Photos send with NO label and NO bubble: bare image with a hairlineWidth border. Keyboard handled by `src/hooks/useKeyboardInset.ts` (NO KeyboardAvoidingView in absolute overlays, it mis-measures). Scan button opens a two-option sheet (item / receipt) that launches ScanOverlay.

**ScanOverlay (`src/components/cents/ScanOverlay.tsx`)** — in-app camera on **expo-camera ~17.0.10**: viewfinder with corner brackets + sweeping scan line, Item/Receipt segmented switch (taller frame for receipts), torch, gallery import, gradient shutter. Capture freezes the shot, the line keeps sweeping under a "Cents is analyzing" chip, then a dark glass panel slides up over the image: analysis lines, compact action card (Confirm/Decline), and a composer (text + mic) so the user keeps talking over the scan. "Open chat" hands the same thread to the full chat (everything lives in the chat store; the panel renders `chat.slice(startIndex)`). Permission-denied has its own screen with Allow + Photos import.

**Cents hub (`CentsHub.tsx`)** — quick Add Expense / Add Income / Scan (opens ScanOverlay directly) + Chat CTA with mic. Dark-mode sheet uses deep-green glass fill (never white-over-blur, it renders gray).

**Nav bar (`app/(tabs)/_layout.tsx`)** — floating liquid-glass pill, ICONS ONLY (labels kept as accessibilityLabel), blur masked to a notched capsule via **@react-native-masked-view/masked-view 0.3.2** + react-native-svg path; the border is an SVG stroke of the same path. Focused tab = soft emerald glass circle (spring). Tabs dip 0.92 on press. Center Cents button (56px gradient) is docked IN the carved notch: 10px above the bar, ~8px side gaps, 10px air below; press dips 0.94, hold 220ms swells to 1.08 with a mint glow ring.

**Cents brain (`src/services/cents.ts` + `src/store/finance.ts`)**
- `buildBrainContext()` feeds EVERY text and vision call: nickname, date, budgets, goals, liquid balance, 8 recent transactions, last 12 chat turns (cards flattened to text; bare photos become "Shared a photo to scan"). Follow-ups ("yes", "log that receipt", "saan mas mura?") resolve from memory.
- **Multi-step requests:** `CentsResult.actions[]` — one message like "add a Groceries budget 9000 and log that receipt there" produces sequential action cards; categories created earlier in a batch count as existing for later cards; `executeAction` LogTransaction auto-creates a missing category on confirm.
- **Vision:** item scans identify the product and estimate PH market price when no tag is visible (`priceIsEstimate`, the reply says it's an estimate); receipt scans break down store/items/discounts in `details` and invite log-or-ask. Handwritten-receipt digit rules retained.
- **Resilience:** transient errors (429/500/503, "high demand", "overloaded", "resource exhausted", "unavailable", "internal error") retry the same model once after 900ms then advance the candidate chain; only a fully exhausted chain throws `cents-overloaded`, which surfaces as a friendly "I'm getting a lot of requests" line (chat AND scan). 404-class errors skip straight to the next model. Offline parser recognizes receipt/resibo/worth/total/nagastos/gastos.
- Models tried in order: gemini-3.5-flash → 3.6-flash → 3.1-flash-lite → flash-latest (move to Remote Config at launch).

### M5.5-auth ✅ — Auth screens redesigned (savecents-m5-v16)
`app/auth.tsx` rebuilt to the owner's reference layout in the locked sage language: real wordmark (`assets/logo-wordmark.png`, cropped from the brand file), light/dark switcher pill top-right (light default; drives the same `setThemeMode` as the Profile picker), segmented Login/Register pill with a sliding emerald thumb, labeled fields with password eye toggle, functional Remember Me (email persisted under `savecents.rememberedEmail`), emerald pill CTA (white-on-emerald in both themes), "Or continue with" Google + Face ID pills, footer mode switch. Steps: FORM to OTP to SUCCESS with a short cross-fade. Sign-up sends a 6-digit code through `requestEmailOtp` (aliased in `services/otp.ts`; same channel as the password-change OTP: dev shows the code in a chip, prod without the M6 endpoint falls back to Firebase `sendEmailVerification`, a real link email, and the OTP screen adapts its copy). OTP UI: six boxes skinning ONE hidden TextInput (paste, iOS `oneTimeCode` autofill, and backspace all behave), 30s resend cooldown, back chevron returns to Login. Success: emerald gradient card with a white check ring and a Home Page button, per the reference. Google Sign-In fully plumbed: `src/services/googleAuth.ts` (expo-auth-session + expo-web-browser + expo-crypto, new deps) exposes `useGoogleSignIn`; `auth.ts` gained `signInWithGoogleIdToken` (`GoogleAuthProvider.credential` + `signInWithCredential`) and `sendVerificationEmail`. Paste the three OAuth client ids at the top of `googleAuth.ts` (setup steps documented in the file). Google blocks OAuth inside Expo Go (exp:// redirect), so there the button explains and defers to email; in the M4 dev build it completes with zero code changes. Google logins skip OTP (email already verified). Face ID relock, forgot password via `resetPassword`, and the offline mock path (which now exercises the OTP step too) all preserved.

### M5.5-auth v17 ✅ — Auth polish + app-wide touch-lag fix
1. **Touch lag EVERYWHERE fixed:** `TrajectoryCurve` (Charts.tsx) ran an INFINITE `Animated.loop` with `useNativeDriver:false` to pulse the chart marker. Animated SVG props update on the JS thread, so once Home or Goals mounted, ~60 JS updates/sec ran forever and starved Pressable + scroll gesture handling across the whole app ("tap several times before anything moves"). The halo is now static; a PERF comment in Charts.tsx forbids reintroducing unbounded JS-driven loops. This is effectively CRITICAL RULE 3.9.
2. **Light default enforced:** persist bumped to **version 3**; migration resets any stored dark/system choice to light ONE time (testing installs had dark persisted). app.json `userInterfaceStyle` and root `backgroundColor` now light so the pre-JS frame matches.
3. **Auth card is solid and simple** per owner feedback: `t.sheet` background (white light / deep-green dark), soft shadow, thin border. NO glow, NO blur on auth. GlassCard is no longer used there.
4. **Wordmark (v18):** the owner supplied updated logo art with a soft shadow baked into the artwork; `assets/logo-wordmark.png` is the owner-supplied transparent PNG (alpha-cropped with padding so the baked shadow survives, resized to 840px wide, aspect ~2.47, slot 150x61). Runtime shadow props removed. If the logo changes again, swap the asset rather than adding shadow styles.
5. **Register password UX:** Retype Password field + live rule chips (8+ characters, a letter, a number, passwords match) enforced on submit with specific error copy.
6. **Register fits one screen** on regular iPhones: compact brand block, "Already have an account? Log in" moved under the title (reference-style) replacing the bottom switch row, Remember me is Login-only, tightened paddings. ScrollView remains as a fallback for SE-size phones and open-keyboard states.

### M5.5 v20 ✅ — Cents brand mark + touch-responsiveness pass 2
**Cents mark:** the owner's yellow cent-with-sparkles logo replaces the Ionicons "sparkles" glyph everywhere Cents appears: nav center button (30px), hub head badge (26px), chat mini avatars (16px), scan panel avatar (16px, white variant). Assets: `assets/cents-mark.png` (yellow, square-padded 256px) and `assets/cents-mark-white.png` (auto-derived white fill for dark chips).
**Touch pass 2 — rule 3.1 violations were live on FOUR screens.** `dashboard.tsx` defined `BalanceCard`, `CardHeader`, and `Section` inside the render body; `wallet.tsx` had `InstTile` inline; `profile.tsx` had `Row` inline. Because tab screens subscribe to the whole finance store, ANY store change re-rendered them and the inline component types made React REMOUNT those subtrees, killing in-flight taps and scroll gestures. All five are module-scope with explicit props now. Additionally both Home carousels moved to the NATIVE driver (`useNativeDriver: true` on the Animated.events, and the page-dot `width` interpolation became `scaleX` since width is not native-animatable, base dot width 20), so swipes no longer do ANY JS work per frame.
**Also tell the tester:** Expo Go dev mode (`npx expo start`) runs unminified JS with dev checks and is inherently 2 to 5x slower than release. To judge real responsiveness run `npx expo start --no-dev --minify` once.

### M5.6-start v21 ✅ — Cents quick dial (center-button gesture)
The center Cents button is now a gesture surface via ONE PanResponder (`CentsButton` in `(tabs)/_layout.tsx`): tap = hub (unchanged); swipe up OR hold 220ms = the quick dial fans out above the notch with three matte-glass chips (Cents AI, Cents Scanner, Cents Voice); keep dragging to highlight (yellow ring + glow + selection haptics) and release to launch; release in place = the dial PINS and chips become tappable; backdrop tap or button tap dismisses. State lives in `store/ui.ts` (`quickOpen` / `quickDragging` / `quickIndex` + actions; `openHub`/`openChat`/`openScan` all clear it) so the button gesture and the `CentsQuickDial` overlay (`src/components/cents/CentsQuickDial.tsx`, mounted in TabLayout under the hub) stay in lockstep. Launches: AI = `openChat()`, Scanner = `openScan()`, Voice = `openChat({ voice: true })` (same as the hub mic CTA). Styling per the locked language + owner spec: glass chips (clipped BlurView, rule 3.3), emerald gradient badges with yellow marks (`assets/cents-mark.png`, new `assets/cents-scan-mark.png`), brand yellow `t.centsYellow = #FFDE59` (sampled from the logo, now in theme). Geometry constants + `quickIndexForDy` exported from CentsQuickDial.tsx; if the bar geometry in §3.5 changes, update QUICK_FIRST_BOTTOM there too. v22 fix: the chip Pressable must stay flex:1 or the flex:1 glass layer inside collapses to 0 height and the chips render as border hairlines (device-verified failure mode: "just lines").

### v23 ✅ — Dial restyle + chat and voice polish (owner feedback round)
1. **Quick dial buttons** are now icon-only circles that mirror the Cents button exactly: same 56px top-lit emerald gradient, same emerald shadow, NO borders, NO labels (labels live on accessibilityLabel). Icons: yellow Cents mark (AI), yellow scan-corners mark (Scanner), yellow mic (Voice). Highlight while dragging = swell + brand-yellow glow ring drawn ABOVE the gradient. Geometry now 56 + 12 gap (step 68); `quickIndexForDy` updated to match.
2. **Voice overlay X stays put:** the dial's Voice option launches `openVoice()` standalone (NOT `openChat({voice:true})`), so closing with X returns to whatever screen the user was on. A successfully finished transcript still opens chat to show Cents replying, and "Type instead" now opens chat explicitly (a composer, not a dead end). The hub mic CTA keeps its chat-first behavior.
3. **Chat header:** the top scan button is REMOVED (scanning lives in the composer camera button, the dial, and the hub); a 40px spacer keeps the title centered. Title is now "Cents AI" + status dot with the "AI coach" subtitle removed.
4. **Chat avatars:** the Cents mark sits plain inside a neutral hairline circle — no emerald fill behind it (miniAvatar: transparent bg, borderColor t.border, radius 13).

### v24 ✅ — Dial arc + highlight naming (owner feedback)
1. **Arc layout:** the three dial buttons now fan out on a CURVE around the Cents button (Scanner up-left at dx -78 / rise 72, Cents AI at the top rise 106, Voice up-right at dx 78 / rise 72) instead of a vertical line — easier to drag-select. Selection is nearest-target 2D matching (`quickIndexForGesture(dx, dy)`, 48pt dead zone, 92pt capture radius); the old `quickIndexForDy` is gone. Option order in `QUICK_OPTIONS` is now scan / ai / voice and commits key off `QUICK_OPTIONS[i].key` in BOTH commit paths.
2. **No duplicate Cents button:** the AI option wears a yellow chat bubble now, not the cent mark — the mark directly above the identical main button read as the button appearing twice.
3. **Highlight = name reveal:** the highlighted button swells (1.14) with the yellow glow ring AND shows a small dark name pill above it ("Cents AI" / "Cents Scanner" / "Cents Voice"); unhighlighted buttons stay icon-only.
4. **Thicker scanner mark:** `assets/cents-scan-mark.png` regenerated with a dilated (fattened) stroke; the original hairline corners read too thin at 26px.

### v25 ✅ — Chat scroll fix + dial label polish
**Chat scroll (owner: "cannot scroll, takes many tries"), three causes fixed in CentsChatModal:**
1. The FlatList was WRAPPED IN A PRESSABLE (tap-blank-to-dismiss-keyboard). A Pressable parent joins responder negotiation on every touch, so scroll drags started dead. Wrapper removed; keyboard dismissal = interactive drag + chevron. Never wrap scrollables in Pressable/Touchable.
2. AppearIn ran on EVERY renderItem, so old rows mounting during upward scrolls faded in from blank (cost + "frozen list" look). Now only index 0 (newest, inverted list) animates.
3. Every Cents bubble was its own BlurView over the blur-80 backdrop; long threads stacked a UIVisualEffectView per bubble and dropped frames. Bubbles now use the translucent-fill alternative rule 3.3 sanctions (dark fill deepened to keep the matte look; the full-screen backdrop still provides the glass depth). If the owner dislikes the dark-mode bubble tone, tune the Glass gradient, do NOT reintroduce per-bubble blur.
**Dial labels:** highlight pill is now white, small (11px, deep-forest text), single-line, with an explicit 120px width + left offset — an absolute child sized by the 56px button wrapper had wrapped its text into a vertical blob. v26: the highlighted button gets zIndex 10 / elevation 20 so its pill renders OVER neighboring buttons (the Scanner pill used to slide under the AI button).

### M5.6 part 1 ✅ (v27) — Truth pass: real numbers everywhere they were fake
1. **`src/utils/stats.ts` (new):** `savingsSeries` (D last 7 days / W last 5 Monday-start weeks / M last 5 months / Y last 5 years, net per bucket, bars clamp at 0 while `net` keeps the sign), `savingsNote` (honest latest-vs-previous comparison copy, no invented streaks), `weeklySavingsRate` (net of last 28 days / 4; 0 = no pace), `paceLabel` ("Reached" / "No pace yet" / "N wks left").
2. **Home savings chart** now computes from real transactions via those utils; the hardcoded sample series and fictional note lines are gone. Sub-labels adjusted ("Last 7 days").
3. **Goals pace** uses the real 28-day rate; the `weekly = 500` constant is gone. Empty history shows "No pace yet" instead of a fabricated countdown; reached goals say "Reached".
4. **Budget month rollover:** persist bumped to **v4** adding `lastRollover` (YYYY-MM, in state + CloudSnapshot + buildSnapshot; migration seeds the current month so upgrades never retro-wipe). `rolloverBudgetsIfNeeded()` runs after hydration AND on Home mount: recomputes each budget's `spent` from the current month's transactions (not zeroed) and advances past-month `dueDate`s monthly until current. Idempotent per month.
5. **Transaction edit/delete:** store gained `updateTransaction` / `removeTransaction` built on one `applyTxEffect(sign)` helper — reverses old effects, applies new, so account balances and budget spent stay consistent (same clamp-at-0 rules as addExpense). Analytics rows are now pressable and open a bottom-sheet `TxEditor` (module scope, rule 3.1): description, amount, budget chips for expenses, Save + confirm-Delete. Home "Recent activity" rows route to Analytics where the editor lives.
Part 2 shipped in v28 (see below).

### M5.6 part 2 ✅ (v28) — Local notifications, locale formatting, empty states
1. **Local notifications** (`src/services/notifications.ts`, new dep expo-notifications ~0.32.17, works in Expo Go on iOS and the dev build; no push backend):
   - **Bill due tomorrow:** scheduled at 9:00 AM the day before each budget dueDate; `src/hooks/useNotificationSync.ts` (mounted in root _layout next to useCloudSync) wipes and reschedules 1.2s after budgets change. The hook lives in its own file because the STORE imports `notifyBudgetCrossings` from the service; importing the store back into notifications.ts would create a require cycle.
   - **Budget at 90 percent:** `notifyBudgetCrossings(prev, next, enabled)` fires an immediate alert when a spend pushes a budget across 0.9 (special copy at fully used). Called after addExpense, updateTransaction, and confirmAction (chat/scan confirms). Compared by category id.
   - Foreground handler shows quiet banners (no sound/badge). Everything respects `notificationsEnabled`, and the Profile toggle is now REAL: enabling requests iOS permission and snaps back with directions if system-denied.
2. **Per-country formatting:** `peso()` now groups via a module `NUMBER_LOCALE` (`setNumberLocale`), each `Country` entry gained a `locale` (en-PH, en-US, en-SG, ms-MY), and both `setCountry` and store rehydration resync it. The en-PH hardcode is gone.
3. **Empty-state audit:** the Home goal insight slide rendered BLANK with no goals; it now shows a "No goal yet" card pointing at the Goals tab. Goals, Budgets, Wallet, Analytics list, and chat overload states already had proper empties (verified).

### M5.6 part 3 ✅ (v29) — Coaching notifications (owner: "check-ins and so on")
`src/services/notifications.ts` rebuilt as the full coach set, all local, all quiet banners, all under the one Profile toggle:
- **Evening check-in, 8 PM:** only the NEXT one is ever scheduled; today's is skipped if the user already logged something, and a lapsed user gets exactly one nudge then silence (anti-spam by construction). Four rotating copy lines picked deterministically by date.
- **Weekly recap, Sunday 7 PM:** anchored to the first goal by name. Copy quotes NO numbers on purpose: scheduled content is frozen at schedule time and a stale figure would violate the honesty rule.
- **Bill due today, 9 AM** added alongside the existing day-before reminder.
- **Goal milestones (25/50/75/100):** `notifyGoalMilestones(prev, next, enabled)` fires the highest newly crossed threshold only. WIRED BUT DORMANT: nothing mutates goal.current yet, so the Goals redesign (M5.5-finish item 2) must add contributions and call this from the mutating action. Do NOT call it from replaceAll, cloud restores must not fire celebrations.
- Hook `useNotificationSync` now feeds categories + transactions + goals; sync stays wipe-and-reschedule, debounced 1.2s.

### v30 ✅ — Every bottom sheet is draggable; budget name fix
1. **Drag-to-dismiss** (`src/hooks/useDragToDismiss.ts`, new): the handle pills were decorative. One PanResponder + Animated.Value per sheet: the sheet follows a downward drag, release past 110px or a fast flick slides it out and dismisses, less springs back. Wired on SIX sheets: hub (menu/expense/income), goals New goal, goals New/Edit budget, wallet Add account, wallet balance editor, analytics TxEditor. The responder attaches to a GRAB ZONE around the handle only, never the whole sheet — a whole-sheet responder would steal vertical scrolls from inner ScrollViews/inputs (same bug class as the v25 chat FlatList Pressable). Chat's scan sheet has no handle and keeps its tap-scrim dismissal.
2. **Budget category no longer overwrites the name field** (owner report): picking a category sets only the icon and grouping; the typed name is untouched, and a blank name still falls back to the category name at submit (existing behavior in submitBudget).

---

## 3. CRITICAL RULES — every future session must respect these

**Design (owner-locked, with device screenshots on file):**
1. Chat = the v4 language: centered title + dot header (NO avatar block), soft top glow (NO aurora circles), left-aligned hero (NO orb), tinted emerald icon chips (NOT gradient-filled), matte bubbles. NO sheen/gloss overlays on any surface. NO gradient hairline borders.
2. White on emerald in BOTH themes (`darkPalette.onEmerald = '#FFFFFF'`). Never dark icons/text on green.
3. Nav bar: icons only, docked-notch center button. Bare photos in chat: hairline border only.

**Engineering gotchas (each one bit us):**
1. **Never define components inside a render body.** Inline component types remount the subtree per keystroke and replay entrance animations (the "blinking" bug). Module scope + props.
2. **Never put a shadow and `overflow: 'hidden'` on the same view** (iOS masksToBounds crops the shadow). Shadow wrapper outside, clipping child inside.
3. **Every BlurView needs an overflow-hidden radius-matched parent**, or use a translucent fill instead (unclipped BlurView renders as a SQUARE).
4. **Horizontal carousels whose items cast shadows** need `contentContainerStyle paddingVertical` + compensating negative `marginVertical` or the ScrollView slices the shadow into a straight band.
5. **The notch arc must use SVG large-arc-flag = 1** (`A R R 0 1 0`). Flag 0 silently renders the shallow arc ~24px off. When changing the notch, RENDER the path to an image first (cairosvg) before shipping. Geometry: arc R=36, endpoints cx∓34 at y=8, bowl bottom = arcCenterY + R = 56 ≤ 56; bottom gap = bowlBottom − (buttonTop + 56); side gap ≈ sqrt(R² − (arcCenterY − btnCenterY)²) − 28.
6. **No KeyboardAvoidingView inside absolute/transformed overlays** — use `useKeyboardInset`.
7. iOS camera-presentation queue rules are GONE with ImagePicker's system camera; only `launchImageLibraryAsync` remains (no conflict). Do not reintroduce system-camera launches from sheets.
8. Dark sheets use deep-green glass fills, never white-over-blur.

---

## 4. Firebase project state

Project `savecents-78a95`, Spark plan, AI Logic via Gemini Developer API. **`src/services/firebaseConfig.ts` is NOT in the zip — re-paste the real config after every extraction** (Firebase console → project settings). App Check enforcement manually OFF for AI Logic — MUST re-enable with App Attest/Play Integrity before launch.

---

## 5. Repo structure

```
index.ts                       # polyfills FIRST, then expo-router entry
app/
  _layout.tsx                  # themed bg + aurora; ROOT Stack: profile slide_from_right lives here
  index.tsx / auth.tsx         # auth gate
  profile.tsx                  # pushed Profile screen
  (tabs)/_layout.tsx           # notched liquid-glass bar + Cents overlay stack (Hub, Chat, Scan, Voice)
  (tabs)/dashboard.tsx         # Home (carousels have the shadow-room padding, see rules)
  (tabs)/wallet.tsx / goals.tsx / analytics.tsx
src/
  components/GlassCard.tsx     # shadow wrapper / clipping child split — do not merge
  components/Avatar.tsx / Charts.tsx / MoneyInput.tsx
  components/cents/            # CentsHub, CentsChatModal, ScanOverlay, VoiceOverlay
  hooks/useKeyboardInset.ts    # the keyboard fix — reuse for any new overlay
  data/countries.ts            # countries, institutions, BUDGET_CATEGORIES
  models/types.ts              # ChatMessage, Transaction.accountId, Category.category/dueDate
  services/cents.ts            # brain: context, multi-action schema, retry chain, vision prompts
  services/auth.ts / otp.ts / voice.ts / sync.ts / firebaseApp.ts / firebaseConfig.example.ts
  store/finance.ts             # persist v2; buildBrainContext; multi-action fan-out; executeAction
  store/ui.ts                  # hub/chat/scan(+mode)/voice overlay state, never persisted
  theme/colors.ts              # onEmerald WHITE in both modes
  polyfills.ts                 # KEEP
```

**Deps pinned for SDK 54:** expo-auth-session ~7.0.11 (+ expo-web-browser, expo-crypto) for Google Sign-In, expo-camera ~17.0.10, @react-native-masked-view/masked-view 0.3.2, expo-print ~15.0.8, expo-sharing ~14.0.8, expo-file-system ~19.0.23 (Analytics imports `expo-file-system/legacy`). Always `npm install --legacy-peer-deps` (npm, not npx — `npx install` fails with "could not determine executable").

---

## 6. Dev workflow

1. Project at `C:\Projects\savecents-rn`, VS Code → PowerShell.
2. **Replacing from a zip: DELETE the old folder first, then extract fresh** (leftover route files get auto-registered by expo-router and shadow new screens).
3. Re-paste `src/services/firebaseConfig.ts`, then `npm install --legacy-peer-deps`.
4. First start after replacement: `npx expo start -c`; then normal `npx expo start`.
5. Pre-handoff checks: `npx tsc --noEmit` clean + `npx expo export --platform ios` bundles.
6. **Still strongly recommended: `git init` + GitHub** so updates arrive as diffs and the zip-ghost bug class dies.

---

## 7. Known tech debt / seams (intentional, tracked)

| Item | Where | Plan |
|---|---|---|
| v14–v15 notch geometry not yet device-verified | (tabs)/_layout.tsx | First thing next session: check the docked button gap on device; tune via the formulas in §3.5 |
| OTP email needs a backend (now used by sign-up verification AND password change) | services/otp.ts `OTP_ENDPOINT` | M6 Cloud Function; today dev shows the code, prod falls back to Firebase verification/reset emails |
| Google OAuth client ids not pasted; flow inert in Expo Go by Google policy | services/googleAuth.ts `GOOGLE_CLIENT_IDS` | Paste web/iOS/Android ids (steps in file); test in the M4 dev build |
| Voice STT needs the dev build | services/voice.ts `loadVoiceModule` | After `eas build --profile development`: install expo-speech-recognition, point the loader |
| Subscription = Free plan + Coming soon | profile.tsx | M6: RevenueCat or free v1 |
| App Check unenforced; model names hardcoded | console; cents.ts | M6: App Attest/Play Integrity; Remote Config |
| Multi-step extraction untested breadth | cents.ts prompt | If the model merges a phrasing into one action, add it as a few-shot example |
| Bank tiles are monograms | countries.ts | Licensed assets later |

---

## 8. NEXT STEPS — the roadmap


### ▶ M5.5-finish — Redesign the remaining tabs (NEXT SESSION)
Bring the rest of the app to the locked design language (matte glass, card physics, quiet headers, white cards):
1. **Device-verify the v15 notch first** (5 minutes; tune with §3.5 formulas + render check if needed).
2. **Goals tab:** redesign to match; add goal CONTRIBUTIONS (mutate goal.current, call notifyGoalMilestones from the action); empty states. (Real weeks-left shipped in v27.)
3. **Wallet tab:** card-style source list (mini bank cards), reorder support.
4. **Analytics tab:** restyle summary/chart shells; add transaction edit/delete.
5. ~~Auth screens~~ DONE in v16 (see M5.5-auth above).

### ▶ M5.6 — Truth pass
Real Home savings chart from transactions, real streaks/deltas, unified weekly rate, budget month rollover, per-country formatting, empty/error-state audit, local notifications (budget 90%, bill due tomorrow).

### ▶ M4-completion — Dev build (one-time)
`eas build --profile development` (free tier, Apple free provisioning). Then: expo-speech-recognition through the voice.ts seam (streaming captions in the shipped overlay), Google Sign-In, SDK upgrades unlocked. Expo Go retires.

### ▶ M6 — Launch
Cloud Function for OTP email; App Check enforced; models via Remote Config; Sentry/Crashlytics; privacy policy + data-safety forms; billing decision; iOS $99 → TestFlight → review; Android $25 → closed testing (14 days / 12 testers) → production.

---

## 9. Paste-ready brief for the next session

> "Continuing SaveCents (React Native + Expo SDK 54 — see HANDOFF.md, build savecents-m5-v15). M0–M5.5 done: icons-only liquid-glass nav with a docked-notch Cents button (SVG-masked blur; notch arc MUST keep large-arc-flag 1 — see HANDOFF §3), full-screen matte-glass Cents chat (design LOCKED per §3, keyboard via useKeyboardInset), in-app camera ScanOverlay (expo-camera: sweep animation, item price estimation, receipt breakdown, talk-over-the-scan), brain with conversation memory + multi-step actions + overload retry chain. Read HANDOFF §3 CRITICAL RULES before writing any UI code. Today: (1) device-verify the v15 notch gap, then (2) M5.5-finish — redesign Goals, Wallet polish, Analytics restyle + transaction edit/delete, and the Auth screens to the locked language. Workflow: DELETE old folder before extracting, re-paste firebaseConfig.ts, npm install --legacy-peer-deps, first start npx expo start -c."

---

## 10. Quick regression script (run after any change, light + dark)

1. **Home:** swipe balance cards (scale/tilt/dim, shadows NOT sliced into bands), eye toggle masks everything, Saved today moves after logging, Needs attention opens Budgets, insights swipe matches.
2. **Nav:** icons only; quick dial: swipe up on Cents -> three chips, slide highlights with yellow ring, release launches; hold + release in place pins it, chips tappable, backdrop closes; plain tap still opens the hub; active tab gets the glass circle; tabs dip on press; Cents button sits in the notch with visible air below and ~8px sides; hold it 220ms → swell + mint glow; tap → hub.
3. **Hub:** dark mode sheet is deep green (not gray); Add Expense from GCash drops the Wallet balance; Add Income to Maya raises it; Scan opens the camera directly.
4. **Camera scan:** item with a price tag → identification + price + affordability card; item with NO tag → estimate clearly marked as estimate; handwritten receipt → total + breakdown + log card; type "saan mas mura?" in the panel → answer from scan context; mic → voice overlay on top; Open chat → same thread; deny permission once → permission screen with Photos import.
5. **Chat:** keyboard rises WITH the composer on top of it; typing causes NO blinking; photo messages are bare with a hairline border; multi-step "add a Groceries budget 9000 and log that receipt there" → two cards in order, both confirm correctly, confirming Log first still works.
6. **Brain resilience:** if Gemini 500s, Cents retries then says the friendly swamped line (never "check your connection" for overload); typed fallback "receipt of Savemore worth 3670" still produces a log card.
7. **Profile/Analytics:** unchanged from M5 — spot-check avatar change reflects on Home, CSV/PDF export respects filters.
