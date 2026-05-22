# Capacitor build notes — read before App Store / Play submission

## Locked payment decision: **Path B (App Store guideline 3.1.3(f))**

The iOS app is a **free companion to the akfishinfo.com web service**. It
contains **zero in-app purchases**, **zero subscribe buttons**, **zero
pricing**, and **zero calls to action for purchase** anywhere users can
reach. RevenueCat / StoreKit are NOT wired up and won't be.

Users buy on the web via Stripe; the iOS app honors their existing
subscription on sign-in. That dodges Apple's 15–30% cut entirely.

### What this means for any future iOS UI work

Anything that could be read as "go pay us" must be hidden on native.
We enforce this two ways:

1. **CSS** — `.web-only` / `.native-only` classes from
   `public/static/platform.css`. `<html data-native="1">` flips them.
2. **Server-side** — `isNativeRequest(req)` helper in `backend_v2.js`
   checks `X-Client: native-*` header AND the `akFISHinfo-Native`
   User-Agent suffix (`appendUserAgent` in `capacitor.config.json`).
   Routes that exist for paying-flow purposes hard-redirect to `/login`
   or `/setup` when the request is native:
     - `/signup`, `/pricing`, `/request-beta` → redirect
     - `/app` (no access) → `/setup` (not `/pricing`)
     - `POST /api/setup`, `/api/register`, `/api/billing/portal` → 403
       with a "manage on akfishinfo.com" error

### Phases of the original migration plan that are NOW SKIPPED

- **Phase 2.5 — RevenueCat IAP**: not implemented, not on the roadmap.
- **Phase 2.6 — "Save on web" external-link CTA**: not implemented.
  The whole external-link entitlement isn't needed because we don't
  link out for purchase at all.

The RevenueCat dashboard account exists but is unused. Safe to leave
or delete.

### Review-time copy audit checklist

Before every TestFlight submission, grep the bundled `public/` tree
for these terms and confirm each hit is either inside a `.web-only`
wrapper OR is informational (no purchase CTA):

```
grep -rn -iE "subscribe|/pricing|/signup|start.*trial|upgrade|stripe|buy|purchase" public/
```

Reviewers WILL test that the iOS app cannot reach a purchase flow.
A single un-gated "Subscribe" button = automatic rejection.

---



## ⚠️ `server.url` is set to production in `capacitor.config.json`

Current value:

```json
"server": { "url": "https://akfishinfo.com", ... }
```

This makes the iOS/Android WebView load the **live site over the network**
instead of the bundled `public/` assets. Useful during early development
because:

- Sign-in, OAuth, RevenueCat-less testing, etc. all "just work" — the app
  is essentially `akfishinfo.com` in a WKWebView.
- No CORS / cookie / cross-origin plumbing needed yet.

The tradeoff is that the **bundled** Phase 2.2 work (`platform.js`,
`platform.css`, `.web-only` / `.native-only` gating, the `X-Client`
header injection) is bypassed — the production HTML doesn't include
those files, so they never execute in this mode.

## Before any submission build — STRIP `server.url`

```diff
 "server": {
-  "url": "https://akfishinfo.com",
   "androidScheme": "https",
   "iosScheme": "capacitor",
   "allowNavigation": ["akfishinfo.com", "*.akfishinfo.com"]
 }
```

If you ship with `server.url`, Apple App Review will almost certainly
reject under guideline **4.2.2** ("web clipping / repackaged website").
Play Console accepts it but it's still a degraded UX (no offline fallback,
slow cold-launch).

## Removing it requires also wiring real cross-origin auth

When `server.url` is stripped, the WebView loads `capacitor://localhost`
on iOS and `https://localhost` on Android. Bundled JS then needs to:

1. Rewrite `/api/*` and `/auth/*` fetches to `https://akfishinfo.com/*`
   (extend the monkey-patch already in `public/static/platform.js`).
2. Pass `credentials: 'include'` on every cross-origin call.
3. Have `backend_v2.js` answer CORS preflight from `capacitor://localhost`
   with `Access-Control-Allow-Credentials: true`.
4. Have the session cookie set with `sameSite: 'none'; secure: true`
   when the request carries `X-Client: native-*`.
5. Replace the Google OAuth redirect-in-WebView flow with
   `@capacitor/browser` opening an external Safari (Phase 2.3 SIWA work
   covers this pattern).

That work is **Phase 2.3 / 2.4** in `docs/plans/app-store-migration/`.
Until then, leave `server.url` in for development convenience and accept
that the bundle's gating logic isn't exercised.

## Quick dev loop

```bash
# After editing capacitor.config.json or public/*:
npm run cap:sync:ios     # or cap:sync:android

# Open the native IDE:
npm run cap:open:ios
# then ⌘B + ▶ in Xcode
```
