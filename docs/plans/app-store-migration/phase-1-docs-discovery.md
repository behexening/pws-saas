# Phase 1 — Documentation Discovery

**Goal:** before writing any code, gather the exact APIs, signatures, and copy-ready patterns we'll use in Phase 2+. Output is an "Allowed APIs" consolidated doc.

**Why this phase exists:** the failure mode without it is inventing API methods that "should" exist, adding deprecated parameters, or following stale blog posts. Every Phase 2 task should reference a specific doc URL or example file.

## Delegation

Spawn subagents in parallel. Each subagent must report:

1. Sources consulted (URLs and exact sections/lines)
2. Concrete findings (exact API names + signatures)
3. Copy-ready snippet locations
4. Confidence note + known gaps

Reject reports that lack sources.

## Subagent 1 — Capacitor core

**Read:**
- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/ios
- https://capacitorjs.com/docs/android
- https://capacitorjs.com/docs/config

**Extract:**
- `npx @capacitor/cli init` flags
- `capacitor.config.ts` schema (esp. `webDir`, `server.url` for dev, `ios.contentInset`)
- `npx cap add ios` / `npx cap add android` behavior
- `npx cap sync` vs `npx cap copy`
- Platform detection from JS: `Capacitor.getPlatform()`, `Capacitor.isNativePlatform()`

## Subagent 2 — Capacitor plugins we need

**Plugins to research (read each plugin's README on capacitorjs.com/docs/apis/):**
- `@capacitor/push-notifications` — registration, token retrieval, listener events
- `@capacitor/geolocation` — permission flow (already in web app, confirm mobile parity)
- `@capacitor/preferences` — secure key-value storage for tokens
- `@capacitor/browser` — for OAuth flows (Google) that need an external browser
- `@capacitor/app` — deep link handling, app state events
- `@capacitor/share` — iOS share sheet
- `@capacitor/haptics` — feedback on key actions
- `@capacitor/status-bar` — color theming
- `@capacitor/splash-screen` — launch screen config

**For each:** install command, JS API surface, iOS Info.plist keys required, Android manifest entries required.

## Subagent 3 — RevenueCat

**Read:**
- https://www.revenuecat.com/docs/getting-started
- https://www.revenuecat.com/docs/web (for Stripe → RevenueCat sync option if useful)
- The `@revenuecat/purchases-capacitor` plugin docs

**Extract:**
- SDK init signature for iOS + Android
- Product/offering fetch flow
- Purchase flow with error handling
- Entitlement check API (the source of truth: "does this user have access right now?")
- Server-side webhook payload schema
- How to attribute a purchase to a specific user ID (Apple/Google account ≠ akFISHinfo user)
- Receipt restoration flow (required by Apple)

## Subagent 4 — Sign in with Apple

**Read:**
- https://developer.apple.com/sign-in-with-apple/get-started/
- App Store Review Guideline 4.8
- `passport-apple` npm package OR Apple's REST docs for server-side validation

**Extract:**
- Client-side: AuthenticationServices.framework flow via Capacitor plugin (likely `@capacitor-community/apple-sign-in`)
- Server-side: how to validate the identity token (JWT signed by Apple), where to fetch Apple's public keys
- The "name + email only sent on first sign-in" gotcha — must persist on first auth
- Token revocation endpoint (required for account deletion)

## Subagent 5 — Apple HIG (selective)

**Read targeted sections of https://developer.apple.com/design/human-interface-guidelines:**
- Foundations → Layout (safe areas, margins)
- Foundations → Typography (Dynamic Type, SF Pro)
- Foundations → Color (Dark Mode, semantic colors)
- Components → Navigation (tab bars vs nav bars vs sidebars)
- Components → Menus and actions (when hamburgers are OK vs not)
- Patterns → Launching (launch screen rules)
- Patterns → Onboarding
- App icons (1024×1024 master, no transparency, no rounded mask)

**Extract:** specific px/pt values, do/don't examples, the platform-specific rules that differ from generic web design.

## Subagent 6 — App Store Review Guidelines

**Read https://developer.apple.com/app-store/review/guidelines** and pull the exact text of:
- 2.1 (App Completeness)
- 2.3.10 (Accurate Metadata)
- 3.1.1 (In-App Purchase)
- 3.1.3 (Other Purchasing Methods — external links)
- 4.2 (Minimum Functionality)
- 4.8 (Sign in with Apple)
- 5.1.1 (Data Collection and Storage)
- 5.1.1(v) (Account Deletion)
- 5.4 (VPN Apps) — N/A but confirm
- Latest update on external link entitlement (StoreKit External Link Account Entitlement)

## Subagent 7 — Google Play

**Read:**
- https://support.google.com/googleplay/android-developer/answer/9859455 (Data Safety form)
- https://support.google.com/googleplay/android-developer/answer/9888379 (target API level requirements)
- Play Billing Library docs (if not fully abstracted by RevenueCat)
- Real-Time Developer Notifications (RTDN) for subscription events

## Subagent 8 — Push notification backend

**Read:**
- Apple Push Notification service docs (https://developer.apple.com/documentation/usernotifications)
- Firebase Cloud Messaging docs (Android)
- `node-apn` OR `@parse/node-apn` for APNs from Node
- Firebase Admin SDK for FCM from Node

**Extract:**
- p8 key generation (App Store Connect → Keys)
- Payload schemas for both platforms
- Token rotation / invalidation handling
- Silent push vs visible push

## Subagent 9 — Sentry

**Read:**
- https://docs.sentry.io/platforms/javascript/guides/capacitor/
- https://docs.sentry.io/platforms/node/

**Extract:** init signature for the Capacitor SDK (combined web + native), DSN setup, source map upload for production builds.

## Deliverable

A single consolidated doc at `docs/app-store-migration/allowed-apis.md` with:
- Each library/SDK section
- Exact install commands
- Exact API signatures we'll use
- Doc URL citations next to every API
- A short "Anti-patterns" list per section (methods that DON'T exist, deprecated params, things blog posts get wrong)

Phase 2 must not start until this doc exists and is reviewed.
