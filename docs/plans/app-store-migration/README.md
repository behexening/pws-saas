# App Store Migration Plan — akFISHinfo

Plan for shipping akFISHinfo to the iOS App Store and Google Play alongside the existing web app.

## Locked decisions

| Decision | Choice |
|---|---|
| Wrapper | **Capacitor** (not React Native, not native rewrite) |
| Telegram | **Removed from mobile entirely.** Web-only legacy channel. |
| In-app payments | **RevenueCat** for IAP (iOS StoreKit 2 + Google Play Billing) |
| Web payments | **Stripe stays.** Web checkout offers ~15% discount vs IAP. |
| External-link entitlement | Apply for it. Show "Save on web" CTA in US/EU only at launch. |
| Auth | Google OAuth (existing) + **Sign in with Apple** (required by Apple when offering 3rd-party login) |
| Notifications | APNs + FCM via `@capacitor/push-notifications` |
| Crash reporting | Sentry (both platforms) |

## Phase index

- [Phase 0 — Strategic decisions doc](phase-0-decisions.md) *(this file's table is the summary)*
- [Phase 1 — Documentation discovery](phase-1-docs-discovery.md)
- [Phase 2 — Foundation: wrapper, auth, push, IAP](phase-2-foundation.md)
- [Phase 3 — Apple HIG compliance pass](phase-3-hig-pass.md)
- [Phase 4 — Privacy, legal, store-required surfaces](phase-4-privacy-legal.md)
- [Phase 5 — Feature polish](phase-5-polish.md)
- [Phase 6 — Things easy to forget](phase-6-easy-to-forget.md)
- [Phase 7 — Verification & submission](phase-7-submit.md)
- [Risk register](risks.md)

## How to use this plan

Each phase is self-contained — a future session should be able to pick up any phase file and execute it without re-reading the others, given access to `backend_v2.js` and `public/`. Phase 1 must run before Phase 2. Phases 3–6 can run in parallel after Phase 2 is shippable.

Phase 0 is already done (decisions above). Start with Phase 1.
