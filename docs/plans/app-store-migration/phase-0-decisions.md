# Phase 0 — Strategic Decisions

Status: **DONE**. This doc records the choices and the reasoning so future sessions don't relitigate them.

## 0.1 Wrapper: Capacitor

**Why:** React Native rewrite is prohibitively expensive for a solo/small-team SaaS. Native rewrite (Swift + Kotlin) is worse. Capacitor wraps the existing `public/*.html` and gives access to native plugins (push, biometrics, IAP, deep links) — enough native surface area to clear Apple's 4.2 "minimum functionality" bar when combined with the other decisions below.

**Risk:** App Store rejection under 4.2 if the build is a thin WebView with no native value. Mitigation is built into Phase 2 (native push, Sign in with Apple, IAP, offline cache, native UI patterns in Phase 3).

## 0.2 Telegram removed from mobile

**Why:** Native push notifications fully replace Telegram for alert delivery. Apple historically scrutinizes apps that require a third-party messaging account to function. Removing it eliminates that rejection vector and simplifies the mobile UX.

**Implementation rule:** in any mobile build, hide Telegram setup, linking, and references entirely. Use `Capacitor.isNativePlatform()` as the gate. Web app is untouched — existing Telegram users keep their channel.

## 0.3 Payments: RevenueCat IAP + Stripe web with discount

**Why RevenueCat:** receipt validation, renewal tracking, refund handling, and cross-platform entitlements are painful to do correctly in-house and bugs are silent ("user paid but didn't get access"). RevenueCat is free until meaningful revenue.

**Why dual-path:** IAP gives the frictionless in-app subscribe Apple expects. Web discount (~15%) recovers margin Apple takes and gives users a reason to convert on the higher-margin channel.

**External-link entitlement:** Apple permits external pricing comparison and links in the US (post-Epic injunction, 2024) and a handful of other regions. We will apply for the StoreKit External Link Account Entitlement and show the "Save on web" CTA in permitted regions only. **Geo-gate at launch:** US + EU only. Hide elsewhere.

**Pricing math to finalize before Phase 2:**
- Web price: $X (existing Stripe price)
- IAP price: $X × ~1.18 so the "Save 15%" math reads cleanly to the user
- Apple takes 15% under Small Business Program (under $1M/yr) — net per user is roughly equal between channels
- If priority shifts to margin over conversion, widen the web discount to 20–25%

## 0.4 Auth: Google + Sign in with Apple

**Why:** Apple requires Sign in with Apple to be offered when any other third-party login is offered (App Store Review Guideline 4.8). Google OAuth already exists; SIWA is additive, not a replacement.

**Backend impact:** new `/auth/apple/callback` route, `apple_sub` column on users table, ability to revoke Apple tokens on account deletion.

## 0.5 Notifications: APNs + FCM

**Why:** native push is the primary alert channel on mobile (replacing Telegram). Both platforms required.

**Backend impact:** `device_tokens` table keyed to user_id; alert dispatch fans out to all registered tokens.

## 0.6 Crash reporting: Sentry

**Why:** App Store reviewers will reject for crashes you can't reproduce locally. Need telemetry from day one of TestFlight.

---

## Open questions for the user before Phase 2

1. **Final IAP price.** Need the exact StoreKit product price (closest App Store tier to web × 1.18).
2. **Apple Developer Program enrollment status.** $99/yr. Needed before any iOS build can install on a real device.
3. **Google Play Console enrollment status.** $25 one-time.
4. **App display name** — same "akFISHinfo" or different? Affects App Store listing and bundle ID.
5. **Bundle ID** — proposed `com.akfishinfo.app` or similar. Must be locked before code signing.
