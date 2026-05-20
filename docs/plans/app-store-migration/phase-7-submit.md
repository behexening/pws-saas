# Phase 7 — Verification & Submission

**Goal:** ship to both stores. Survive review.

## 7.1 Pre-submission self-review

Walk through every Apple guideline at https://developer.apple.com/app-store/review/guidelines. For each, mark Compliant / N/A / Risk. Resolve every Risk.

**Highest-risk guidelines for this app:**
- **2.1** — App Completeness: no placeholder text, no broken features, no "coming soon" screens.
- **2.3.10** — Accurate Metadata: screenshots reflect actual app, description doesn't oversell.
- **3.1.1** — IAP: subscription terms clearly disclosed (Phase 6.11). Restore Purchases button works.
- **3.1.3(b)** — External links: only if entitlement granted, only in approved regions, neutral language.
- **4.2** — Minimum Functionality: this is the one to worry about. Mitigated by native push + Sign in with Apple + IAP + offline mode + native UI.
- **4.8** — Sign in with Apple: present, working, revokes properly on account deletion.
- **5.1.1(v)** — Account deletion in-app, two-tap accessible.

## 7.2 Test matrix

Run these test flows on real devices before submitting:

| Flow | iOS | Android | Web |
|---|---|---|---|
| Sign up + verify email | ✓ | ✓ | ✓ |
| Sign in with Google | – (Apple only) | ✓ | ✓ |
| Sign in with Apple | ✓ | – | – |
| Push notification arrival + tap → deep link | ✓ | ✓ | – |
| IAP purchase (sandbox) | ✓ | ✓ | – |
| Restore Purchases | ✓ | ✓ | – |
| Stripe web purchase | – | – | ✓ |
| Web discount CTA from app (geo: US) | ✓ | ✓ | – |
| Account deletion + Apple token revocation | ✓ | ✓ | ✓ |
| Offline mode (airplane on) | ✓ | ✓ | n/a |
| Dark Mode | ✓ | ✓ | ✓ |
| Dynamic Type (largest) | ✓ | n/a | n/a |
| VoiceOver navigation | ✓ | n/a | n/a |
| Pull-to-refresh | ✓ | ✓ | n/a |
| Force-update screen | ✓ | ✓ | – |

## 7.3 TestFlight external testing

Minimum 1 week with at least 10 real fishermen testers.

**Tasks:**
1. Invite via TestFlight links sent from the backend (map beta_testers → TestFlight emails).
2. Provide a simple feedback channel (email, in-app form, or TestFlight's built-in).
3. Triage daily.
4. Fix P0/P1 bugs, ship new TestFlight builds.

## 7.4 Production build hygiene

Before submitting:
- [ ] Remove all `console.log` of sensitive data
- [ ] Confirm `server.url` is NOT set in `capacitor.config.ts` for production
- [ ] Confirm all secrets are server-side, not bundled
- [ ] Sentry DSN is production, not dev
- [ ] RevenueCat keys are production, not sandbox
- [ ] Sign with distribution certificate, not dev
- [ ] Bump version number

## 7.5 App Store Connect submission

1. Create app record (bundle ID matches Capacitor config)
2. Fill all metadata (Phase 4.9)
3. Upload build via Fastlane / Xcode
4. Privacy nutrition labels (Phase 4.3)
5. Reviewer test account (Phase 4.10)
6. Reviewer notes — explain anything non-obvious (e.g., "PWS = Prince William Sound, Alaska. The app is region-specific to commercial salmon fishing.")
7. Submit for review

**Expected response:** approval in 24-48h OR rejection notice. Average for first submission is rejection 1-2 times.

## 7.6 Common rejection patterns and pre-emptive answers

Have these ready as reviewer-note templates:

**"Your app appears to be a website wrapped in a webview" (4.2):**
> "akFISHinfo is a native iOS app providing real-time push notifications for Alaska commercial fishing openers (replacing reliance on third-party messaging), in-app subscription purchase via StoreKit, Sign in with Apple, offline caching of openers, native iOS share sheet, native deep linking, and Face ID authentication. Webview is one of several native components."

**"Need clarification on IAP / external link":**
> "External link CTA appears only to users in regions where Apple permits this per StoreKit External Link Account Entitlement granted to our app on [date]. Default purchase flow is in-app IAP. Web subscription is a parallel offering, not a replacement."

**"Account deletion not found":**
> "Account → Settings → Delete Account. Two-tap confirmation flow. Reviewer demo account is pre-set to allow deletion testing."

## 7.7 Google Play submission

Parallel process. Generally smoother than Apple.

1. Internal Testing track → Closed Testing → Production
2. Data Safety form filled (Phase 4.4)
3. Content rating questionnaire
4. Target API level matches current Play requirements
5. App Bundle signed with Play App Signing

## 7.8 Launch day

Once approved:
- Coordinate with marketing site update (Phase 6.9)
- Send announcement to existing web users via email + in-app banner
- Monitor Sentry like a hawk for the first 72h
- Reply to every App Store review in first 2 weeks

## 7.9 Post-launch

- Schedule weekly review of crash rate, store ratings, IAP conversion vs web conversion
- Plan first content update within 30 days (Apple notices apps that stay static)
- File first earnings report through App Store Connect
