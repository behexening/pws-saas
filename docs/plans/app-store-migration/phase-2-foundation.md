# Phase 2 — Foundation: Wrapper, Auth, Push, IAP

**Goal:** end of this phase, a TestFlight build exists where a real user can:
1. Open the app, see a native-feeling shell loading the akFISHinfo UI
2. Sign in with Apple (and Google still works on Android)
3. Receive a real push notification triggered from the backend
4. Subscribe via IAP through RevenueCat and get entitlement reflected in their akFISHinfo account
5. NOT see any Telegram references on iOS

**Prerequisite:** Phase 1's `allowed-apis.md` exists and is reviewed.

**Anti-patterns to avoid:**
- Calling Capacitor / RevenueCat / Sentry APIs from memory without citing Phase 1 doc references
- Pointing `server.url` at production URL for the final submission build (4.2 thin-wrapper risk)
- Inventing Apple sign-in token validation logic — use `passport-apple` or the documented JWKS flow

## 2.1 Capacitor project init

Copy patterns from Phase 1 Subagent 1 findings.

**Tasks:**
1. `npx @capacitor/cli init "akFISHinfo" "com.akfishinfo.app" --web-dir=public` (bundle ID to be confirmed with user before running)
2. Add iOS + Android: `npx cap add ios && npx cap add android`
3. Configure `capacitor.config.ts`:
   - `webDir: 'public'`
   - For dev only: `server.url` pointing to local backend
   - For production build: bundled assets, NO `server.url`
4. Add `.gitignore` rules for `ios/App/Pods/`, `ios/DerivedData/`, `android/.gradle/`, `android/app/build/`
5. Establish build script in `package.json`: `cap:sync`, `cap:open:ios`, `cap:open:android`

**Verification:** `npx cap run ios` opens an iOS simulator showing `public/index.html`.

## 2.2 Platform-aware UI gating (kill Telegram on mobile)

**The rule:** anywhere `public/*.html` references Telegram (setup flow, account page, marketing copy), wrap in a runtime check.

**Tasks:**
1. Create `public/js/platform.js` that exports a `IS_NATIVE` constant derived from `window.Capacitor?.isNativePlatform?.() === true`.
2. Audit every Telegram reference in `public/setup.html`, `public/account.html`, `public/app.html`, `public/index.html`, `public/about.html`, `public/pricing.html`. Wrap with `if (!IS_NATIVE)` or a CSS class `.web-only` that's hidden via a body-level class set early.
3. The mobile setup flow becomes: Sign in → Enable Push → Start Trial / Subscribe. No Telegram step.
4. Update the trial-grant logic in `backend_v2.js` (`/api/setup`) to NOT require Telegram link when the request comes from a native client. Detect via a header set by the Capacitor build (e.g., `X-Client: native-ios` / `native-android`).

**Verification:** open the iOS simulator build, walk the whole UI surface, confirm zero Telegram mentions. Run web in browser, confirm Telegram still present and functional.

## 2.3 Sign in with Apple

Copy patterns from Phase 1 Subagent 4 findings.

**Tasks:**
1. Install `@capacitor-community/apple-sign-in` (confirm exact package name from Phase 1 docs).
2. Client: add SIWA button to `public/login.html` shown only when `IS_NATIVE && platform === 'ios'`.
3. Server: add `/auth/apple/callback` route in `backend_v2.js`:
   - Validate the identity token JWT against Apple's JWKS (`https://appleid.apple.com/auth/keys`)
   - Extract `sub` (stable Apple user ID), `email` (only present on first sign-in)
   - Upsert user by `apple_sub`, fall back to email match for users who previously signed up with Google using the same Apple email
4. DB migration: add `apple_sub TEXT UNIQUE` to users table. Add `apple_refresh_token TEXT` (encrypted) for revocation on account deletion.
5. Add Apple capability in Xcode (Signing & Capabilities → Sign In with Apple).

**Verification:** sign in with Apple on a real device (simulator can be flaky), confirm a user row is created/linked, hit the existing session-protected endpoints successfully.

## 2.4 Push notifications

Copy patterns from Phase 1 Subagents 2 and 8.

**Tasks:**
1. Install `@capacitor/push-notifications`.
2. Client (`public/js/push.js`):
   - On login success, call `PushNotifications.requestPermissions()` then `register()`
   - Listen for `registration` event, POST the token to `/api/devices/register`
   - Listen for `pushNotificationReceived` and `pushNotificationActionPerformed` for in-app handling + deep link routing
3. Server:
   - New `device_tokens` table: `id, user_id, platform (ios|android), token, created_at, last_seen_at`
   - `POST /api/devices/register` (auth required) upserts the token
   - Update the alert-dispatch path (wherever Telegram messages are currently sent) to also fan out to `device_tokens` rows for the same user
   - APNs sender via `node-apn` using p8 key (store key, key_id, team_id in env)
   - FCM sender via Firebase Admin SDK (store service-account JSON in env, base64'd)
4. iOS: enable Push Notifications + Background Modes (Remote notifications) in Xcode capabilities.
5. Android: register FCM, drop `google-services.json` in `android/app/`.

**Verification:** trigger an alert from the backend (existing test path), confirm push arrives on both iOS and Android test devices within 5 seconds. Confirm tapping the push opens the right opener via deep link.

## 2.5 RevenueCat IAP

Copy patterns from Phase 1 Subagent 3.

**Tasks:**
1. Create RevenueCat project; create one entitlement: `pro_access`.
2. Create products in App Store Connect (iOS) and Google Play Console (Android). Same price tier on both, ~1.18× the web Stripe price.
3. Link products in RevenueCat dashboard, attach to the `pro_access` entitlement.
4. Install `@revenuecat/purchases-capacitor`.
5. Client:
   - Init SDK with API keys (separate for iOS/Android) on app boot
   - Call `Purchases.logIn(akFishinfoUserId)` after auth so receipts attribute to the right user
   - On the in-app upgrade screen, fetch offerings and render the price from RevenueCat (don't hardcode)
   - Purchase button calls `Purchases.purchasePackage(...)`; on success, check `customerInfo.entitlements.active.pro_access`
   - Restore Purchases button (REQUIRED by Apple) calls `Purchases.restorePurchases()`
6. Server:
   - RevenueCat webhook endpoint: `/webhooks/revenuecat`. Validate the `Authorization` header against a shared secret stored in env.
   - Handle events: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`. Map to user subscription state.
   - Add `subscription_source` column to users: `stripe_web | apple_iap | google_iap`.
   - Stripe webhook continues to work for web subscribers; the two paths converge on the `users.has_access` boolean (or whatever the existing flag is).

**Verification:** sandbox IAP purchase on a test device → webhook hits backend → user's `has_access` flips to true within 30s → app reflects new entitlement on next foreground.

## 2.6 "Save on web" external-link CTA

**Tasks:**
1. Apply for StoreKit External Link Account Entitlement (separate dev portal request, not automatic).
2. On the in-app upgrade screen, show a secondary CTA: "Save ~15% by subscribing on akfishinfo.com" — only when:
   - User region is US or EU (detect via `Intl.DateTimeFormat().resolvedOptions().timeZone` heuristic OR App Store storefront country)
   - Entitlement is granted to this app
3. Tapping the CTA opens an external Safari (`@capacitor/browser` with `Browser.open`, NOT in-app webview) to a special URL like `akfishinfo.com/subscribe?from=ios-app` that pre-fills a 15% discount.
4. The web Stripe flow already exists; just add the discount-code support if not already there.

**Verification:** tapping the CTA exits the app, Safari opens, web checkout shows discounted price. Apple review will test this — make sure the language is neutral, no scare-language about Apple fees.

## 2.7 Sentry

Copy patterns from Phase 1 Subagent 9.

**Tasks:**
1. Install `@sentry/capacitor` and `@sentry/node` (backend).
2. Init on client boot with DSN, set `release` from package.json version.
3. Init on backend with the same project.
4. Add a manual test crash button in dev builds only to verify reports flow.

## 2.8 Deliverable

A TestFlight build (and an Android internal-test build) that passes all five Phase 2 goals at the top of this doc. Tagged in git as `v1.0.0-beta1`.

Do not move to Phase 3 until Phase 2 is on TestFlight and at least one real-device end-to-end test (auth → push → IAP) has succeeded.
