# Phase 7 — Verification & Submission

**Goal:** ship to both stores. Survive review.

## 7.0 App Store Connect & Play Console form intake

Items from Phase 4 that are pure ASC / Play Console paperwork — none of these require code changes, they all get filled out at submission time. Bundled here so nothing gets dropped between Phase 4 and Phase 7.

### 7.0.1 App Tracking Transparency — opt out (from 4.2)

- [ ] Confirm AdSupport.framework is NOT linked in the iOS project (Build Phases → Link Binary With Libraries).
- [ ] Confirm `NSUserTrackingUsageDescription` is absent from `Info.plist`.
- [ ] In ASC privacy form, answer "No" to "Do you use third-party SDKs to track users?" and "No" to "Do you collect data used to track the user?"
- Reason: we only use first-party Sentry with `sendDefaultPii: false`. No IDFA, no cross-app/site tracking. Skipping the ATT prompt is correct.

### 7.0.2 Privacy nutrition labels — App Store (from 4.3)

Declare exactly this inventory in ASC → App Privacy → Data Types:

| Data type | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|
| Email address | Yes | No | App Functionality (account) |
| Name | Yes | No | App Functionality |
| User ID (internal captain id) | Yes | No | App Functionality |
| Phone number (web users) | Yes | No | App Functionality (SMS/trial gating) |
| Coarse location (boundary alerts only) | No | No | App Functionality — on-device only, never transmitted |
| Device ID (push token) | Yes | No | App Functionality (push delivery) |
| Purchase history (Stripe) | Yes | No | App Functionality (subscription state) |
| Crash data (Sentry, anonymized) | No | No | App Functionality (diagnostics) |

- Tracking: **None.** Do not check any box in the Tracking section.

### 7.0.3 Data Safety — Google Play (from 4.4)

Same inventory as 7.0.2 plus FCM-specific items. In Play Console → App content → Data safety:

- [ ] Mark "Yes" to "Does your app collect or share any of the required user data types?"
- [ ] For each data type above, set purpose = "App functionality" and select "Data is encrypted in transit" (HTTPS).
- [ ] Mark "Yes" to "Do you provide a way for users to request that their data be deleted?" — link to `https://akfishinfo.com/account` (the in-app delete flow shipped in PR #73).
- [ ] Confirm "Independent security review" answer matches reality (default: No, unless we've actually had one).

### 7.0.4 Age rating, export compliance, content rights (from 4.6)

ASC submission tab:

- [ ] **Age rating**: complete the questionnaire honestly → expect 4+ rating. No objectionable content, no UGC, no unrestricted web access.
- [ ] **Export compliance**: answer "Yes, uses encryption" → "Yes, qualifies for exemption" (HTTPS only, no proprietary crypto) → no ERN filing needed. Add `ITSAppUsesNonExemptEncryption = false` to `Info.plist` to suppress future prompts.
- [ ] **Content rights**: confirm that map tiles (CARTO / OSM) are appropriately licensed (attribution shown in-app) and that ADF&G announcement text is public data. Note these in the reviewer comments if asked.

### 7.0.5 EULA (from 4.8)

- [ ] In ASC → App Information → License Agreement, leave set to the default Apple Standard EULA. Our `terms.html` Section 3 already cross-references this.
- [ ] Do NOT upload a custom EULA unless legal counsel insists.

### 7.0.6 Store listing copy (from 4.9)

Draft, then paste into ASC / Play Console:

- **App name**: `akFISHinfo`
- **Subtitle** (30 char max): e.g., `Prince William Sound Openers`
- **Promotional text** (170 char, can change post-launch): e.g., `Real-time push the moment ADF&G opens a PWS commercial salmon period. Live map, district cards, tides + weather.`
- **Description** (4000 char): adapt from `public/about.html` lead + map/alert/sub-tier feature list. Lead with the value prop (alerts the moment an opener drops). Mention push, Sign in with Apple, and offline tile cache. Do NOT mention subscription pricing in the description (Apple rejects on-listing pricing).
- **Keywords** (100 char, iOS only): `fishing,salmon,alaska,prince william sound,opener,adfg,commercial fishing,cordova,valdez`
- **Support URL**: `https://akfishinfo.com/about` (or `/support` if/when created)
- **Marketing URL**: `https://akfishinfo.com`
- **Privacy Policy URL**: `https://akfishinfo.com/privacy`
- **Screenshots**: capture during Phase 7.2 test matrix runs. Sizes: 6.7" (iPhone 15 Pro Max), 6.5" (older iPhone), iPad 12.9". Five each, no marketing chrome — just the actual app.

### 7.0.7 Permission-string sanity check (already shipped, verify before submit, from 4.5)

- [ ] `Info.plist` has `NSLocationWhenInUseUsageDescription` with plain-language copy (currently: "akFISHinfo uses your location to center the map on your boat and highlight the nearest PWS district. Location is read on demand only — never tracked in the background.").
- [ ] No camera / photos / microphone / contacts / calendar / Bluetooth permission strings (we don't use any of these — their presence triggers reviewer questions).
- [ ] Push notification prompt copy: handled by Capacitor Push Notifications plugin at runtime; the system prompt explains the purpose adequately for a notification-driven app.

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
