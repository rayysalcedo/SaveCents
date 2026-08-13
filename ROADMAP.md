# SaveCents — Global Launch Roadmap
**From build v74 (M5.47, Minted Gold) · August 2026 · Living document — commit as ROADMAP.md in the repo root**

---

## Where we are

The product core is built and battle-tested through 40+ field-report cycles: the full finance engine (accounts, budgets with the Bills/Spending split, goals, splits, lends, automated credit statement cycles), Cents AI with voice/chat/scan and batch execution, the redesigned Transactions tab, cloud sync, exports, notifications, and the Minted Gold identity. The app is local-first: the entire money engine works offline; Gemini, sync, and split emails are the online layer. What stands between here and a global launch is not features — it's monetization plumbing, legal groundwork, store infrastructure, and distribution.

**The strategic frame (from the Tarsi analysis):** the PH market's #1 paid finance app proves Filipinos pay for finance tools, that solo-built RN apps top charts at ~80–90 downloads/day, that a public Facebook group is a free growth engine, and that the market's loudest complaint about the leader is *no free trial* — which is exactly our model.

---

## The locked product model

| Tier | Gets | Costs us |
|---|---|---|
| **Free** | Full offline finance core: logging, budgets, bills, goals, local splits/lends, charts, exports, notifications. **Unlimited Quick Scan** (on-device OCR + deterministic parser — offline, private, ₱0 marginal cost). **7-day Smart trial** of everything below, stamped on the Firebase account. | ~nothing |
| **SaveCents Plus — ₱129/mo PH · $3.99/mo non-PH · ₱999 / $29.99 annual** | **Cents AI** full brain (chat + voice, EN/Taglish, batch plans), **Smart Scan** (Gemini vision: itemized, budget-aware), **remote split links + emails**. Cloud sync is free-tier (see below). | Gemini + Brevo (covered: ₱129 nets ~₱110 after Apple Small Business 15%) |

Principles: everything that costs us per-use money sits behind the sub (the Tarsi rule); the free tier is a complete, honest product, not a cripple-ware demo; the trial *is* the paid product so the downgrade is felt, not read about; trial ties to the **account**, never the device.

**Resolved:** cloud sync is **free-tier** (cost is fractions of a peso per user per month; the account it requires anchors the trial stamp; multi-phone works via sign-in — snapshot last-write-wins, so simultaneous two-device edits can clobber, documented limitation). Plus differentiates on AI + Smart Scan + remote splits.

**Resolved (owner):** (1) Quick Scan is truly **unlimited** on free; (2) non-PH monthly is **$3.99** (regional PPP pricing, set per-storefront); (3) annual at launch: **₱999/yr PH / $29.99/yr non-PH** (~35% off both — one story: "3+ months free").

**Trial AI cap (owner requirement):** DAILY limits during the 7-day trial — **30 Cents messages/day (chat+voice) + 5 Smart Scans/day**. Daily (not a total pool) so the trial builds a return habit; bounds worst-case trial cost at ~₱6/day (~₱42/trial max). Counters live on the Firebase account beside the trial stamp, reset server-side daily, surface in UI only near the limit; at the cap Cents says so in character and offers Plus. Quick Scan stays uncapped (₱0 marginal). Plus has no visible caps — only the quiet ToS fair-use ceiling.

**Pricing (owner decision):** public ₱129/mo (below the Spotify/Netflix ₱149 anchors; price DROPS are clean on the stores, raises are painful — launch high with room to move). **Founding-member play:** soft-launch cohort (first FB group members / TestFlight) locks ₱99/mo forever; public launch lists ₱129 — rewards early adopters, creates urgency, and live-tests both price points. **Plus unit economics (estimates at current Gemini Flash pricing; MEASURE real token usage in beta):** chat intent ≈ ₱0.10–0.15/call, Smart Scan ≈ ₱0.15–0.30. Typical daily user ≈ ₱15–25/mo (margin ~₱85–95), heavy ≈ ₱50–70/mo (margin ~₱40–60) vs ~₱110 net. Guards: fair-use ceiling in ToS from day one, per-user cost monitoring from soft launch, offline-AI phase structurally reduces spend. Trials cost ₱5–15 each with zero revenue — that's acquisition cost.

---

## Phase 0 — Verify what's built *(owner, this week, no code)*

- [ ] Device pass on v74: Minted Gold light + dark (the two taste dials — coin gold temperature `#F5C64A`, espresso depth — are one-line tunes), spend-card colors, tap-to-filter, header export, scaling pager, wheel hold-feel.
- [ ] `wrangler deploy` in `worker/` (gold emails + custom-split manage pages go live).
- [ ] Asset check: splash-icon / splash-logo / logo-wordmark PNGs — re-export any containing green (cents-mark is already gold).
- [ ] Watch the first live credit statement cut on the real billing day.
- [ ] Commit v74 + this ROADMAP.md to the repo.

## Phase 1 — Legal & trust groundwork *(mixed, ~1 session block + owner tasks)*

*I am not a lawyer; a real one should bless the final artifacts for your launch markets.*

- [x] **Domain: `savecents.app` acquired** (Cloudflare Registrar, auto-renew on). Next unlocks below. ~~acquire `savecents.app`~~ (+ `savecents.ph` if available) — required for the App Store privacy-policy URL, branded split links (workers.dev URLs read as phishing to non-user recipients), Brevo SPF/DKIM, and support contact. Put it on Cloudflare (worker custom domain = a checkbox; Pages hosts the site free).
- [ ] **Static site (build, small):** landing page + privacy + terms + support on Cloudflare Pages; worker moves to `savecents.app` routes.
- [ ] **Trademark clearance (owner, this week — before more brand equity accrues):** search "SaveCents" and "Cents" at USPTO, EUIPO, WIPO Global Brand DB, IPOPHL. Neighborhood is crowded ("Make Cents", "SaveMyCent"). If clear → file at least PH + US.
- [ ] **Account deletion flow (build):** in-app delete — wipes Firebase auth user, cloud snapshot, and local state. Apple mandates it.
- [ ] **Guest / local-only mode (build):** start without an account (kills the first-launch-needs-internet gap, strengthens the privacy story against Tarsi); offer sign-in later when the user wants sync/Plus. Trial stamping then occurs at account creation.
- [ ] **Privacy policy + Terms (draft: me; review: lawyer):** disclose Firebase (sync), Gemini (AI processing), Brevo (split emails **to non-users** — the GDPR-notable one), local-first architecture, deletion rights. ToS includes "not financial advice."
- [ ] **Store privacy labels** mapped honestly from the above.
- [ ] Verify Gemini / Firebase / Brevo terms cover commercial use at expected scale.

## Phase 1.5 — The Expo Go window *(NOW, before developer accounts exist — owner constraint: accounts next month)*

Everything below runs in the current Expo Go workflow. The goal: when the accounts arrive, only native bolt-ons remain.

- [ ] **Entitlement system, complete:** `plan: 'free' | 'plus'` + account-stamped `trialStartedAt` (server timestamp), derived gating for Cents chat/voice/Smart-Scan, **trial daily-cap counters (30 msgs / 5 Smart Scans, server-side daily reset, in-character limit message)**, trial-expiry paywall screen, and a **dev toggle simulating Plus** so every state is testable without IAP. Cents' APP MAP learns the tiers (Rule 0) so it answers "why can't I chat?" honestly.
- [ ] **Quick Scan parser core:** the deterministic PH-receipt parser (pure JS) built + tested against sample OCR text now; ML Kit becomes its input later without redesign.
- [ ] **Security package (Expo Go-compatible):** biometric app lock (expo-local-authentication, both tiers), local encryption at rest (SecureStore-held key over the persist blob), **Firestore security rules audit** (owner-scoped snapshot access — the catastrophic-failure check), split manage-link expiry (worker), Brevo SPF/DKIM domain auth.
- [x] **Move Funds (shipped v75):** account-to-account transfers, never income/expense - wallet Move sheet + Cents MoveFunds intent; transfer into a credit card pays it down + advances its bill budget.
- [x] **Accuracy audit (shipped v75):** every aggregation transfer-aware (dashboard strip, savings series, trends, chips, exports, day nets, month dividers, rollover); balances via the reversible two-leg effect.
- [x] **Needs-attention fix (shipped v75):** unclamped text + deep-link that opens Budgets on the right segment and pulses the exact item.
- [ ] Phase 1's deletion flow + guest mode land here too (both JS-only).

## Phase 2 — EAS migration *(AFTER developer accounts arrive, ~1 session block)*

One door, three pillars behind it: IAP, on-device ML Kit (Quick Scan), and later offline AI all require native modules Expo Go can't load. Also required for store builds regardless.

- [ ] Owner: Apple Developer ($99/yr) + Google Play ($25) accounts (planned: next month).
- [ ] EAS project config, dev-client builds for the owner's device, internal distribution loop (replaces the Expo Go workflow; the zip/folder-swap dance dies with it).
- [ ] Set real `app.json` versioning, bundle IDs, icons/splash from Phase 0 assets.
- [ ] Regression pass on a dev build — everything that worked in Expo Go works in the dev client.

## Phase 3 — Native bolt-ons *(post-EAS; the system already exists from Phase 1.5)*

- [ ] **IAP:** RevenueCat (recommended) or expo-iap flips the real entitlement into the already-built gating; products: ₱129/mo PH + $3.99/mo non-PH + ₱999 / $29.99 annual + ₱99 founding-member offer for the beta cohort; restore purchases; Apple Small Business Program enrollment.
- [ ] **Quick Scan goes live:** ML Kit on-device OCR wired into the finished parser; Smart Scan (Gemini) stays Plus/trial.
- [ ] **Firebase App Check** (Play Integrity / App Attest): attests requests come from the real app — protects the Gemini bill and Firestore. Cost-security.
- [ ] Edge cases on real IAP: trial → subscribe → lapse → resubscribe; offline entitlement cache; sandbox test accounts.

## Phase 4 — Store readiness & growth setup *(~1 session block + owner)*

- [ ] Store listings (PH-first copy, EN + Taglish flavor): screenshots per tab in Minted Gold, preview video of a Cents voice log + scan.
- [ ] Per-territory pricing applied: PH manual ₱129/₱999, base tier $3.99/$29.99 elsewhere.
- [ ] **The Facebook group (owner creates, we link):** public group, linked from Profile settings exactly per the playbook — feedback steered to App Store reviews, feature talk in the group, member activity = free feed distribution.
- [ ] Android waitlist Google Form (the 900-signup trick) if launching iOS-first.
- [ ] TestFlight beta with the group's first members.
- [ ] App Review compliance sweep: deletion flow present, privacy labels, IAP rules (no external payment mentions), permission strings (mic/camera/notifications).

## Phase 5 — Launch sequence

1. **Soft launch PH** (iOS first): ship, seed the FB group, watch review velocity + Gemini cost per user + trial→paid conversion.
2. First two weeks = the Tarsi loop at our cadence: group requests → build → ship. Review-response discipline (their dev replies to everything; it shows).
3. **Android** when the waitlist justifies it (Google's 12-testers/14-days rule needs lead time — start closed testing during Phase 4).
4. **Global rollout** territory-by-territory after PH stabilizes: pricing tiers, then localized store copy for the next markets.

## Phase 6 — Post-launch product ladder (priority order)

1. **Cents parity phase 2:** goal edit/delete, account remove/rename, proper credit-card creation by chat (limit/billing/due).
2. **Offline AI tier:** three-tier brain (Gemini → Apple Foundation Models / Gemini Nano → heuristic), on-device receipt OCR feeding it. Neutralizes Tarsi's headline; reduces Gemini spend per user.
3. **Cents parity phase 3:** create splits, create lends / mark repaid, "pay my card" loose phrasing.
4. **Web companion (post-launch):** Expo web export of the read-and-log core — same account, dashboard/transactions/planner views, text-only Cents chat; voice/scan/gesture surfaces stay mobile. Full web parity only if demand shows. (Payments stay on mobile IAP initially; web billing is its own project.)
5. Backlog: TxEditor polish leftovers, gamification experiments (their streaks work), PH-stocks-style asks *only if the group demands them* — we don't chase their feature list.

---

## Risk register (short and honest)

- **Name clearance fails** → Phase 1 first for a reason; renaming pre-launch is cheap, post-launch is not.
- **Gemini costs from heavy Plus users** → fair-use ceiling in ToS from day one; monitor per-user cost from soft launch; offline-AI phase structurally reduces it.
- **Trial gaming** → account-stamped trial + sign-in required for Cents (free core needs no account in guest mode — clean separation).
- **App Review rejection** → the compliance sweep in Phase 4 exists because deletion, privacy labels, and IAP wording are the three usual rejections.
- **The gold theme on real screens** → Phase 0 device pass before anything else; two one-line dials if it needs tuning.

**The order in one line:** verify v74 → legal + trust → EAS → monetization → store + group → PH soft launch → iterate loudly → global.
