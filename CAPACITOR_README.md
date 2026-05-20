# Capacitor build notes — read before App Store / Play submission

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
