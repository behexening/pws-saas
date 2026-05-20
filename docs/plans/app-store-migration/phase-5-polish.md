# Phase 5 — Feature Polish

**Goal:** the things that are merely nice on web become **expected** on a native app. Each task here is independently shippable — pick the highest-ROI ones first if time-constrained.

Priority order is roughly top-to-bottom.

## 5.1 Offline cache (HIGH priority)

AK users have spotty LTE. A native app that white-screens offline feels broken.

**Tasks:**
1. After every successful openers/results fetch, persist payload to `@capacitor/preferences` with a timestamp.
2. On app launch with no network, render the last-cached payload with a "Last updated X ago — offline" banner.
3. Use IndexedDB for larger payloads (gazetteer, bbox geojson) so they aren't re-downloaded each launch.
4. Service worker on web continues to do its thing; mobile gets the Capacitor-backed approach.

## 5.2 Pull-to-refresh (HIGH)

Standard iOS pattern; users will look for it.

**Tasks:**
1. Use a small JS library or hand-roll a touch-event-based pull on the openers and results tabs.
2. Trigger the same fetch the existing refresh button calls.
3. Show the native-feeling spinner at the top.

## 5.3 Deep links (HIGH)

Push notification taps must open the relevant opener, not just the home screen.

**Tasks:**
1. Configure `akfishinfo://` custom scheme in `capacitor.config.ts`.
2. Configure Universal Links: host `apple-app-site-association` file at `akfishinfo.com/.well-known/apple-app-site-association`. Same for Android `assetlinks.json`.
3. Push payload includes `data.opener_id`. The `pushNotificationActionPerformed` listener routes to `/app#opener=${id}`.
4. The app screen reads the hash on load and scrolls / opens that opener.

## 5.4 Background fetch (MEDIUM)

iOS gives no guarantees, but enable it as a best-effort safety net.

**Tasks:**
1. Enable Background Modes → Background fetch in Xcode.
2. Use a Capacitor background task plugin OR rely entirely on server-pushed silent notifications (preferred — more reliable than client-initiated background fetch).
3. Silent push triggers a quick refresh of cached opener data so the app is fresh on next foreground.

## 5.5 Share sheet (MEDIUM)

iOS users expect to share an opener via the native share sheet.

**Tasks:**
1. Add a share button on opener detail.
2. Call `Share.share({ title, text, url })` — `url` is a deep link like `https://akfishinfo.com/app?opener=123` that handles both web and Universal Link cases.

## 5.6 Biometric unlock (MEDIUM)

After first auth, Face ID / Touch ID reopens the session.

**Tasks:**
1. Install `@capacitor-community/biometric-auth`.
2. On successful login, store a session token in iOS Keychain via the plugin's secure storage.
3. On subsequent launches, prompt biometric → unlock token → skip login screen.
4. Account screen has a toggle: "Use Face ID to sign in".

## 5.7 Map performance audit (MEDIUM)

If `app.html` uses Leaflet (probable), profile on a 3-year-old Android device.

**Tasks:**
1. Run on slow device, measure FPS during pan/zoom.
2. Cluster markers if more than ~50 openers visible.
3. Cache tiles locally for the PWS region (it's a bounded geographic area — bundle the entire tile pyramid if size is reasonable, sub-100MB).
4. Pre-zoom to PWS on launch.

## 5.8 Onboarding screens (already covered in Phase 3.9)

Listed here for completeness — see Phase 3.

## 5.9 In-app purchase upgrade prompts (LOW)

For free-trial expiry and gated features.

**Tasks:**
1. Soft paywall when trial expires: friendly modal explaining what they're losing.
2. Hard paywall when accessing premium features without entitlement.
3. The "Save on web" CTA appears here (see Phase 2.6).

## 5.10 Accessibility audit (already covered in Phase 3.10)

Listed here for completeness.

## 5.11 Performance — first-paint budget (LOW but worth tracking)

Target: app launches to interactive in under 2s on iPhone 12 mid-tier hardware.

**Tasks:**
1. Audit `public/app.html` bundle size — inline critical CSS, lazy-load Leaflet/charts.
2. Profile JS execution time on launch. Defer everything not needed for first paint.

## 5.12 Liquid Glass / Material You theming (NICE TO HAVE)

If keeping the app looking 2026-current matters for App Store editorial features.

**Tasks:**
1. Apply translucency to top bars on iOS using `backdrop-filter: blur(20px)`.
2. Material You dynamic color on Android 12+ if time permits.

## Verification

Use the app for a full day yourself in real conditions (cellular off, on a boat if possible — or simulate via airplane mode + slow-3G in dev tools). Note every moment of friction. Fix the top 5.
