# Phase 6 — Things Easy to Forget

The stuff that's not glamorous but will block submission or burn time mid-flight.

## Status as of v1 submission

| # | Item | Status |
|---|---|---|
| 6.1 | Developer accounts | ✅ Apple Dev (Team ID 4YAFWMK9MZ) purchased + approved. Google Play Console — confirm before submit. |
| 6.2 | TestFlight beta program | ⏳ ASC config — no code; do during Phase 7. |
| 6.3 | Build automation (Fastlane) | ⏭ Defer — manual Xcode archive is fine for first ship. Add Fastlane only if iteration speed becomes a blocker. |
| 6.4 | App Store assets | ⏳ Graphic designer producing real icon; screenshots captured during Phase 7.2 test matrix. |
| 6.5 | Force-update mechanism | ✅ Shipped — PR #77. `/api/version/min-supported` + client check. |
| 6.6 | RevenueCat webhooks | ⏭ **N/A** — Path B, no IAP. |
| 6.7 | Region considerations | ✅ Already shipped (AKDT pinning, offline tiles, push-first). |
| 6.8 | Review timeline buffer | ⏳ Planning — budget 3-4 weeks from first submission to live. |
| 6.9 | Marketing site updates | ⏳ Blocked on actual store URLs — fill in after first ASC approval. |
| 6.10 | Customer support readiness | ⏳ Process / docs work — punch list before launch week. |
| 6.11 | IAP auto-renewal disclosure | ⏭ **N/A** — Path B, no IAP. |

## 6.1 Developer accounts (do this FIRST)

- **Apple Developer Program** — $99/yr. Enrollment can take days for individual approval, longer for an LLC. Start before Phase 2.
- **Google Play Console** — $25 one-time. Faster but still requires identity verification.
- **Apple D-U-N-S number** — if enrolling as a company. Get this in parallel.

## 6.2 TestFlight beta program structure

The existing beta-tester table maps cleanly to TestFlight invites.

**Tasks:**
1. Internal Testing group (up to 100 testers, no review required) — for dev iterations.
2. External Testing group (up to 10,000, requires a quick Apple "beta review" — usually 1 day) — for real users.
3. Map existing beta_testers in DB to TestFlight invites: write a small script that exports emails into Apple's CSV format.

## 6.3 Build automation

Manual Xcode archive uploads will eat hours.

**Options:**
- **Xcode Cloud** — Apple-native, $14/mo, integrates with App Store Connect cleanly
- **Fastlane** — free, self-hosted, more setup
- **EAS Build (Expo)** — supports Capacitor, $0–$99/mo, very fast

**Recommendation:** Fastlane locally for now (free, no lock-in). Move to Xcode Cloud if iteration speed becomes a blocker.

**Tasks:**
1. `fastlane init` in `ios/` and `android/`
2. Lanes: `beta` (build + upload to TestFlight / Play Internal), `release` (build + upload to App Store / Play Production)
3. Match certificates via `fastlane match` stored in a private git repo

## 6.4 App Store assets

Budget a full day per platform.

**iOS required:**
- 1024×1024 app icon (no transparency)
- Screenshots: 6.5" (1290×2796) — REQUIRED, all others optional
- Optional but recommended: 6.7" (iPhone 15 Pro Max), 5.5" (older iPhone), iPad 12.9"
- App preview video (15–30s, optional but boosts conversion)

**Android required:**
- 512×512 icon
- Feature graphic 1024×500
- Phone screenshots (min 2, max 8)

**Copy:** see Phase 4.9.

## 6.5 Versioning strategy

Keep web + iOS + Android aligned.

**Pattern:**
- Web: semver `1.x.y` from `package.json`
- iOS: `CFBundleShortVersionString` mirrors `1.x.y`, `CFBundleVersion` is monotonic build number
- Android: `versionName` mirrors, `versionCode` is monotonic
- Add a Fastlane lane to bump all three from a single command

**Force-update mechanism:** the backend exposes `GET /api/version/min-supported`. The app checks on launch; if `currentVersion < min`, show a blocking "Please update" screen with a deep link to the store.

## 6.6 Server-Side Apple/Google subscription notifications

Already covered in Phase 2.5 RevenueCat webhooks. Listed here as a reminder that this is a separate webhook from Stripe's, with its own auth scheme and payload format. Test both paths in sandbox before launch.

## 6.7 Region considerations

PWS = Alaska. Specifics:

- **Time zones:** display all times in Alaska Time. The app should NOT auto-detect device time zone for opener times — they're fixed to AKDT/AKST regardless of where the user is.
- **Connectivity:** LTE-spotty. Offline mode (Phase 5.1) is critical.
- **Battery:** boats run from limited power. Don't poll the server every 30s. Push-first.

## 6.8 Review timeline buffer

First iOS submission typically: 1-3 rejections before acceptance. Each rejection = 1-3 day re-review cycle.

**Plan:** 3-4 weeks from first submission to live. Build the timeline backwards from the desired launch date (target a slack fishing season opener? probably not — submit OFF-season so beta covers a real season).

## 6.9 Marketing site updates

The web app should mention the mobile apps once they're live.

**Tasks:**
1. Add App Store + Google Play badges to `index.html` and `about.html`.
2. Consider a `/download` page with mobile-specific marketing.
3. If keeping the web-discount strategy, the pricing page should clearly state "Web: $X / IAP: $X+20%" — transparency strengthens the trust signal.

## 6.10 Customer support readiness

App Store users have higher support expectations than web SaaS.

**Tasks:**
1. Support email monitored daily during launch week.
2. FAQ updated to address mobile-specific issues (push not arriving, IAP restore not working, sign-in with Apple email-relay confusion).
3. App Store Connect → Ratings & Reviews — reply to every 1-3 star review in the first month.

## 6.11 Legal: subscription auto-renewal disclosure

Apple and Google both require specific disclosure language at the IAP point-of-purchase.

**Tasks:**
1. Show the subscription terms in the purchase modal:
   - Title and length of subscription
   - Price
   - Auto-renewal language: "Subscription automatically renews unless cancelled at least 24h before the end of the current period."
   - Link to Terms and Privacy
2. RevenueCat's pre-built paywalls handle this, but if rolling custom, get the exact required language from Apple's Auto-Renewable Subscription docs.
