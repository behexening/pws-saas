# Risk Register

Ranked by likelihood × impact.

## HIGH

### R1 — 4.2 "thin wrapper" rejection (iOS)
**Likelihood:** Medium. **Impact:** High (delays launch 1-3 weeks per cycle).

**Mitigations (all in plan):**
- Native push (Phase 2.4)
- Sign in with Apple (Phase 2.3)
- IAP via RevenueCat (Phase 2.5)
- Offline cache (Phase 5.1)
- Native UI patterns (Phase 3)
- Deep links + share sheet (Phase 5.3, 5.5)
- Bundled assets — NOT loading remote URL via `server.url`

**Pre-prepared reviewer-note answer:** see Phase 7.6.

### R2 — Pricing/IAP misconfiguration causes silent revenue loss
**Likelihood:** Medium. **Impact:** High (users charged but not entitled).

**Mitigations:**
- RevenueCat handles receipt validation (don't roll our own)
- Test sandbox purchases for all SKUs before submission
- Test "expired subscription" event in dev
- Webhook idempotency: handle duplicate events safely
- Add a server-side reconciliation cron that audits RevenueCat entitlements vs DB state daily

### R3 — Account deletion missing or broken
**Likelihood:** Low. **Impact:** High (instant rejection per 5.1.1(v)).

**Mitigations:**
- Build it early (Phase 4.1)
- Test the full chain: cancel Stripe, revoke Apple, delete data
- Make it accessible in ≤2 taps from main nav

## MEDIUM

### R4 — Push notification reliability
**Likelihood:** Medium. **Impact:** Medium (users miss openers, churn).

**Mitigations:**
- Telegram alternative remains on web for risk-averse users
- Server-side delivery logs + retry queue
- Monitor APNs/FCM error responses, prune invalid tokens
- "Test alert" button in app so users can verify their setup

### R5 — Sign in with Apple email relay confusion
**Likelihood:** High. **Impact:** Low (annoying UX, not blocking).

**Mitigations:**
- On first SIWA, persist the relay email immediately
- Account screen shows real email + relay email distinction
- Document in FAQ

### R6 — External-link entitlement application denied or revoked
**Likelihood:** Low (but Apple has been inconsistent here). **Impact:** Medium (lose web-discount conversion path on iOS).

**Mitigations:**
- Geo-gate carefully — only show in regions explicitly approved
- If denied, fall back to IAP-only pricing on iOS, no link out
- Don't make the entire business model dependent on the entitlement

### R7 — Solo-maintenance load (3 release pipelines)
**Likelihood:** High. **Impact:** Medium (burnout, slow iteration).

**Mitigations:**
- Fastlane / Xcode Cloud / EAS to automate builds
- Single codebase via Capacitor — fixes propagate everywhere
- Single backend — no mobile-only API surface
- Set realistic update cadence (monthly, not weekly)

## LOW

### R8 — App icon or screenshot rejected for quality
**Likelihood:** Low. **Impact:** Low (1 day to fix).

**Mitigation:** professional design pass, follow HIG icon specs literally.

### R9 — Telegram users feel abandoned by mobile decision
**Likelihood:** Medium. **Impact:** Low (they keep web — no functional regression).

**Mitigation:** clear messaging that web Telegram stays alive; native push is an additional option, not a removal.

### R10 — Google Play target API requirement bumps mid-development
**Likelihood:** Low. **Impact:** Low (Capacitor updates handle most of this).

**Mitigation:** stay on a current Capacitor major version.

### R11 — Sentry quota exceeded on launch day
**Likelihood:** Low. **Impact:** Low (lose visibility briefly).

**Mitigation:** start on a paid tier before launch; configure sample rate < 100% for high-volume events.

## EXISTENTIAL (low likelihood but plan B exists)

### R12 — Apple changes external-link policy mid-development
The Epic ruling is binding but Apple has appealed pieces of it. If the entitlement window narrows:
- Fall back to IAP-only on iOS
- Web continues unchanged
- Bigger discount on web (25-30%) to compensate via marketing, not in-app

### R13 — RevenueCat goes down or pricing changes
**Mitigation:** RevenueCat is acquihire-resilient and well-funded; risk is low. If it does happen, raw StoreKit 2 + Play Billing is the migration path, ~2 weeks of work.
