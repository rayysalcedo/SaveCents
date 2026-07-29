# SaveCents — Project Handoff Document
**Last updated:** July 29, 2026 · **Current build:** savecents-m5-v15 (notch arc-flag fix, verified geometry)
**Owner:** Rayy (rayysalcedo@gmail.com) · **Dev environment:** Windows PC + iPhone (Expo Go)

---

## 1. What SaveCents is

AI-powered behavioral personal finance app for Filipinos. Cents (the AI coach) intercepts purchases: users log expenses by chatting naturally (English/Tagalog/Taglish), ask "can I afford this?", and get real trade-off math ("this delays your Hong Kong Trip by 3 weeks"). Zero-based budgeting across PH wallets/banks (GCash, Maya, BPI…), goals with trajectory projections.

**Design direction (locked in this session):** user-friendly, user-focused, NOT techy. Green/White/Sage light theme is the default (deep-green dark theme still available in Profile). Glassmorphism nav bar retained. **Hard content rules: no emojis, no em dashes, no feature disclaimers anywhere in user-facing copy.** Reference aesthetic: modern green fintech (ATM-card balance carousels, white cards, quiet section headers, round avatars).

React Native + Expo **SDK 54** (do NOT upgrade until Expo Go on the App Store catches up, or until the dev build in the M-roadmap). TypeScript, expo-router, zustand.

---

## 2. Current state — what is DONE

### M0–M2 ✅ (scaffold, full UI v1, real Gemini brain)
As per previous handoff: Firebase AI Logic (`firebase/ai`, GoogleAIBackend, NO API key in app), Taglish intent extraction with live budget/goal context injection, structured JSON intents, model fallback chain, offline heuristic parser, Hermes AbortSignal polyfills (KEEP `src/polyfills.ts` imported first in index.ts).

### M3 ✅ — Persistence + real accounts
- zustand `persist` + AsyncStorage, **persist version 2** (see migrations below), `buildSnapshot` is the single source of truth for what is saved locally AND synced.
- Firebase email/password auth (`src/services/auth.ts`) with RN session persistence (`getReactNativePersistence` + ts-ignore — known SDK quirk, do not remove).
- Firestore per-user offline-first sync (`src/services/sync.ts`), Face ID relock on top, in-app account deletion (Apple 5.1.1(v)).

### M4 ✅ — Vision
- Receipt scan + "can I afford this?" price-tag scan via expo-image-picker camera → base64 → same Gemini model → existing action-card flows. iOS camera launch is QUEUED from sheets via Modal `onDismiss` (do not launch camera directly from a sheet button — it hangs silently).
- Voice: premium UI shipped (see M5 below); native STT still needs the dev build.

### M5 (this session) ✅ — Full UI/UX overhaul + Cents interaction system

**Navigation (`app/(tabs)/_layout.tsx`)**
- 5-slot glass pill bar: **Home · Wallet · Cents (center action button) · Goals · Analytics**, with labels.
- Cents is NOT a route: a raised gradient dome button that opens the Cents hub overlay. `chat` route deleted.
- Overlay stack (CentsHub, CentsChatModal, VoiceOverlay) is mounted as siblings above `<Tabs>` inside the tab layout.

**Home (`dashboard.tsx`) — fully redesigned**
1. **Balance card carousel:** ATM-style Total Balance card (chip, contactless mark, NAME + **** holder line, eye toggle that masks every amount on screen), then one branded card per linked source using institution colors. Full-width, no peek; swipe animation = scale 0.8 / lift / dim 0.35 / 6° tilt on off-screen cards. Dots use the JS animation driver (width interpolation cannot use the native driver — don't "optimize" this).
2. **Today strip:** Saved today (net of today's real transactions) + Needs attention (nearest due-dated budget → maxed budget → 85%+ budget → All clear). Taps deep-link to the Budgets tab.
3. **Insights carousel** (goal trajectory / allocation / savings / top spend): identical step + swipe animation as the balance cards, uniform card heights (GlassCard blur/inner have flexGrow so `minHeight` actually stretches the glass).
4. **Budgets list** (rows with icon, due-date chips, slim bars) and **Recent activity** (icons resolved from the transaction's budget), quiet section headers with Manage / View all links.
- Header: greeting + nickname left, **round avatar button top-right** (chosen animal avatar or first+last initials) → Profile. No bell.

**Wallet tab (`wallet.tsx`)** — account management extracted from the old Profile: green hero total with source chips, linked-sources list (tap = balance editor, kind labels), one-tap country presets + custom account sheet.

**Cents hub (`src/components/cents/CentsHub.tsx`)** — glass bottom sheet from the center button: quick actions **Add Expense** (amount, budget chips, optional Pay-from account, note), **Add Income** (amount, REQUIRED route-to account dropdown, note), **Scan** (opens chat + auto-opens camera sheet), plus the Chat with Cents entry with mic button. Store actions `addExpense`/`addIncome` adjust budgets AND account balances and mirror a message into chat. Rendered as an animated absolute overlay, NOT an RN Modal (protects the iOS camera-presentation rules).

**Cents chat (`CentsChatModal.tsx`)** — the old chat tab converted to an in-context overlay: screen behind stays visible through a darkened blur, panel slides up, tap-above or X to dismiss. All action cards / Taglish buttons / camera sheet intact. Mic opens the voice overlay.

**Voice (`VoiceOverlay.tsx` + `src/services/voice.ts`)** — full-screen "Speaking to Cents": pulsing rings + breathing glow, live transcript with caret, send/cancel, en·fil. **Native STT cannot run in Expo Go.** `voice.ts` has ONE seam (`loadVoiceModule`): after the dev build, `npm i expo-speech-recognition` and point the loader at it — nothing else changes. Until then the overlay shows a single "coming soon" line + type-instead.

**Budgets model** — `Category` now has `name` (display, e.g. "Meralco Bill"), `category` (base category for icons/AI filing), `dueDate?` (optional, drives Needs attention + due chips). Goals budget sheet: category grid → name field (pre-fills from category) → limit → optional due-date toggle + native picker. Goals screen honors `?tab=budgets` deep link.

**Profile (`app/profile.tsx`)** — pushed screen (NOT a tab; slide_from_right declared in the ROOT `app/_layout.tsx` — per-screen `Stack.Screen` options are too late for entrance animations). Layout: round avatar with pencil badge → nickname → email → **Free plan card with Manage (Coming soon alert)** → Account (**Nickname & avatar / Login / Password**) → Preferences (Notifications toggle, animated Light/Dark/Auto, Country & currency) → Privacy & Security (Face ID toggle, Help & support mailto, Delete account) → full-width green Log out.
- **Nickname & avatar sheet:** nickname (max 20) + 6 choices: initials or 5 SVG cartoon animals (panda/fox/cat/dog/penguin) in `src/components/Avatar.tsx` — vector, gradient-shaded, no image assets. Persisted on `profile.nickname` / `profile.avatarId`, used in the Home header.
- **Password flow (OTP-first):** Send code → 6-digit verify (10-min expiry, 5 attempts, resend) → new password (8+ chars, match) → real Firebase `updatePassword`; `auth/requires-recent-login` auto-falls back to a real reset email. See `src/services/otp.ts` and §6.

**Analytics tab (`analytics.tsx`)** — search (description/category/amount), All/Income/Expenses chips, In/Out/Net pills, net-saved-by-month computed from REAL transactions, spend-by-budget, day-grouped list, **CSV export** (expo-file-system/legacy + expo-sharing) and **PDF report** (expo-print) that respect the active filters.

**Store additions** — `Transaction.accountId?`, `notificationsEnabled`, `updatePersona`, `addExpense`, `addIncome`; `src/store/ui.ts` = ephemeral overlay coordination (hub/chat/voice/camera-handoff), never persisted.

**Persist migrations** — version 2: existing installs are switched to the light theme ONCE (users can re-pick dark). Add future migrations in `migrate()` in `finance.ts`; optional new fields don't need one.

### M5.5i (this session) ✅ — Carousel shadow room + deeper docked notch

**ATM-card "cropped shadow" FIXED (different cause than GlassCard)** — the balance carousel's shadow/clip split was already correct; the slicing came from the horizontal Animated.FlatList clipping its children: the card shadow extends ~44px below the card and the scroll container's bounds cut it into a straight band. Fix: the list gets `marginVertical: -44` + `contentContainerStyle paddingVertical: 44` (layout unchanged, shadow has room). Insights carousel got the same treatment (-30/30) since GlassCard shadows now extend after M5.5h. RULE: any horizontal carousel whose items cast shadows needs vertical content padding + compensating negative margins. Bank card shadow is also mode-tuned now (light: #0B3A2E at 0.22 instead of the 0.5 dark smudge).

**Notch geometry (v15, VERIFIED by rendering the path)** — CRITICAL SVG GOTCHA: the notch arc must use **large-arc-flag = 1** (`A R R 0 1 0 …`). With flag 0, SVG draws the shallow MINOR arc (center above the chord) and the bowl silently renders ~24px shallower than calculated; v14 shipped that way and the button visibly touched the glass. Current numbers: arc R=36, endpoints cx∓34 at y=8, large-arc 1 sweep 0 → deep bowl centered (cx, 20), bottom y=56 of the 64 bar; button 56px at top −10 → 10px above the bar, ~8px side gaps, 10px air below. Retune math (only valid with large-arc=1): bowl bottom = arcCenterY + R ≤ 56; bottom gap = bowlBottom − (top + 56); side gap ≈ sqrt(R² − (arcCenterY − btnCenterY)²) − 28. When changing the notch, RENDER the path first (cairosvg one-liner) rather than trusting the numbers.

### M5.5h (this session) ✅ — Docked-notch nav bar + light-mode card shadow fix

**Nav bar: TRUE carved notch (docked-FAB style, reference on file)** — the pill now has a concave cradle cut into its top center and the Cents button floats IN the notch with a visible gap around it. Implementation: BlurView cannot be path-clipped, so the glass shell (blur + mode fill) is wrapped in **@react-native-masked-view/masked-view 0.3.2** (SDK-54 bundled pin, works in Expo Go) with an SVG mask of `notchedBarPath(w)` (capsule H=64, cap R=32, notch R=37, shoulder Q-curves), and the SAME path is stroked on top as the 1.2px border (a plain borderWidth cannot follow the notch). Bar width measured via onLayout. The button (56px gradient circle, top:-24, shadow wrapper OUTSIDE clip wrapper) keeps press-dip / hold-swell / mint glow physics. The old bulge disc is gone: the notch IS the cradle. If the gap looks off on a device, tune NOTCH_R (37) vs button size (56) vs top (-24) together.

**Light-mode "weird and cropped" card shadows FIXED** — GlassCard had its shadow AND overflow:'hidden' on the same view; iOS masksToBounds crops the shadow. The wrapper now only carries radius + shadow (slightly richer: #0B3A2E, opacity 0.09, radius 18, y 8) and the blur child does the clipping. Same rule as the nav bulge fix: shadow and clipping never live on one view.

### M5.5g (this session) ✅ — Nav bulge square-bleed fix + gentler press physics

**Square behind the Cents button FIXED** — BlurView renders as a RECTANGLE unless clipped by an overflow-hidden parent; the center bulge's BlurView wasn't clipped, so a square blur patch bled out behind the circular button (device screenshot on file), and that same patch moving during the press-scale animation was the "blurs when I click" complaint. Fix: the bulge now has NO BlurView at all (translucent fill + 1px border reads as glass with zero artifacts), split into an outer shadow wrapper (centerShadow, marginTop -14) and an inner overflow-hidden circle (centerBulge) because iOS shadows and overflow:hidden fight on one view. RULE: every BlurView must sit inside an overflow-hidden, radius-matched parent; where that's impossible, use a translucent fill instead.

**Press physics softened** — deep scale dips render icons soft mid-transform. Tab dip 0.82 → 0.92 (friction 6 / tension 320), Cents press dip 0.9 → 0.94. Hold-to-swell (1.08 + mint glow) unchanged.

### M5.5f (this session) ✅ — Blink fix + liquid-glass nav + white-on-emerald

**Chat/scan "blinking" FIXED (root cause, do not regress)** — every subcomponent of CentsChatModal and ScanOverlay (Bubble, Glass, AppearIn, TypingDots, CentsMini, CardLabel, ThreadItem, ScanFrame, GlassRound, Corner) was defined INSIDE the screen component. That creates NEW component types on every render, so typing one character remounted the whole thread and replayed every entrance animation. All subcomponents now live at MODULE scope taking {styles, t, ...} props (Bubble and ThreadItem are React.memo). RULE: never define components inside a render body in this codebase.

**darkPalette.onEmerald changed '#04140D' → '#FFFFFF'** — owner dislikes dark icons/text on emerald. Both themes now use white on emerald everywhere (hub badge, CTA, confirm buttons, center nav button). The hub CTA subtitle is white in both modes too.

**Nav bar: realistic liquid glass, ICONS ONLY** (`app/(tabs)/_layout.tsx` rebuilt, reference on file): matte glass pill (blur 85 + mode-tuned fill + 1px border, NO bright top gradient), labels REMOVED (kept as accessibilityLabel), icons 22 with outline↔filled swap, focused state = soft emerald-tint glass circle popping in via spring, every tab dips (scale 0.82) on touch and springs back. Center Cents button is a LIQUID BULGE fused into the pill: a 74px translucent glass disc swelling above the bar (marginTop -14) containing the 54px emerald gradient core; press dips it, HOLD (220ms) swells it to 1.08 with a mint glow ring fading in, release springs back. Bar height 64, insets 20.

### M5.5e (this session) ✅ — Matte liquid glass + hub restyle + bare photo messages

**Matte glass (owner feedback: bubbles looked "super glossy")** — ALL sheen overlays (white top-fade gradients) are removed: chat Glass shell, composer, user text bubbles, hub Chat-with-Cents CTA, scan result panel. Surfaces are now matte liquid glass: blur + one soft fill gradient + thin translucent border. The LOCKED design list from M5.5d now also includes: no sheen/gloss overlays on any Cents surface.

**Cents hub matched to the chat glass + mode fix** — the hub sheet's dark-mode fill was white-over-blur ('rgba(255,255,255,0.14→0.03)') which rendered GRAY on the dark theme (device screenshot on file). Dark mode now uses deep green glass ('rgba(16,30,22,0.90)' → 'rgba(7,16,11,0.95)') over the blur; light mode is matte white. Tiles, sheet border and the close button branch on t.mode to match the chat bubbles. Do not reuse white-over-blur fills for dark sheets.

**Bare photo messages** — sending a scan no longer shows "Scanned a receipt"/"Scanned an item" and no bubble around the photo: `sendImage` stores text '' and the chat renders caption-less images bare with a StyleSheet.hairlineWidth border (mode-tuned). The brain still gets context: the history builder maps bare photo messages to "Shared a photo to scan".

### M5.5d (this session) ✅ — Multi-step requests + chat design LOCKED

**Multi-intent brain (`cents.ts` + `finance.ts`)** — one message can now carry several actions. `CentsResult` gained `actions: CentsSubAction[]` (schema array of {intent, amount, categoryName, item}, first action mirrored into the top-level fields for fallback). The prompt teaches multi-step extraction ("add a groceries budget of 9000 and log that receipt there" = AddCategory then LogTransaction) plus conversation-reference resolution ("that receipt", "log it", "yun kanina" pull the amount/item from history, never re-ask). `sendChat` fans multiple actions into sequential action cards; categories added earlier in the batch count as existing for later cards (`assumedCategories` in `buildReplyFromResult`), and `executeAction` LogTransaction auto-creates a missing category on confirm (limit = spent = amount) so out-of-order or declined-AddCategory confirms still land somewhere real.

**Chat design LOCKED to the v4 language** (owner preference, device screenshot on file): centered "Cents" + status dot + "AI coach" header with side glass buttons (NO avatar block in the header), soft emerald TOP GLOW (no aurora circles), blur 80, left-aligned hero with NO orb, tinted emerald icon chips (miniAvatar, suggestion icons, sheet icons, NOT gradient-filled), frosted soft-border bubbles with the top sheen, mode-tuned borders/shadows. Do not reintroduce: gradient hairline borders, gradient-filled mini avatars, the header avatar block, aurora blobs, or the hero orb.

### M5.5c (this session) ✅ — Brain resilience + glass refinement

**Gemini overload handling (`cents.ts` `generateStructured`)** — the fallback chain previously advanced ONLY on 404-class errors, so a 500 "model is currently experiencing high demand" killed the call instantly (seen on device with gemini-3.5-flash). Now: transient errors (429/500/503, "high demand", "overloaded", "resource exhausted", "unavailable", "internal error") retry the SAME model once after a 900ms backoff, then advance to the next candidate; only a fully exhausted chain throws `cents-overloaded`. The store shows a friendly "I'm getting a lot of requests right now" line for that case (chat AND vision) instead of the misleading "check your connection". The offline parser also gained log cues (receipt, resibo, worth, total, nagastos, gastos) so typed fallbacks like "receipt of Savemore worth 3670" land as LogTransaction. The dev debug suffix no longer uses an em dash and is suppressed for overload errors.

**Design refinement (feedback: hairlines looked cheap)** — the gradient HAIRLINE borders from v5 are REMOVED everywhere (they rendered as harsh gray outlines in dark mode). Chat bubbles, action cards, suggestion cards and the composer are back to the v4 soft-glass language, upgraded: layered blur + gradient fill + a subtle top sheen + thin translucent border + mode-tuned shadows (all borderColor/shadowOpacity values branch on t.mode so dark and light stay aligned). The hero orb, aurora glows and gradient avatar orbs stay. The scan result panel matches: more translucent fill (the scanned image reads through), soft 1px border, top sheen, deeper drop shadow. The mode icon beside the shutter (mistaken for a button) is replaced by an invisible spacer so the shutter stays centered.

### M5.5b (this session) ✅ — In-app camera scan + premium glass pass

**ScanOverlay (`src/components/cents/ScanOverlay.tsx`, NEW) — Scan is now our own camera experience.** Built on **expo-camera ~17.0.10** (SDK-54 pin, added to package.json + the expo-camera plugin in app.json with the camera permission string; works in Expo Go). The hub's Scan tile calls `openScan()` directly, no chat detour. Flow: full-screen live viewfinder with corner brackets + a sweeping mint scan line (loops), Item/Receipt segmented switch (frame gets taller for receipts), torch, gallery import, big gradient shutter. Capture freezes the shot full-bleed, the scan line keeps sweeping under a "Cents is analyzing" glass chip, then a hairline-bordered glass panel slides up pinned to the bottom of the scanned image: Cents' analysis lines, the compact action card (Confirm/Decline wired to `confirmAction`), and a composer (text + mic + send) so the user keeps talking to Cents right over the scan. "Open chat" closes the overlay and opens the full chat; nothing is lost because every scan message already lives in the chat store (the panel renders `chat.slice(startIndex)`). Mounted in the tab layout between CentsChatModal and VoiceOverlay so voice draws on top. Permission-denied state has its own glass screen with Allow + import fallback. NOTE: ImagePicker's system camera (and its iOS presentation-queue workaround) is GONE from chat; only `launchImageLibraryAsync` remains, called from the overlay, which has no presentation conflict.

**Chat scan sheet simplified** — the chat header/composer scan buttons open a two-option sheet only (**Scan an item / Scan a receipt**), each launching ScanOverlay in that mode above the chat (closing the scan returns to chat). Uploads moved into the overlay's gallery button.

**Premium glass pass (`CentsChatModal.tsx`)** — deeper veil (blur 90), two aurora glows (emerald top-left, teal bottom-right), gradient HAIRLINE borders (LinearGradient wrapper with ~1.2 padding) on Cents bubbles, action cards, suggestion cards and the composer, gradient-filled avatar orbs everywhere (header, bubbles, sheet icons), and a **breathing hero orb** (pulsing concentric gradients) above the centered greeting on fresh conversations. Suggestion cards are now icon-orb + title + prompt + chevron rows. Send button glows.

**ui store (`src/store/ui.ts`)** — `chatOpensScan`/`consumeScanFlag` replaced by `scanOpen` + `scanMode` (`'price' | 'receipt'`) with `openScan(mode?)`/`closeScan`. `openChat` now only takes `{ voice? }`.

---

### M5.5a ✅ — Cents chat redesign + real Scan flow + smarter brain

**Chat keyboard bug FIXED (`CentsChatModal.tsx`)** — root cause: KeyboardAvoidingView mis-measures inside absolutely-positioned + transformed overlays (the old panel's exact setup), so the keyboard covered the composer. KAV is gone; the overlay now tracks the keyboard frame itself via a `useKeyboardInset()` hook (`keyboardWillChangeFrame` on iOS with the keyboard's own animation duration, did-show/hide on Android) and animates a bottom spacer. Do not reintroduce KAV in any absolute/transformed overlay. The CentsHub keeps its KAV — its KAV wraps the whole window frame, which is why it never had the bug.

**Chat UI — full liquid-glass redesign (`CentsChatModal.tsx`)** — the chat is now a FULL-SCREEN glass overlay: the screen the user was on stays visible through an 80-intensity blur + theme gradient veil + soft emerald top glow. Minimal header (glass chevron-down close · Cents + online dot · glass scan button). Fresh conversations (only the seeded greeting in `chat`) open on a hero: "Hello, {nickname}" + "What should we do with your money?" + three glass suggestion cards that send real prompts. Ongoing conversations show the thread: user bubbles are emerald-gradient glass with a sheen (right, tail bottom-right), Cents bubbles and action cards are frosted `Glass` shells (blur + white gradient + border, tail bottom-left). Floating glass composer pill (camera · input · mic · gradient send) with glass quick-prompt chips above it. All action cards, Taglish buttons, handled chips, image bubbles and the entrance animations are intact.

**Scan is now a real feature** — the hub's Scan tile calls `openChat({ scan: true })` (ui store flag renamed: `chatOpensScan` / `consumeScanFlag`), which opens chat and auto-presents the new "Scan with Cents" sheet: **Scan an item / Scan a receipt / Upload an item photo / Upload a receipt photo**. Item scans: Gemini identifies the product (brand/model when recognizable), reads the price off the tag OR estimates the typical PH market price when no price is visible (`priceIsEstimate` flag, the reply says it's an estimate), shares a short analysis (`details`: what it is, what it goes for, where it's cheapest, one buying tip), then flows into the existing affordability/negotiation card. Receipt scans: reads the final total (handwritten-receipt rules retained), `details` breaks down store/line items/discounts/category, the reply invites the user to log it or ask about it, then the confirmation card appears. The user continues via chat or voice as usual. iOS camera QUEUE rules unchanged (actions run from Modal `onDismiss` — never launch the camera from a sheet button).

**Smarter brain (`cents.ts` + `finance.ts`)** — every brain call (text AND vision) now receives `buildBrainContext()`: nickname, today's date, budgets, goals, liquid balance, the 8 most recent transactions, and the last 12 chat turns (action-card prompts are flattened to text). Follow-ups like "yes", "how about 500?", or questions about a just-scanned item resolve from conversation memory. `CentsResult` gained `details` and `priceIsEstimate` (schema updated); temperature 0.2 → 0.3 for warmer replies. Vision `sendImage` now posts the analysis (reply + details) first, then the action card; a readable-but-priceless photo asks for the price instead of dead-ending. Legacy `receiptScan` confirm no longer hardcodes the Pets category (files to Others). Prompts now explicitly enforce the no-emoji / no-em-dash content rules and the touched fallback strings were cleaned of em dashes.

---

## 3. Firebase project state

Unchanged from previous handoff: project `savecents-78a95`, Spark plan, AI Logic via Gemini Developer API, web app registered. **Config lives in `src/services/firebaseConfig.ts` — the repo/zip ships a placeholder; re-paste the real config after every zip extraction** (it is in the old handoff §3 and in Firebase console → project settings). App Check enforcement manually OFF for AI Logic — MUST re-enable with App Attest/Play Integrity before launch.

---

## 4. Repo structure

```
index.ts                       # polyfills FIRST, then expo-router entry
app/
  _layout.tsx                  # themed bg + aurora; ROOT Stack: profile gets slide_from_right here
  index.tsx / auth.tsx         # auth gate, Firebase email/password + Face ID relock
  profile.tsx                  # redesigned Profile (pushed screen, no tab bar)
  (tabs)/_layout.tsx           # 5-slot glass bar, center Cents button, overlay stack mounted here
  (tabs)/dashboard.tsx         # Home: card carousel, today strip, insights, budgets, activity
  (tabs)/wallet.tsx            # sources management
  (tabs)/goals.tsx             # Plan: goals + budgets (name/category/limit/dueDate), ?tab=budgets
  (tabs)/analytics.tsx         # search/filter/charts + CSV/PDF export
src/
  components/Avatar.tsx        # 5 SVG animal avatars + initials fallback (AvatarBadge)
  components/GlassCard.tsx     # glass card; blur/inner flexGrow (uniform-height support)
  components/Charts.tsx / MoneyInput.tsx
  components/cents/            # CentsHub, CentsChatModal, VoiceOverlay
  data/countries.ts            # countries, institutions (colors/kinds), BUDGET_CATEGORIES
  models/types.ts              # + Transaction.accountId, Category.category/dueDate, profile persona
  services/auth.ts             # + changePassword (OTP-gated callers only)
  services/otp.ts              # email OTP: OTP_ENDPOINT seam, dev delivery, reset-email fallback
  services/voice.ts            # STT seam for the dev build
  services/cents.ts / sync.ts / firebaseApp.ts / firebaseConfig(.example).ts
  store/finance.ts             # persist v2 + migrate; addExpense/addIncome/updatePersona
  store/ui.ts                  # overlay state (hub/chat/voice), never persisted
  theme/colors.ts              # light-first sage palette + dark; sage tokens
  polyfills.ts                 # KEEP
```

**Deps added this milestone (SDK-54 pinned):** expo-print ~15.0.8, expo-sharing ~14.0.8, expo-file-system ~19.0.23 (Analytics imports `expo-file-system/legacy`). Install always with `npm install --legacy-peer-deps`.

---

## 5. Dev workflow — READ THIS, it bit us twice

1. Project lives at `C:\Projects\savecents-rn`. VS Code → PowerShell.
2. **When replacing from a zip: DELETE the old folder first, then extract fresh.** Extracting over an existing folder cannot delete removed files; leftover route files get auto-registered by expo-router and SHADOW new screens (this exact bug: stale `app/(tabs)/profile.tsx` + `app/(tabs)/chat.tsx` hijacked the redesigned Profile for two sessions). If you must extract over: delete `app/(tabs)/profile.tsx`, `app/(tabs)/chat.tsx`, `src/components/Illustration.tsx` if present.
3. Re-paste `src/services/firebaseConfig.ts`, then `npm install --legacy-peer-deps`.
4. First start after a replacement: `npx expo start -c` (clear Metro cache). Then normal `npx expo start`.
5. Pre-handoff checks: `npx tsc --noEmit` clean + `npx expo export --platform ios` bundles.
6. **Strongly recommended next session: `git init` + push to GitHub** so updates arrive as diffs that CAN delete files and this whole zip-ghost class of bug dies.

---

## 6. Known tech debt / seams (intentional, tracked)

| Item | Where | Plan |
|---|---|---|
| OTP email needs a backend | `src/services/otp.ts` `OTP_ENDPOINT` | M6: tiny Cloud Function (email relay). Today: dev shows the code in a dialog; prod without endpoint falls back to a real Firebase reset email |
| Voice STT needs dev build | `src/services/voice.ts` `loadVoiceModule` | After `eas build --profile development`: install expo-speech-recognition, point the loader at it |
| Savings D/W/M/Y chart data on Home is hardcoded | dashboard `savingsData` | M5.x: compute from transactions (Analytics already computes monthly for its own chart — reuse) |
| Goal "weeks left" uses weekly=500 constant | goals.tsx | M5.x: reuse the store's real weekly-rate calc |
| Budgets never reset monthly | store | M5.x: month rollover (Transaction now has timestamps; Category.dueDate exists) |
| No edit/delete on transactions | Analytics/Home lists | M5.x |
| Subscription = "Free plan" + Coming soon Manage | profile.tsx | M6 decision: RevenueCat IAP or keep free for v1 |
| App Check unenforced; model names hardcoded | Firebase console; cents.ts | M6: App Attest/Play Integrity; Remote Config |
| Debug `[debug — brain error]` line on brain failures | finance.ts sendChat (`__DEV__` only) | Remove before TestFlight |
| Bank tiles are monograms | countries.ts | Licensed assets later; legally safe default |
| en-PH number formatting for all countries | types.ts `peso()` | M5.x nicety |
| Notifications toggle is state only | store/profile | Wire expo-notifications when local alerts land (budget 90% used, bill due) |

**Content rules to preserve in ALL future work:** no emojis, no em dashes, no feature disclaimers in user-facing copy. Every visible button must do something real.

---

## 7. NEXT STEPS — the roadmap

### ▶ M5.5 — Redesign the remaining tabs (NEXT SESSION)
Bring the rest of the app up to the Home/Profile design language (card carousel physics, quiet headers, white cards, round shapes):
1. **Goals tab:** redesign to match (hero goal card with the new card physics? due-chip styling shipped already), real weeks-left calc, empty states.
2. **Wallet tab:** card-style source list (mini versions of the Home bank cards instead of rows?), reorder support.
3. **Analytics tab:** restyle summary/chart shells to the new language; add transaction edit/delete here.
4. **Auth screens:** restyle to the light sage language (currently still the old look), real "Forgot password" using `resetPassword`.
5. **Cents chat/hub polish pass** against the new language.

### ▶ M5.6 — Truth pass
Real Home savings chart from transactions, real streaks/deltas, unified weekly-rate, budget month rollover, per-country formatting, empty/error-state audit, local notifications (budget 90%, bill due tomorrow — the toggle already exists).

### ▶ M4-completion — Dev build (one-time)
`eas build --profile development` (free tier; Apple free provisioning for personal device). Then: expo-speech-recognition wired via the voice.ts seam (streaming captions in the shipped overlay), Google Sign-In, and the SDK can be upgraded freely. Expo Go retires.

### ▶ M6 — Launch
Cloud Function for OTP email; App Check enforced; model via Remote Config; remove debug line; Sentry/Crashlytics; privacy policy + data-safety forms; billing decision (Free plan card is already the placeholder); iOS $99 → TestFlight → review; Android $25 → closed testing (14 days / 12 testers) → production.

---

## 8. Paste-ready brief for the next session

> "Continuing SaveCents (React Native + Expo SDK 54 — see HANDOFF.md, build savecents-m5-v15). M0–M5.5i done: icons-only liquid-glass nav with center Cents bulge, redesigned Home/Wallet/Analytics/Profile, premium liquid-glass Cents chat (aurora glows, gradient hairline borders, breathing hero orb, keyboard fixed via useKeyboardInset — no KAV in absolute overlays), the NEW in-app camera ScanOverlay (expo-camera ~17.0.10: viewfinder + sweeping scan line, Item/Receipt modes, analyze-in-place, talk to Cents over the scanned image, Open chat handoff), and conversation memory in the brain (buildBrainContext into every text/vision call, priceIsEstimate + details fields). Design rules: light sage green/white default, no emojis, no em dashes, no disclaimers, every button real. Today is **M5.5: redesign the remaining tabs** — Goals, Wallet polish, Analytics restyle, and the Auth screens — to match the design language. Workflow: DELETE old folder before extracting the zip, re-paste firebaseConfig.ts, npm install --legacy-peer-deps, first start with npx expo start -c."

---

## 9. Quick regression script (run after any change, light + dark)

1. Home: swipe balance cards (scale/tilt/dim, no peek), eye toggle masks everything, Saved today moves after logging, Needs attention shows the due budget and opens the Budgets tab, Manage opens the Budgets tab, insights swipe feels identical to the cards.
2. Cents: center button → hub; Add Expense routed from GCash (Wallet balance drops); Add Income to Maya (balance rises); Scan opens the in-app camera (frame + sweeping line, Item/Receipt switch, torch, gallery); chat chevron-down dismisses back to the screen underneath (still visible through the glass); mic shows the voice overlay pulse.
2b. Chat keyboard: tap the composer → keyboard rises and the composer rides ON TOP of it (light + dark, hero and thread states); dismiss by dragging the list down.
2c. Camera scan: capture an item → shot freezes, line keeps sweeping, "Cents is analyzing" chip → glass panel slides up with the analysis + action card; type a follow-up in the panel ("saan mas mura?") → Cents answers over the image; mic → voice overlay on top; Confirm on the card → handled chip; Open chat → full chat shows the same thread; camera-reverse retakes. Receipt mode: taller frame → total + breakdown + log card. Item with NO price tag → estimate clearly marked as an estimate. Deny camera permission once → glass permission screen with Allow + import from Photos.
2d. Multi-step: after a receipt scan, decline the card, then type "add a Groceries budget 9000 and log that receipt there" -> TWO cards appear in order (Add budget, then Log under Groceries); confirm both -> budget exists AND expense logged; confirming the Log card FIRST still works (category auto-created).
2e. Chat scan sheet: header scan button shows ONLY Scan an item / Scan a receipt; each opens the camera above chat and closing it returns to chat.
3. Chat brain: "bumili ako ng 800 na dog food" (Taglish card), "kaya ko ba bumili ng jordans na 12k?" (overshoot + delay), confirm one → totals update everywhere.
4. Budgets: create "Electric Bill", category Bills, due in 3 days → chip on Home + Needs attention.
5. Profile: slides in from the right; pick the fox + nickname → Home header updates; Notifications + Face ID toggles persist after app kill; Password → Send code → dev dialog code → wrong code once (attempt counter) → correct → new password → re-login works; Manage plan shows Coming soon; log out/in.
6. Analytics: search "gas", filter Expenses, export CSV and PDF (share sheet opens, filters respected).
