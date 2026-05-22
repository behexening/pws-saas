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

## ✅ `server.url` is REMOVED — bundled assets only

The iOS / Android WebViews load HTML, JS, and CSS from the bundled
`public/` directory at the local Capacitor origin
(`capacitor://localhost` on iOS, `https://localhost` on Android via
`androidScheme: "https"`). The cross-origin plumbing that lets the
bundled JS talk to the production backend at `akfishinfo.com`:

1. **`public/static/platform.js`** monkey-patches `fetch` + `XHR` to:
   - Rewrite same-origin paths under `/api`, `/auth`, `/webhooks`,
     `/health`, `/verify-email`, `/results`, `/awc-points.json` to
     `https://akfishinfo.com/<path>`
   - Force `credentials: 'include'` (so the session cookie travels)
   - Add `X-Client: native-(ios|android)` header
   - Absolute URLs to other origins (unpkg, Sentry CDN, Apple JWKS,
     etc.) are left alone

2. **`backend_v2.js` CORS middleware** (right after Helmet) allows
   `Origin: capacitor://localhost`, `https://localhost`,
   `http://localhost` with `Access-Control-Allow-Credentials: true`
   and handles `OPTIONS` preflights. Web users are same-origin, so the
   middleware is a no-op for them.

3. **Session cookie** is set `SameSite=None; Secure; HttpOnly` in
   production (BASE_URL https). `SameSite=None` is REQUIRED for the
   WebView to send the cookie on cross-origin fetches; `Secure` is
   browser-mandatory whenever `SameSite=None` is used. In local dev
   (http BASE_URL) we fall back to `SameSite=Lax; Secure=false` so
   plain `http://localhost` development still works.

4. **Helmet CSP** is widened to allow the cross-origin connections:
   - `connect-src` includes `https://akfishinfo.com`,
     `https://*.ingest.us.sentry.io`, `https://*.sentry.io`
   - `script-src` includes `https://js.sentry-cdn.com`,
     `https://browser.sentry-cdn.com` for the Sentry Loader Script

### Putting it back temporarily for debugging

If you ever need to point the WebView at production directly (e.g. to
debug a deploy without rebuilding the app), add `server.url` back:

```json
"server": {
  "url": "https://akfishinfo.com",
  "androidScheme": "https",
  ...
}
```

DO NOT ship to App Store / Play in that state. Apple Guideline 4.2.2
("web clipping / repackaged website") is the bright-line rejection.

## Known limitation — Google OAuth on native

Google OAuth (`/auth/google`) is still a server redirect-based flow.
When the user taps the Google button on the bundled `/login` page, the
WebView navigates to `accounts.google.com`, then to
`https://akfishinfo.com/auth/google/callback`, and stays on
akfishinfo.com after sign-in. They keep their session but they're now
running the web HTML instead of the bundle. Cosmetic only; everything
still works.

Fixing this needs `@capacitor/browser` to open an in-app Safari for
the OAuth flow plus a deep-link back into the bundle. Defer until
real users complain.

Sign in with Apple uses the native plugin (no redirect, no WebView
navigation) so it stays inside the bundle the whole time.

## Quick dev loop

```bash
# After editing public/* or backend_v2.js:
npm run cap:sync:ios     # or cap:sync:android

# Open the native IDE:
npm run cap:open:ios
# then ⌘B + ▶ in Xcode
```
