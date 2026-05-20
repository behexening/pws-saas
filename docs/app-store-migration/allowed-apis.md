# Allowed APIs — App Store Migration

Reference document for Phase 2+ implementation. Every API listed here was either fetched live from the official docs or, where flagged with **[unverified]**, taken from training-data knowledge because the doc page could not be fetched. Treat unverified items as "must spot-check before writing the line of code that uses them."

Foundation scope only (Capacitor core, official plugins, RevenueCat, Sign in with Apple). HIG / review guidelines / Play / push backend / Sentry are out of scope for this draft and will be added when subagents 5–9 run.

Sources marked **[verified 2026-05]** were fetched against live docs during this session.

---

## 1. Capacitor core

**Current major:** **v8** — [verified 2026-05] — https://capacitorjs.com/docs/getting-started

### Install
```
npm i @capacitor/core
npm i -D @capacitor/cli
npm i @capacitor/android @capacitor/ios
npx cap init
```
[verified] https://capacitorjs.com/docs/getting-started

### `npx cap init`
Interactive prompts: **App name** (human-readable), **App ID** (reverse-DNS bundle ID, e.g. `info.akfish.app` — must be a valid Java package, no hyphens). The `webDir` is asked here too. CLI flag form exists but the docs don't enumerate it; prefer interactive.

### Platform requirements
- **iOS:** iOS **15+**, Xcode **26.0+** [verified] https://capacitorjs.com/docs/ios
- **Android:** API **24+** (Android 7+), Chrome WebView 60+ [verified] https://capacitorjs.com/docs/android
- JDK / Gradle / Android Studio specifics not listed on the page — verify with Environment Setup before locking CI versions.

### CLI commands
- `npx cap copy` — copies `webDir` assets and config into the native projects.
- `npx cap update` — refreshes native dependencies (Pods, Gradle plugin entries).
- `npx cap sync` — **runs copy then update** [verified] https://capacitorjs.com/docs/cli/commands/sync
  - Flags: `--deployment` (preserves Podfile.lock and passes `--deployment` to `pod install`), `--inline` (inlines JS source maps).
  - Optional positional `android` | `ios`.
- Use `sync` after installing/removing any plugin or before opening the native IDE.

### `capacitor.config.ts` schema [verified] https://capacitorjs.com/docs/config

Top-level:
| Field | Type | Default |
|---|---|---|
| `appId` | string | — (required for native) |
| `appName` | string | — |
| `webDir` | string | — (we use `public`) |
| `loggingBehavior` | `'none'\|'debug'\|'production'` | `'debug'` |
| `backgroundColor` | string (hex) | platform default |
| `overrideUserAgent` | string | — |
| `appendUserAgent` | string | — |
| `zoomEnabled` | boolean | `false` |
| `initialFocus` | boolean | `true` |

`server.*`:
| Field | Type | Default |
|---|---|---|
| `hostname` | string | `'localhost'` |
| `iosScheme` | string | `'capacitor'` |
| `androidScheme` | string | `'https'` |
| `url` | string | unset — set for dev live-reload |
| `cleartext` | boolean | `false` |
| `allowNavigation` | string[] | `[]` |
| `errorPath` | string | `null` |
| `appStartPath` | string | `null` |

`ios.*`:
| Field | Type | Default |
|---|---|---|
| `path` | string | `'ios'` |
| `scheme` | string | `'App'` *(NOT `'capacitor'` — common stale-blog claim)* |
| `contentInset` | `'automatic'\|'scrollableAxes'\|'never'\|'always'` | `'never'` |
| `limitsNavigationsToAppBoundDomains` | boolean | `false` |
| `preferredContentMode` | `'recommended'\|'desktop'\|'mobile'` | `'recommended'` |
| `backgroundColor` | string | inherits |
| `scrollEnabled` | boolean | — |
| `allowsLinkPreview` | boolean | — |
| `loggingBehavior` | enum | inherits |

`android.*`:
| Field | Type | Default |
|---|---|---|
| `path` | string | `'android'` |
| `allowMixedContent` | boolean | `false` |
| `captureInput` | boolean | `false` |
| `webContentsDebuggingEnabled` | boolean | `false` |
| `minWebViewVersion` | number | `60` (floor: 55) |
| `minHuaweiWebViewVersion` | number | `10` |
| `flavor` | string | — |
| `loggingBehavior` | enum | inherits |
| `buildOptions` | object | `keystorePath`, `keystorePassword`, `keystoreAlias`, `keystoreAliasPassword`, `releaseType`, `signingType` |

`plugins.*` — keyed by plugin package class name (e.g. `PushNotifications`, `SplashScreen`); see each plugin below for its config shape.

### Platform detection (JS)
```ts
import { Capacitor } from '@capacitor/core';
Capacitor.getPlatform();        // 'ios' | 'android' | 'web'
Capacitor.isNativePlatform();   // boolean
Capacitor.isPluginAvailable(name: string);
```
[unverified — training data; structurally stable since v3]

### Anti-patterns
- `bundledWebRuntime` — removed/no-op in v8 (CLI injects the runtime).
- `Capacitor.platform` (property) / `Capacitor.isNative` (property) — both removed in v3. Use `getPlatform()` / `isNativePlatform()`.
- Single `Plugins` named import — removed in v3. Each plugin is its own npm package.
- `server.url` shipped to production — load fails to remote URL. Strip before submit.
- `allowNavigation: ['*']` — flagged in App Store review. Enumerate domains.
- Cross-major mismatches: every `@capacitor/*` package must share major. v8 ↔ v8.
- `ios.scheme: 'capacitor'` — that's the *server* `iosScheme`. The native target scheme is `'App'`.

---

## 2. Capacitor official plugins

All [verified 2026-05] via https://capacitorjs.com/docs/apis/<plugin> unless noted. All install pattern is identical:
```
npm install @capacitor/<plugin>
npx cap sync
```

### 2.1 `@capacitor/push-notifications`
```ts
register(): Promise<void>
unregister(): Promise<void>
getDeliveredNotifications(): Promise<DeliveredNotifications>
removeDeliveredNotifications(delivered: DeliveredNotifications): Promise<void>
removeAllDeliveredNotifications(): Promise<void>
createChannel(channel: Channel): Promise<void>             // Android
deleteChannel(args: { id: string }): Promise<void>          // Android
listChannels(): Promise<ListChannelsResult>                 // Android
checkPermissions(): Promise<PermissionStatus>
requestPermissions(): Promise<PermissionStatus>
removeAllListeners(): Promise<void>

addListener('registration',                  (token: Token) => void)
addListener('registrationError',             (err: RegistrationError) => void)
addListener('pushNotificationReceived',      (notif: PushNotificationSchema) => void)
addListener('pushNotificationActionPerformed', (notif: ActionPerformed) => void)
```
- **iOS:** enable Push Notifications capability in Xcode. AppDelegate must wire `application(_:didRegister/FailToRegisterForRemoteNotificationsWithDeviceToken/Error:)`. **No silent push support** (per docs).
- **Android:** place `google-services.json` in `android/app/`. Optional manifest metadata: `com.google.firebase.messaging.default_notification_icon`, `..._channel_id`. Android 13+ requires `requestPermissions()`. Gradle var: `firebaseMessagingVersion` (default `25.0.1`).

### 2.2 `@capacitor/geolocation`
```ts
getCurrentPosition(options?: PositionOptions): Promise<Position>
watchPosition(options: PositionOptions, cb: WatchPositionCallback): Promise<CallbackID>
clearWatch(options: ClearWatchOptions): Promise<void>
checkPermissions(): Promise<PermissionStatus>
requestPermissions(permissions?: GeolocationPluginPermissions): Promise<PermissionStatus>
```
- **iOS Info.plist:** `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`.
- **Android manifest:** `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, plus `<uses-feature android:name="android.hardware.location.gps" />` (optional but recommended).

### 2.3 `@capacitor/preferences`
```ts
configure(options: ConfigureOptions): Promise<void>
get(options: GetOptions): Promise<GetResult>
set(options: SetOptions): Promise<void>
remove(options: RemoveOptions): Promise<void>
clear(): Promise<void>
keys(): Promise<KeysResult>
migrate(): Promise<MigrateResult>
removeOld(): Promise<void>
```
- iOS backing store: `UserDefaults`. Android: `SharedPreferences`. **Not secure** — for tokens use Keychain via a dedicated plugin, not Preferences.

### 2.4 `@capacitor/browser`
```ts
open(options: OpenOptions): Promise<void>
close(): Promise<void>                    // Web & iOS only
removeAllListeners(): Promise<void>

addListener('browserFinished',   () => void)   // iOS & Android
addListener('browserPageLoaded', () => void)   // iOS & Android
```
- iOS uses `SFSafariViewController`. Android via `androidx.browser` (Custom Tabs). Gradle var: `androidxBrowserVersion` (default `1.9.0`).
- Use this for Google OAuth flow on native — Google rejects in-WebView OAuth.

### 2.5 `@capacitor/app`
```ts
exitApp(): Promise<void>                                              // Android only meaningful
getInfo(): Promise<AppInfo>
getState(): Promise<AppState>
getLaunchUrl(): Promise<AppLaunchUrl | undefined>
minimizeApp(): Promise<void>                                          // Android only
getAppLanguage(): Promise<AppLanguageCode>
toggleBackButtonHandler(options: ToggleBackButtonHandlerOptions): Promise<void>  // Android only
removeAllListeners(): Promise<void>

addListener('appStateChange',     (state: AppState) => void)
addListener('pause',              () => void)
addListener('resume',             () => void)
addListener('appUrlOpen',         (event: URLOpenListenerEvent) => void)
addListener('appRestoredResult',  (event: RestoredListenerEvent) => void)
addListener('backButton',         (event: BackButtonListenerEvent) => void)   // Android
```
- `appUrlOpen` handles **both** custom URL schemes and Universal Links (iOS) / App Links (Android) — wire deep links here, not in platform-specific code.

### 2.6 `@capacitor/share`
```ts
canShare(): Promise<CanShareResult>           // { value: boolean }
share(options: ShareOptions): Promise<ShareResult>
// ShareOptions: { title?, text?, url?, files?, dialogTitle? }
// ShareResult: { activityType }
```

### 2.7 `@capacitor/haptics`
```ts
impact(options?: ImpactOptions): Promise<void>           // { style: 'HEAVY'|'MEDIUM'|'LIGHT' }
notification(options?: NotificationOptions): Promise<void> // { type: 'SUCCESS'|'WARNING'|'ERROR' }
vibrate(options?: VibrateOptions): Promise<void>          // { duration: ms }
selectionStart(): Promise<void>
selectionChanged(): Promise<void>
selectionEnd(): Promise<void>
```

### 2.8 `@capacitor/status-bar`
```ts
setStyle(options: StyleOptions): Promise<void>            // { style: 'DARK'|'LIGHT'|'DEFAULT' }
setBackgroundColor(options: BackgroundColorOptions): Promise<void>  // Android only on modern versions
show(options?: AnimationOptions): Promise<void>
hide(options?: AnimationOptions): Promise<void>
getInfo(): Promise<StatusBarInfo>
setOverlaysWebView(options: SetOverlaysWebViewOptions): Promise<void>

addListener('statusBarVisibilityChanged', VisibilityChangeListener)
addListener('statusBarOverlayChanged',    OverlayChangeListener)
```
- **Android 16+ (API 36):** `overlaysWebView` and `backgroundColor` become no-ops due to enforced edge-to-edge UI.
- **iOS:** requires "View controller-based status bar appearance" enabled in Info.plist. Use `Animation.None` for first `show()` to avoid glitches on older iOS.

### 2.9 `@capacitor/splash-screen`
```ts
show(options?: ShowOptions): Promise<void>
hide(options?: HideOptions): Promise<void>
```
Config keys under `plugins.SplashScreen`:
- `launchShowDuration` (default `500`)
- `launchAutoHide` (default `true`)
- `launchFadeOutDuration` (default `200`)
- `backgroundColor`
- `androidSplashResourceName` (default `'splash'`), `androidScaleType`, `androidSpinnerStyle`
- `showSpinner`, `iosSpinnerStyle`, `spinnerColor`
- `splashFullScreen`, `splashImmersive`, `layoutName`, `useDialog`
- iOS storyboard requirement (LaunchScreen.storyboard) — docs page does not call it out; check the Capacitor iOS guide before submission.

### Plugin anti-patterns
- `register()` does **not** auto-request permission on iOS — you must `requestPermissions()` first, then `register()`.
- Geolocation `watchPosition` returns a `CallbackID`, not a `Promise<void>` — keep the ID to call `clearWatch`.
- `Preferences` is **not** secure storage. Don't put auth tokens / API keys there; use a Keychain plugin.
- Status-bar `setBackgroundColor` quietly no-ops on Android 16+ — don't rely on it for branding once Play raises target SDK.
- `Browser.close()` is iOS/web only — Android Custom Tabs cannot be programmatically closed.
- `App.exitApp()` is discouraged on iOS (HIG: apps should not quit themselves). It works on Android.

---

## 3. RevenueCat (Capacitor SDK + webhooks)

Plugin: `@revenuecat/purchases-capacitor`.

### Install
```
npm install @revenuecat/purchases-capacitor
npx cap sync
```
[verified] https://www.revenuecat.com/docs/getting-started/installation/capacitor

iOS Swift Language Version must be **5.0+**. Specific min iOS/Android SDK numbers not listed on the install page — verify against the Capacitor plugin GitHub README before locking.

### Initialization [verified]
```ts
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';

await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });  // dev only
await Purchases.configure({
  apiKey: '<appl_… or goog_…>',
  appUserID: '<optional internal user id>',
});
```
- Two **separate platform keys** (iOS = `appl_…`, Android = `goog_…`). Never embed the secret REST key in the app.
- Guard with `Capacitor.isNativePlatform()` — plugin throws on web. Web payments stay on Stripe.

### Offerings [unverified — exact return shape not on the page we fetched; structurally stable since SDK v4]
```ts
const { current, all } = await Purchases.getOfferings();
// current?: Offering | null
// Offering: { identifier, serverDescription, availablePackages: Package[], monthly?, annual?, lifetime? }
// Package:  { identifier, packageType, product: StoreProduct, offeringIdentifier }
```

### Purchase [verified — call shape]
```ts
try {
  const { customerInfo, productIdentifier } =
    await Purchases.purchasePackage({ aPackage: pkg });
  if (customerInfo.entitlements.active['pro']) { /* unlock */ }
} catch (e: any) {
  if (e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return;  // user cancelled
  // handle other codes
}
```
- **Cancellation is detected via `e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR`** [verified] — not `e.userCancelled`.
- Always trust the returned `customerInfo`; never infer success from absence of error alone.

### Entitlement check (source of truth)
```ts
const { customerInfo } = await Purchases.getCustomerInfo();
const isPro = !!customerInfo.entitlements.active['pro'];
Purchases.addCustomerInfoUpdateListener((info) => { /* re-render */ });
```
- Entitlement identifier (e.g. `'pro'`) is set in the RC dashboard — the only stable cross-platform key. Never key off `productIdentifier` (iOS and Android SKUs differ).

### Restore purchases (Apple guideline 3.1.1)
```ts
const customerInfo = await Purchases.restorePurchases();
```
[verified] https://www.revenuecat.com/docs/getting-started/restoring-purchases
Apple requires a visible "Restore Purchases" button on paywall and account screens for any non-consumable / subscription product.

### User identification [verified — partial]
```ts
const { customerInfo, created } = await Purchases.logIn({ appUserID: '<internal uuid>' });
await Purchases.logOut();
```
- **Use a non-guessable internal UUID, NOT email** [verified — explicit in docs, GDPR + guessability].
- `logIn` aliases the previous anonymous `$RCAnonymousID:…` to the identified ID server-side and may fire a `TRANSFER` webhook if a purchase had been on the anonymous ID.
- `Purchases.identify` / `Purchases.createAlias` / `Purchases.reset` were removed in v4+ — do not use.

### Webhook [verified] https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

**Authentication:** shared `Authorization` header value configured in the RC dashboard — **not HMAC-signed.** Verify with `crypto.timingSafeEqual`. Store the value as `RC_WEBHOOK_AUTH` env var.

Event types (17):
- `TEST`
- `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`
- `NON_RENEWING_PURCHASE`
- `SUBSCRIPTION_PAUSED`, `EXPIRATION`, `BILLING_ISSUE`
- `PRODUCT_CHANGE`, `TRANSFER`, `SUBSCRIPTION_EXTENDED`
- `TEMPORARY_ENTITLEMENT_GRANT`
- `REFUND_REVERSED`  *(App Store only)*
- `INVOICE_ISSUANCE`  *(Web Billing only)*
- `VIRTUAL_CURRENCY_TRANSACTION`
- `EXPERIMENT_ENROLLMENT`

Common payload shape:
```json
{
  "api_version": "1.0",
  "event": {
    "type": "INITIAL_PURCHASE",
    "id": "<uuid>",
    "app_user_id": "akfishinfo_user_uuid",
    "original_app_user_id": "akfishinfo_user_uuid",
    "aliases": ["$RCAnonymousID:...", "akfishinfo_user_uuid"],
    "product_id": "pro_monthly",
    "entitlement_ids": ["pro"],
    "period_type": "NORMAL",          // NORMAL | TRIAL | INTRO
    "environment": "PRODUCTION",      // PRODUCTION | SANDBOX
    "store": "APP_STORE",             // APP_STORE | PLAY_STORE | …
    "transaction_id": "...",
    "original_transaction_id": "...",
    "purchased_at_ms": 1591121853000,
    "expiration_at_ms": 1591726653000,
    "price": 2.49,
    "currency": "USD"
  }
}
```
- Field presence varies by event type. Always reconcile by `app_user_id` AND walk `aliases[]`.
- Filter `event.environment === 'SANDBOX'` out of production billing logic.
- `TRANSFER` event: an entitlement moved off this `app_user_id` onto another — revoke access on the losing side.

### Anti-patterns
- Trusting client-side entitlement state for server actions. Server eligibility (SMS alerts etc.) must come from the webhook-updated DB row.
- Keying entitlement off `productIdentifier` — use the dashboard entitlement key.
- Calling `configure` twice with different `appUserID`. Use `logIn`/`logOut` after initial configure.
- `Purchases.identify` / `Purchases.reset` / `Purchases.createAlias` — removed in v4+.
- Setting email as App User ID — explicitly discouraged.
- `offerings.current` can be null if no offering is marked "Current" in the dashboard — handle.

---

## 4. Sign in with Apple

Required because we offer Google OAuth → App Store Guideline 4.8 mandates SIWA as an equivalent option.

### Client plugin: `@capacitor-community/apple-sign-in`
```
npm i @capacitor-community/apple-sign-in
npx cap update
```
[verified] https://github.com/capacitor-community/apple-sign-in

**Android: not supported.** Use Apple's web flow (Apple JS SDK with a Service ID) inside `@capacitor/browser` for the Android path. Same `identityToken` + `authorizationCode` come back; backend verification is identical.

In Xcode: enable the **Sign in with Apple** capability on the App ID and target.

### Authorize
```ts
import { SignInWithApple, SignInWithAppleOptions } from '@capacitor-community/apple-sign-in';

const options: SignInWithAppleOptions = {
  clientId: 'info.akfish.app',        // bundle ID (native) or Service ID (web)
  redirectURI: 'https://app.akfishinfo.com/auth/apple/callback', // web only
  scopes: 'email name',
  state: '<csrf>',
  nonce: '<random nonce>',
};
const result = await SignInWithApple.authorize(options);
```
Response (`result.response`):
- `user` — stable Apple user identifier (matches `sub` in identity token)
- `email`, `givenName`, `familyName` — **only present on first sign-in**
- `identityToken` — JWT to verify server-side
- `authorizationCode` — one-time code, exchange at `/auth/token` for refresh token
- `realUserStatus` — `0|1|2` anti-fraud signal

### First-sign-in gotcha [unverified URL, well-documented behavior]
Apple sends `email` + name **only on the first authorization** for a given App ID + Apple ID. Persist them on first auth — subsequent calls return null for those fields. On `POST /api/auth/apple/native`, UPSERT into `captains` keyed by `apple_user_id` and only update name/email if the row is new.

### Server-side identity-token validation [unverified specific URL, standard JWT pattern]
- JWKS: `https://appleid.apple.com/auth/keys` (cache by `kid`)
- Algorithm: **RS256**
- Required claim checks:
  - `iss === 'https://appleid.apple.com'`
  - `aud ∈ { <bundle ID for native>, <Service ID for web> }`
  - `exp > now`
  - `nonce` matches SHA-256 of nonce sent to client
  - `sub` → store as `apple_user_id`
- Useful extras: `email_verified`, `is_private_email`

Recommended Node libs: `jose` (`createRemoteJWKSet` + `jwtVerify`) for the native verification endpoint; `passport-apple` mirrors the existing Google Passport strategy for the web/Android redirect flow.

### `client_secret` JWT (NOT a static string)
For `POST https://appleid.apple.com/auth/token` and the revoke endpoint, generate fresh per call:
- Header: `{ alg: 'ES256', kid: <Key ID> }`
- Claims: `iss=<Team ID>`, `sub=<Service ID or bundle ID>`, `aud='https://appleid.apple.com'`, `iat`, `exp ≤ iat + 15777000` (recommended ~5 min)
- Sign with the `.p8` private key (ES256)

### Token revocation (required for account deletion — guideline 5.1.1(v))
`POST https://appleid.apple.com/auth/revoke` form-encoded:
- `client_id` = bundle ID or Service ID
- `client_secret` = JWT above
- `token` = user's refresh or access token
- `token_type_hint` = `refresh_token` | `access_token`

Add `apple_refresh_token` column to `captains` (encrypted at rest), populated from the token-exchange response. Call revoke in `DELETE /api/account` before deleting the row.

### Private relay email
Hide-My-Email addresses look like `xyz123abc@privaterelay.appleid.com`. To send mail to them, register Mailgun sending domain at Apple Developer → Configure → "Sign in with Apple for Email Communication" and update SPF. Otherwise outbound bounces.

### Apple Developer / App Store Connect setup
1. **App ID** — enable "Sign in with Apple" capability (Primary App ID).
2. **Service ID** — for the web/Android flow. Primary App ID = the iOS App ID (so accounts unify). Domains + Return URLs set to `app.akfishinfo.com` / `/auth/apple/callback`.
3. **Key (.p8)** — Keys → "+" → enable Sign in with Apple → choose primary App ID → download once. Record Key ID.
4. **Team ID** — top-right of developer portal.

New env vars: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents), `APPLE_SERVICE_ID`, `APPLE_BUNDLE_ID`.

### Anti-patterns
- Trusting client-supplied `user` / `email` without verifying `identityToken` against JWKS.
- Treating `client_secret` as a static string. It's a JWT that expires.
- Ignoring `nonce` (enables replay).
- Confusing Service ID (web `aud`) with bundle ID (native `aud`) — backend must accept both.
- Sending mail to `@privaterelay.appleid.com` without registering Mailgun in Apple's relay console.
- Skipping `/auth/revoke` on account delete — rejection under 5.1.1(v).

---

## Files this will touch in Phase 2

- `backend_v2.js` — Passport Apple strategy, native verifier route (`POST /api/auth/apple/native`), `DELETE /api/account` revoke flow, RC webhook handler (`POST /webhooks/revenuecat`), new env vars.
- `captains` schema additions: `apple_user_id`, `apple_refresh_token` (encrypted), `revenuecat_user_id` (= internal UUID, if not already the primary key).
- `public/login.html` — "Sign in with Apple" button (HIG-equivalent rendering).
- New: top-level `capacitor.config.ts`, `ios/`, `android/` directories created by `cap add`.

---

## 5. Apple HIG (selective)

All values **[unverified — Apple's HIG pages are JS-rendered; WebFetch returns title only]** but reflect long-stable published guidance. Confirm in Xcode's Library inspector or via the SF Symbols / SwiftUI Font APIs before locking design values.

### Layout — https://developer.apple.com/design/human-interface-guidelines/layout
- **Minimum tap target: 44×44 pt.** Map pins, toolbar glyphs, all interactive elements.
- **Standard margins:** 16 pt compact width, 20 pt regular width.
- **Safe area insets vary by device:** read at runtime via `env(safe-area-inset-*)` (CSS) or `view.safeAreaInsets` (UIKit). Typical notched-device portrait: ~47–59 pt top, 34 pt bottom (home indicator), ~50 pt landscape sides.
- **Home indicator clearance: 34 pt minimum** below before any tappable content (or gesture conflict eats the tap).

### Typography — Dynamic Type table (default Large)
| Style | Size pt | Leading pt | Weight |
|---|---|---|---|
| Large Title | 34 | 41 | Regular |
| Title 1 | 28 | 34 | Regular |
| Title 2 | 22 | 28 | Regular |
| Title 3 | 20 | 25 | Regular |
| Headline | 17 | 22 | Semibold |
| Body | 17 | 22 | Regular |
| Callout | 16 | 21 | Regular |
| Subhead | 15 | 20 | Regular |
| Footnote | 13 | 18 | Regular |
| Caption 1 | 12 | 16 | Regular |
| Caption 2 | 11 | 13 | Regular |

- **SF Pro Text** below 20 pt, **SF Pro Display** at 20+ pt.
- Minimum readable size 11 pt.
- Honor Dynamic Type (`-apple-system-body` in CSS, `Font.body` in SwiftUI). AX5 ~doubles Body to ~53 pt.

### Color — Dark Mode + semantics
- Use semantic colors (`label`, `secondaryLabel`, `systemBackground`, `secondarySystemBackground`, `tertiarySystemBackground`, `separator`, `systemFill`, …) — system swaps light/dark automatically.
- Single app-wide tint color drives interactive elements.
- WCAG contrast: 4.5:1 body, 3:1 large text (≥18 pt or ≥14 pt Semibold).
- Display P3 for wide-gamut assets, sRGB safe baseline.
- Don't rely on color alone (open/closed districts) — pair with text/shape.

### Tab bars vs nav bars (decision for akFISHinfo)
- **Tab bars:** 2–5 tabs, height 49 pt portrait / 32 pt landscape + safe area. For genuine top-level peers only.
- **Nav bars:** 44 pt standard, ~96 pt large-title expanded. Back button always **leading** (left, LTR). Up to 2 trailing action buttons.
- **The "live | old" toggle on the map is a filter, not navigation** — use a **segmented control in the nav bar**, NOT a tab bar.

### Menus
- Pull-down + context menus share style. Order most-likely-first; destructive last and red. Use SF Symbol leading icons.

### Launch screen — https://developer.apple.com/design/human-interface-guidelines/launching
- Storyboard or SwiftUI view (`LaunchScreen.storyboard` referenced from Info.plist). Static PNGs deprecated.
- **No version numbers, no "Loading…", no splash advertising, no interactive elements, no translated copy.**
- Match the first frame of the app for an instant transition.

### Onboarding
- 1–3 screens max. Always allow Skip. Don't ask for personal info upfront. Request permissions in context, not in a permissions list.

### App icons — https://developer.apple.com/design/human-interface-guidelines/app-icons
- **Master: 1024×1024 PNG, flat, no alpha, no transparency.**
- **No pre-applied rounded mask** — system applies the squircle. Pre-rounded = double-rounded.
- No text overlays (except wordmarks that are the brand). No screenshots of UI.
- iOS 18+ optionally provides Dark and Tinted variants.

| Use | pt | @2x px | @3x px |
|---|---|---|---|
| iPhone app | 60 | 120 | 180 |
| iPad app | 76 | 152 | — |
| iPad Pro app | 83.5 | 167 | — |
| Spotlight | 40 | 80 | 120 |
| Settings | 29 | 58 | 87 |
| Notification | 20 | 40 | 60 |
| App Store marketing | 1024 | — | — |

### Sign in with Apple button
- Three styles: black, white, white-with-outline (1 pt border).
- Three texts: "Sign in with Apple" / "Sign up with Apple" / "Continue with Apple".
- Corner radius developer-selectable, 0 to ½ button height.
- **Min height 30 pt, recommended 44 pt** (matches tap-target rule).
- Padding: ≥ 0.20× height left of logo, 0.10× between logo+text, 0.20× right of text.
- SF Pro Medium, auto-scaled.
- **Must be at least as prominent as any other sign-in button** — same width, same or higher in stack order. Stacking below Google = 4.8 violation.

### HIG anti-patterns
- Android-style bottom tabs (Material visuals on iOS chrome).
- Back arrow on trailing (right) side.
- Pre-rounded app icon (double-mask).
- Icons with tiny illegible text.
- Hardcoded `background: #FFFFFF` breaking Dark Mode (use semantic colors).
- Custom "Continue with Apple" with redrawn logo, wrong font, or below Google.
- Launch screen with version / "Loading…" / animation.
- 32–40 pt touch targets "for cleanliness."
- 6+ slide onboarding carousels.
- Emoji used as iconography (use SF Symbols).
- Dark Mode that just inverts light (true Dark Mode raises elevated surfaces).

---

## 6. App Store Review Guidelines — exact text

All [verified 2026-05] via https://developer.apple.com/app-store/review/guidelines

### 2.1 App Completeness
> Submissions to App Review … should be final versions with all necessary metadata and fully functional URLs included … include demo account info (and turn on your back-end service!) if your app includes a login.
> If you offer in-app purchases … make sure they are complete, up-to-date, visible to the reviewer and functional.

**akFISHinfo:** seed a pro-tier reviewer account in Postgres before each submission (`tier='pro'`, `subscription_active=true`). RevenueCat offering + App Store Connect IAP products must be in "Ready to Submit" state and attached to the build.

### 2.3.10 Accurate Metadata
> Make sure your app is focused on the experience of the Apple platforms it supports, and don't include names, icons, or imagery of other mobile platforms or alternative app marketplaces in your app or metadata.

**akFISHinfo:** screenshots/description must not show Android UI, Play badges, or the web `akfishinfo.com` URL bar.

### 3.1.1 In-App Purchase
> If you want to unlock features or functionality within your app … you must use in-app purchase. Apps may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality markers, QR codes, cryptocurrencies and cryptocurrency wallets, etc.
> Any credits or in-game currencies purchased via in-app purchase may not expire, **and you should make sure you have a restore mechanism for any restorable in-app purchases.**

**akFISHinfo:** pro tier purchased *inside* the iOS app must go through StoreKit/RevenueCat. Visible **Restore Purchases** button on paywall AND account screen wired to `Purchases.restorePurchases()`. Use StoreKit introductory offer for the 7-day trial.

### 3.1.3 Other Purchase Methods (anti-steering)
> Apps in this section cannot, within the app, encourage users to use a purchasing method other than in-app purchase, except for apps on the United States storefront and as set forth in 3.1.1(a) and 3.1.3(a).
> **3.1.3(b) Multiplatform Services:** Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired in your app on other platforms or your web site … provided those items are also available as in-app purchases within the app.
> **3.1.3(f) Free Stand-alone Apps:** Free apps acting as a stand-alone companion to a paid web based tool … do not need to use in-app purchase, provided there is no purchasing inside the app, or calls to action for purchase outside of the app.

**akFISHinfo:** NOT a reader app (not magazines/news/books/audio/music/video) → 3.1.3(a) does not apply. Most viable path is **3.1.3(b)**: ship RevenueCat IAP, accept the 15–30% on iOS-originated subs, and let existing web subscribers sign in for free. **Strip every mention of `akfishinfo.com/pricing` from the iOS bundle** outside U.S. storefront — anti-steering is enforced by review note grep. The StoreKit External Link Account Entitlement is **NOT available** to akFISHinfo (reader-apps only).

### 4.2 Minimum Functionality — HIGHEST RISK
> Your app should include features, content, and UI that elevate it beyond a repackaged website.
> **4.2.2** Other than catalogs, apps shouldn't primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links.

**akFISHinfo:** A WKWebView wrapper of `app.akfishinfo.com` will be rejected as a "web clipping." Must ship native affordances: native push (APNs via `@capacitor/push-notifications`), native location services, native account screens, native onboarding. The Leaflet map is the biggest risk — **strongly consider replacing with native MapKit or Mapbox iOS SDK** consuming the same GeoJSON feeds. Reviewers flag webview-only apps very reliably under 4.2.

### 4.8 Sign in with Apple
> Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, …) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service with the following features:
> - the login service limits data collection to the user's name and email address;
> - the login service allows users to keep their email address private as part of setting up their account; and
> - the login service does not collect interactions with your app for advertising purposes without consent.

Exceptions: own-account-only, alternative marketplace, education/enterprise, gov-ID, third-party-service client. **None apply to akFISHinfo.** SIWA is mandatory alongside Google.

### 5.1.1 Data Collection and Storage
> **(i)** Privacy policy link required in App Store Connect AND inside the app. Must identify what's collected, how, all uses; describe data retention/deletion, and how a user revokes consent.
> **(ii)** Secure user consent. Ensure purpose strings clearly and completely describe your use of the data.
> **(iii) Data Minimization:** Apps should only request access to data relevant to the core functionality.

### 5.1.1(v) Account Deletion — exact text
> If your app supports account creation, **you must also offer account deletion within the app.**

**akFISHinfo:** native in-app "Delete Account" button required. Not "contact support." Must fully delete the captain row (or pseudonymize), cancel any RevenueCat/Stripe subscription, revoke `user_sessions`, null PII in `sms_log` retained for audit.

### 5.1.5 Location Services
> Use Location Services in your app only when it is directly relevant to the features and services provided by the app. Ensure that you notify and obtain consent before collecting, transmitting, or using location data.

**akFISHinfo:** `WhenInUse` only — do not request `Always`. Purpose string: "akFISHinfo uses your location to center the map on your boat and highlight the nearest PWS district."

### 5.4 VPN Apps — **N/A.**

### Review guideline anti-patterns
- Any "subscribe on the web" mention inside the iOS app outside the U.S. storefront — anti-steering violation. Strip from Help pages too.
- Missing Restore Purchases button — auto-fail under 3.1.1.
- IAP-eligible pro features that are only purchasable via external link — auto-fail under 3.1.3(b). All pro features must also be purchasable via IAP.
- Missing in-app Delete Account → 5.1.1(v) rejection.
- Vague location purpose strings ("to improve your experience") or requesting `Always` — 5.1.1(iii) + 5.1.5.
- WKWebView-only "wrapper" with no native UI — 4.2.2.
- Google Sign-In without Sign in with Apple — 4.8.
- Reviewer demo account without pro entitlement seeded — 2.1.
- IAP products in "Missing Metadata" state at submission — 2.1(b).
- Screenshots with web pricing that contradicts IAP pricing — 2.3.10.

---

## 7. Google Play

### Target API level — [verify in Console]
- **Aug 31 2024:** new apps and updates must target **Android 14 (API 34)** or higher.
- **2025 cycle (currently published policy):** API 35 (Android 15) — new apps Aug 31 2025, updates Nov 1 2025. Confirm exact dates in https://support.google.com/googleplay/android-developer/answer/9888379 before shipping.
- Recommended: `targetSdk = 35`, `minSdk = 24` (Android 7+, ~99% coverage).

### Play Billing Library — [verified] https://developer.android.com/google/play/billing/integrate
- Current major: **Play Billing Library 8** (8.3.0 at fetch). Library 6 deprecated.
- akFISHinfo uses RevenueCat which wraps Billing — we don't call `BillingClient` directly. Confirm RC Android SDK targets BL 8.

### RTDN (Real-Time Developer Notifications) — [verified] https://developer.android.com/google/play/billing/rtdn-reference

Setup:
1. Create GCP project; enable Cloud Pub/Sub API.
2. Create topic `projects/<project>/topics/play-rtdn`.
3. Grant `google-play-developer-notifications@system.gserviceaccount.com` the **Pub/Sub Publisher** role on the topic.
4. Create push subscription → endpoint `https://akfishinfo.com/webhooks/google-play-rtdn`.
5. Play Console → Monetize → Monetization setup → RTDN. Paste topic name. **Send Test Message must succeed** before submission.

Push envelope:
```json
{
  "message": {
    "data": "<base64 DeveloperNotification JSON>",
    "messageId": "...",
    "publishTime": "...",
    "attributes": {}
  },
  "subscription": "projects/<project>/subscriptions/play-rtdn-sub"
}
```
Decoded `message.data`:
```json
{
  "version": "1.0",
  "packageName": "info.akfish.app",
  "eventTimeMillis": "...",
  "subscriptionNotification": {
    "version": "1.0",
    "notificationType": 4,
    "purchaseToken": "..."
  }
}
```

`subscriptionNotification.notificationType` (full list, [verified]):
| # | Constant |
|---|---|
| 1 | SUBSCRIPTION_RECOVERED |
| 2 | SUBSCRIPTION_RENEWED |
| 3 | SUBSCRIPTION_CANCELED |
| 4 | SUBSCRIPTION_PURCHASED |
| 5 | SUBSCRIPTION_ON_HOLD |
| 6 | SUBSCRIPTION_IN_GRACE_PERIOD |
| 7 | SUBSCRIPTION_RESTARTED |
| 8 | SUBSCRIPTION_PRICE_CHANGE_CONFIRMED (deprecated) |
| 9 | SUBSCRIPTION_DEFERRED |
| 10 | SUBSCRIPTION_PAUSED |
| 11 | SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED |
| 12 | SUBSCRIPTION_REVOKED |
| 13 | SUBSCRIPTION_EXPIRED |
| 17 | SUBSCRIPTION_ITEMS_CHANGED |
| 18 | SUBSCRIPTION_CANCELLATION_SCHEDULED |
| 19 | SUBSCRIPTION_PRICE_CHANGE_UPDATED |
| 20 | SUBSCRIPTION_PENDING_PURCHASE_CANCELED |
| 22 | SUBSCRIPTION_PRICE_STEP_UP_CONSENT_UPDATED |

`voidedPurchaseNotification` includes `orderId`, `productType` (1=sub, 2=one-time), `refundType` (1=full, 2=partial).

Rules:
- Notifications are signals — backend MUST call `purchases.subscriptionsv2.get` to read authoritative state.
- Idempotency: dedupe on `messageId` (at-least-once delivery).
- Return 2xx within 10s = ack.
- **akFISHinfo recommendation:** configure RTDN topic in RevenueCat dashboard so RC ingests it, then we consume RC webhooks — single source of truth. Only build our own RTDN consumer if we ever leave RC.

### Data Safety form — [verify in Console]

Play Console → App content → Data safety. For each collected/shared data type declare: collected y/n, shared y/n, optional vs required, purpose (App functionality / Analytics / Developer comms / Advertising / Fraud / Personalization / Account management), encrypted-in-transit, deletion path.

Mapping for akFISHinfo:
| Data | Category | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|---|
| Email | Personal info → Email | Yes | No | Account mgmt, App functionality | Required |
| Phone (Twilio SMS opt-in) | Personal info → Phone | Yes | Yes (Twilio processor) | App functionality | Optional |
| Name (from Google OAuth / SIWA) | Personal info → Name | Yes | No | Account mgmt | Optional |
| Coarse location | Location → Approximate | Yes | No | App functionality | Optional |
| Precise location | Location → Precise | Yes | No | App functionality | Optional |
| FCM push token | Device IDs (only if used cross-context) | conditional | No | App functionality | Required |
| RC subscription state | Purchases → Purchase history | Yes | Yes (RC processor) | App functionality | Required |
| Crash logs (Sentry) | App info → Crash logs, Diagnostics | Yes | No | Analytics | Required |

When unsure whether a processor counts as "shared," declare yes (safer). Not selling data, no advertising IDs, no ad networks.

### Account deletion — [verify in Console] effective May 31 2024
Required:
1. In-app deletion path (Account → Delete Account → calls `DELETE /api/account`).
2. **Public web URL** reachable without installing — declared in Play Console → App content → Account deletion → Web resource URL. Add `/delete-account` page.
3. Both must delete or anonymize all user data. Exceptions for legal retention (Stripe invoices, RC receipts, security logs) must be disclosed.

### Play anti-patterns
- Data Safety form doesn't match the privacy policy URL — automated review diff = rejection. Write the form first, mirror policy verbatim.
- Missing account-deletion web URL — rejection since May 2024.
- Missing target API deadline — release blocked.
- Manifest declares `READ_CONTACTS` / `ACCESS_BACKGROUND_LOCATION` without need — sensitive-permissions form triggered, rejection likely. Keep manifest to `INTERNET`, `POST_NOTIFICATIONS`, `ACCESS_COARSE_LOCATION`, optional `ACCESS_FINE_LOCATION`, `com.android.vending.BILLING` (auto-added by RC).
- RTDN test message fails before submission — Console blocks IAP config.
- Mailgun click-tracking on verification emails creates a "shared with third parties" claim that doesn't match privacy policy. Disable click-tracking on transactional mail.

---

## 8. Push notification backend (APNs + FCM, Node)

Capacitor's `@capacitor/push-notifications` handles the client side. This section covers the **server**.

### APNs `.p8` auth key — [verified] https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server

Generated in App Store Connect → Keys → Apple Push Notifications service. Record:
- **`.p8` private key file** (PKCS#8) — **only downloadable once.** Stash in Railway env immediately.
- **Key ID** (10 chars).
- **Team ID** (10 chars).

One APNs key signs for **all bundle IDs in the team**.

### APNs HTTP/2 endpoints — [verified]
- **Production:** `https://api.push.apple.com:443/3/device/{deviceToken}`
- **Sandbox:** `https://api.sandbox.push.apple.com:443/3/device/{deviceToken}` (Simulator + dev-signed builds)
- Token format identical across environments; **only the gateway differs.** Crossing returns 400 `BadDeviceToken` — must not be mis-read as "dead token" or you delete valid rows.

JWT (ES256, p8-signed):
```
header: { "alg": "ES256", "kid": "<Key ID>" }
claims: { "iss": "<Team ID>", "iat": <epoch seconds> }
```
- Reuse one JWT for ~50 minutes, then rotate. Apple rejects >1 hour old; rate-limits new-JWT churn.
- Header: `Authorization: bearer <JWT>` per request.

### APNs payload schema — [verified] https://developer.apple.com/documentation/usernotifications/generating_a_remote_notification
```json
{
  "aps": {
    "alert": { "title": "string", "subtitle": "string", "body": "string" },
    "badge": 1,
    "sound": "default",
    "thread-id": "openings-2026",
    "category": "OPENING_ALERT",
    "content-available": 1,
    "mutable-content": 1,
    "interruption-level": "time-sensitive",
    "relevance-score": 0.9
  },
  "announcementId": 4821
}
```
- `interruption-level`: `passive` | `active` | `time-sensitive` | `critical`.
- Payload size limits: 4 KB standard, 5 KB VoIP, 4 KB Live Activity.

### APNs response codes — [verified]
| Status | Reason | Action |
|---|---|---|
| 200 | Delivered | ok |
| 400 | `BadDeviceToken` / `BadCollapseId` / etc. | Fix payload, don't retry as-is. **Differentiate from 410!** |
| 403 | `InvalidProviderToken` / `ExpiredProviderToken` | Re-sign JWT, retry |
| 410 | `Unregistered` | **Delete token row** |
| 413 | `PayloadTooLarge` | Trim |
| 429 | `TooManyRequests` | Exponential backoff |
| 500/503 | Server error | Retry with backoff |

410 response body has `{ "reason": "Unregistered", "timestamp": ... }` — `timestamp` is when the token died. If your DB `last_seen_at` is later, the token was re-registered — **skip deletion**.

### `@parse/node-apn` — [unverified — fetch denied, stable v6+ surface]
```js
import apn from '@parse/node-apn';
const provider = new apn.Provider({
  token: { key: fs.readFileSync('AuthKey.p8'), keyId: '...', teamId: '...' },
  production: process.env.NODE_ENV === 'production',
});
const note = new apn.Notification();
note.topic = 'info.akfish.app';
note.pushType = 'alert';
note.priority = 10;
note.expiry = Math.floor(Date.now()/1000) + 3600;
note.alert = { title: 'Opening', body: '...' };
note.payload = { announcementId: 4821 };
const result = await provider.send(note, deviceTokens);
// result.failed[].status / .response.reason → DELETE row on 410 / Unregistered / BadDeviceToken
```
Provider keeps a persistent HTTP/2 multiplex connection — **do not create one per request**. Call `provider.shutdown()` on process exit.

### FCM HTTP v1 + Admin SDK — [unverified — fetch denied; stable since 2024 legacy turndown]

Endpoint: `POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send`. Auth: OAuth2 Bearer from service account JSON (scope `https://www.googleapis.com/auth/firebase.messaging`) — Admin SDK refreshes automatically.

Message JSON (exactly one of `token` | `topic` | `condition`):
```json
{
  "message": {
    "token": "...",
    "notification": { "title": "Opening", "body": "..." },
    "data": { "announcementId": "4821" },
    "android": { "priority": "HIGH", "ttl": "3600s",
                 "notification": { "channel_id": "openings" } },
    "apns": { "headers": { "apns-priority": "10", "apns-push-type": "alert" },
              "payload": { "aps": { "alert": {...}, "sound": "default" } } }
  }
}
```

Admin SDK init:
```bash
npm install firebase-admin
```
```js
import admin from 'firebase-admin';
const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa) });
```

Messaging API:
```js
const m = admin.messaging();
await m.send(message);                            // single
await m.sendEach(messages);                       // up to 500 messages
await m.sendEachForMulticast({ tokens, notification, data });  // up to 500 tokens
await m.subscribeToTopic(tokens, 'district-300');
await m.unsubscribeFromTopic(tokens, 'district-300');
```

Token-invalidation error codes in `responses[i].error.code`:
- `messaging/registration-token-not-registered` → **delete row**
- `messaging/invalid-registration-token` → **delete row**
- `messaging/quota-exceeded`, `messaging/server-unavailable` → retry with backoff

### Topic vs token decision for akFISHinfo
`alertProUsers(districts)` filters by `tier='pro'` + subscribed districts on the server — that logic can't live in a topic name. **Use token-based multicast** (`sendEachForMulticast`, ≤500 tokens per call).

### Push backend anti-patterns
- Using the deprecated FCM legacy server key (`Authorization: key=AAAA...`) — turned down June 20 2024. Must be HTTP v1 via Admin SDK.
- Hardcoding APNs production endpoint while shipping a sandbox build → 400 BadDeviceToken misread as dead token.
- Never invalidating dead tokens — send volume grows monotonically, eventually rate-limited.
- Sending one message at a time in a `for` loop — use `sendEachForMulticast` / reuse `apn.Provider`.
- Silent push (`content-available: 1`) without enabling "Background Modes → Remote notifications" in Xcode — backend sees 200, client never wakes.
- Committing `.p8` or service account JSON to the repo.
- Reusing `admin.initializeApp()` without a name across multiple projects (throws).

---

## 9. Sentry (Capacitor + Node)

### Capacitor SDK — [verified] https://docs.sentry.io/platforms/javascript/guides/capacitor/

Install (framework companion required):
```
npm install @sentry/capacitor @sentry/angular   # or @sentry/react, @sentry/vue
npx cap sync
```

For akFISHinfo (vanilla HTML/JS — no Angular/React/Vue), use `@sentry/browser` as the companion. Verify against the docs page; the wizard supports framework-less Capacitor projects.

`Sentry.init()` options [verified]:
- `dsn`
- `sendDefaultPii` (boolean) — set `false` initially
- `release` (e.g. `"akfishinfo@1.0.0"`) — map to `CFBundleShortVersionString` / `versionName`
- `dist` — map to `CFBundleVersion` / `versionCode`
- `enableLogs` (boolean)
- `integrations` — `browserTracingIntegration()`, `replayIntegration()`, `feedbackIntegration()`
- `tracesSampleRate` (0.0–1.0)
- `tracePropagationTargets` (string[])
- `replaysSessionSampleRate`, `replaysOnErrorSampleRate`

iOS/Android post-`cap sync` — docs page didn't enumerate; check the wizard output. Source maps and native symbolication require `sentry-cli` upload in the build pipeline.

### Source map upload — [verified — partial] https://docs.sentry.io/platforms/javascript/guides/capacitor/sourcemaps/

Wizard-driven:
```
npx @sentry/wizard@latest -i sourcemaps
```
Env vars needed: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`. The wizard writes the sentry-cli invocation into the build pipeline — run after web bundle build, before `cap sync`. Without source map upload, every native stack trace is minified-forever.

### Node SDK — [verified] https://docs.sentry.io/platforms/javascript/guides/node/

```
npm install @sentry/node
```

**Critical:** the init file MUST be loaded before any other module.

CommonJS pattern:
```js
// instrument.js
const Sentry = require("@sentry/node");
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enableLogs: true,
});
```
```js
// backend_v2.js
require("./instrument");   // Require this FIRST
const express = require("express");
const Sentry = require("@sentry/node");
// ... routes ...
Sentry.setupExpressErrorHandler(app);   // After all routes, before any other error middleware
app.listen(3000);
```

ESM uses `node --import ./instrument.mjs backend_v2.mjs` (Node 18.19+).

**The `Sentry.Handlers.requestHandler` / `Sentry.Handlers.errorHandler` pattern is removed in @sentry/node v8+** — use `Sentry.setupExpressErrorHandler(app)` exclusively.

### Releases — recommendation
Tag the same `release` value across web bundle + native shells so Capacitor crashes (JS-side) unify with the bundle. Example: `akfishinfo@1.0.0+build.42` everywhere; `dist` carries the per-platform build number.

### PII / scrubbing
`sendDefaultPii: false` is the default since v8. Don't manually set `Sentry.setUser({ email })` — use an internal UUID or a hash. Use `beforeSend(event)` to scrub phone numbers from breadcrumbs.

### Sentry anti-patterns
- Skipping source map upload → permanent minified stack traces. Add `sentry-cli` to the build script before `cap sync`.
- Initializing Sentry after Express has already loaded — auto-instrumentation/tracing silently breaks. The instrument file must be required first.
- Using old `Sentry.Handlers.*` middleware in v8+ — removed; use `setupExpressErrorHandler(app)`.
- Shipping the same DSN in dev + prod without `environment` set — events mix in one project.
- Setting `Sentry.setUser({ email, phone })` — PII leaks. Use hash/UUID.

---

## Files this will touch in Phase 2 (updated)

- `backend_v2.js` — Passport Apple strategy, SIWA native verifier route, `DELETE /api/account` flow that calls Apple `/auth/revoke` + RC unsub, RC webhook handler (`POST /webhooks/revenuecat`), Play RTDN consumer or trust-via-RC, push token registration endpoint (`POST /api/push-token`), APNs + FCM sender, Sentry init file + Express error handler.
- `captains` schema additions: `apple_user_id`, `apple_refresh_token` (encrypted), `revenuecat_user_id`, `deleted_at`.
- New table `device_tokens` (user_id, platform, token, last_seen_at).
- `public/login.html` — Sign in with Apple button per HIG rules; placement at-least-as-prominent as Google.
- `public/account.html` — Delete Account button + Restore Purchases button.
- New: `capacitor.config.ts`, `ios/`, `android/` (created by `cap add`); `instrument.js` Sentry init file; `/delete-account.html` public web page.

## Verification status summary

| Section | Status |
|---|---|
| Capacitor core | [verified] except platform-detection JS [unverified, stable] |
| Capacitor plugins (9) | [verified] all 9 |
| RevenueCat | [verified] except getOfferings return shape [unverified] |
| Sign in with Apple | client API + Android-not-supported [verified]; backend JWT validation [unverified URL, standard pattern] |
| Apple HIG | [unverified] across the board (JS-rendered pages); values are long-stable |
| Review Guidelines | [verified] all sections |
| Google Play RTDN + Billing | [verified] |
| Google Play target API + Data Safety + Account deletion | [verify in Console] (support.google.com blocked) |
| APNs side | [verified] |
| FCM / Firebase Admin SDK | [unverified] (firebase.google.com blocked); stable surface |
| Sentry Capacitor | [verified — partial]; iOS/Android post-sync steps not extracted |
| Sentry Node + Express v8+ | [verified] |
