# Phase 4 — Privacy, Legal, Store-Required Surfaces

**Goal:** every form, disclosure, and toggle that App Store / Play Store reviewers explicitly check is present and correct. Skipping anything here = guaranteed rejection.

## 4.1 In-app account deletion (Apple 5.1.1(v))

Required. Cannot delegate to "email us".

**Tasks:**
1. Backend: `DELETE /api/account` (auth required). Must:
   - Cancel any active Stripe subscription via Stripe API
   - Cancel any active RevenueCat subscription (note: Apple/Google subs are user-managed; we just stop granting access)
   - Revoke the Apple refresh token via `POST https://appleid.apple.com/auth/revoke` if `apple_refresh_token` present
   - Delete or anonymize user row, device tokens, related records
   - Return 200 only after all of the above
2. UI in `account.html`: "Delete Account" button → confirm modal → second confirm with typed "DELETE" → API call → redirect to logged-out state.
3. Surface this in the mobile app's account screen too. No deep-link-only or hidden flow — reviewers must find it within 2 taps from main nav.

## 4.2 App Tracking Transparency (iOS)

Only needed if reading IDFA or tracking across other apps/websites.

**Recommendation:** **don't track.** Use first-party Sentry only. Skip ATT prompt entirely by not linking AdSupport.framework. Set `NSUserTrackingUsageDescription` to absent.

If analytics added later, ATT prompt becomes mandatory.

## 4.3 Privacy nutrition labels (App Store Connect)

Fill out the Privacy form before first submission.

**Data inventory to declare:**
- Email address (account creation) — Linked to user, Used for App Functionality
- Name (from Apple/Google) — Linked to user, App Functionality
- User ID (internal) — Linked, App Functionality
- Purchase history (RevenueCat) — Linked, App Functionality
- Coarse location (if app uses any geo) — Linked, App Functionality
- Device ID (push token) — Linked, App Functionality
- Diagnostics (Sentry crash reports) — Not Linked, App Functionality

**Tracking:** None (assuming we follow 4.2).

## 4.4 Google Play Data Safety form

Same inventory, different UI. Fill out in Play Console before submission.

## 4.5 iOS permission strings (`Info.plist`)

Write in plain user-voice, not legalese. Reviewers reject vague ones.

**Required entries:**
- `NSLocationWhenInUseUsageDescription` (if app uses location): "akFISHinfo uses your location to show openers nearest to you on the map."
- `NSUserNotificationsUsageDescription` — handled by Capacitor push plugin, but the runtime prompt text comes from system. Set the app description to make purpose clear.
- `NSCameraUsageDescription` — N/A unless added later.
- `NSPhotoLibraryUsageDescription` — N/A.

## 4.6 Age rating, export compliance, content rights

App Store Connect intake forms.

**Tasks:**
1. **Age rating:** 4+ (no objectionable content). Confirm via the questionnaire.
2. **Export compliance:** uses HTTPS only, no proprietary crypto. Answer "Yes, uses encryption" + "Yes, exempt (HTTPS only)" → no ERN needed.
3. **Content rights:** confirm all map data (ADF&G public data, gazetteer, bbox geojson) is appropriately licensed and attributed. The existing privacy.html / terms.html may already cover this — verify.

## 4.7 Terms and privacy URLs

App Store Connect requires both as live URLs.

**Tasks:**
1. Confirm `public/privacy.html` and `public/terms.html` are accurate for mobile (mention IAP, push notifications, Apple/Google sign-in).
2. Add a section to privacy.html on what data RevenueCat receives.
3. Link both from the mobile app account screen.

## 4.8 EULA

Default Apple Standard EULA is fine for most apps. If using it, just point Apple at the standard. If we have a custom EULA, host at `akfishinfo.com/eula` and reference in App Store Connect.

## 4.9 App Store / Play Store listing copy

**Tasks (write but don't publish until Phase 7):**
1. App name: "akFISHinfo" (or full marketing name TBD)
2. Subtitle (30 chars): e.g., "Prince William Sound Openers"
3. Description (4000 chars max): adapt from `public/about.html` and `public/index.html` marketing copy. Lead with the value prop. Mention native push for alerts.
4. Keywords (100 chars): "fishing,salmon,alaska,prince william sound,opener,adfg,commercial fishing"
5. Promotional text (170 chars, can update without re-review): used for seasonal pushes
6. Support URL: `akfishinfo.com/support` (create if doesn't exist) or `mailto:`
7. Marketing URL: `akfishinfo.com`

## 4.10 Reviewer test account

App Store Connect requires a demo account for review.

**Tasks:**
1. Create a dedicated user `apple-review@akfishinfo.com` with full access pre-granted (skip the trial gate).
2. Add credentials to App Store Connect → App Review → Sign-In Information.
3. Add a clear note: "Sign in with the credentials above. All features are unlocked. Push notifications: trigger via the 'Test Alert' button in Settings (visible to this account only)."
4. Add a test-alert backdoor in the app visible only to this user.

## Verification

Walk through the Apple [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines) top to bottom. For each numbered guideline, mark **Compliant / N/A / Risk** and resolve every Risk before Phase 7.
