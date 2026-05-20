# Phase 3 — Apple HIG Compliance Pass

**Goal:** the app reads as native on iOS. Not a website inside a chrome-less browser.

**Prereq:** Phase 2 shippable on TestFlight. Phase 1's HIG subagent (Subagent 5) report on hand.

**Anti-patterns:**
- Applying HIG rules globally (web should not become iOS-styled). Use Capacitor platform detection to scope.
- Hamburger menus as primary nav on iOS (HIG strongly discourages).
- Splash screens with text or version info (HIG 8.5: plain branding only).
- App icon with transparency, padding, or pre-rounded corners (Apple applies the mask).

## 3.1 Safe area insets

**Tasks:**
1. Add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` to every HTML file in `public/`.
2. Add CSS using `env(safe-area-inset-top/bottom/left/right)` to:
   - Top bar in `app.html`
   - Sticky CTAs / bottom action bars
   - Any modals or sheets
3. Test on iPhone with notch + Dynamic Island + home indicator (iPhone 15) AND on iPhone SE (no notch).

## 3.2 Native navigation pattern

The current mobile topbar (per commit `aa9bcc0`) collapses to tabs + hamburger. On iOS, this should become a true bottom tab bar.

**Tasks:**
1. Create a bottom tab bar component, applied only when `IS_NATIVE && platform === 'ios'`.
2. Tabs: 3-5 max. Likely: **Openers / Map / Alerts / Account**.
3. Use SF Symbols for icons via inline SVG copies (Apple permits use of SF Symbols in apps, not on web).
4. Match HIG sizing: 49pt tab bar height (plus safe area), 25pt icons, 10pt SF Pro label below.
5. Android keeps the existing pattern OR adopts a Material 3 bottom nav — defer Android-specific design to Phase 3.5.

## 3.3 Dynamic Type

**Tasks:**
1. Convert all font sizes in `public/css/*` from `px` to `rem`.
2. Set root font size to respect `-apple-system-body` text style via CSS:
   ```css
   html { font: -apple-system-body; font-size: 1rem; }
   ```
3. Test by toggling iOS Settings → Display & Brightness → Text Size to largest. Confirm nothing clips or overflows.

## 3.4 Dark Mode

**Tasks:**
1. Audit current CSS; extract colors to CSS custom properties.
2. Add `@media (prefers-color-scheme: dark)` block that redefines the custom properties.
3. Test every screen in both modes including the map (Leaflet tiles may need a dark variant).
4. Status bar color via `@capacitor/status-bar`: set `Style.Dark` or `Style.Light` to match.

## 3.5 Sharp corners decision

The existing global rule (`feedback_sharp_corners.md`) is sharp corners on cards/buttons/panels. **HIG actively prefers rounded corners on iOS** (typically 10pt for cards, smaller for buttons).

**Decision needed from user before this task:** apply rounded corners on iOS only via a `.ios-rounded` class gated on platform detection, OR keep sharp everywhere.

If "rounded on iOS":
1. Add `body.platform-ios .card, body.platform-ios button { border-radius: 10px; }`
2. Apply `body.platform-ios` class early in app boot.

If "sharp everywhere": skip and document the brand choice in the App Store reviewer notes ("intentional brand aesthetic").

## 3.6 Haptics

Subtle, not constant.

**Tasks:**
1. `Haptics.impact({ style: ImpactStyle.Light })` on primary action button taps.
2. `Haptics.notification({ type: NotificationType.Success })` on subscription success.
3. `Haptics.notification({ type: NotificationType.Warning })` on errors that block the user.

## 3.7 Launch screen

**Tasks:**
1. iOS: configure `LaunchScreen.storyboard` in Xcode — solid brand color background, centered logo at 200pt square. No text.
2. Android: drawable in `android/app/src/main/res/drawable/splash.xml` — same visual.
3. Configure `@capacitor/splash-screen`: `launchAutoHide: false`, hide manually after app boot completes so there's no flash of empty webview.

## 3.8 App icon

**Tasks:**
1. Design or commission a 1024×1024 PNG master.
2. No transparency, no rounded corners (Apple masks).
3. Run through an icon generator (e.g., `capacitor-assets`) to produce all required sizes.
4. Verify on home screen, settings, spotlight search — all sizes look correct.

## 3.9 Onboarding screens

The existing `setup.html` is functional but doesn't match the "swipeable intro" first-run experience iOS users expect.

**Tasks:**
1. Add 3 onboarding cards shown only on first launch of the native app:
   - Card 1: "Real-time openers for Prince William Sound" + map screenshot
   - Card 2: "Get notified the moment ADF&G announces" + push notification mock
   - Card 3: "Start your free trial" + CTA
2. Persist `onboarding_complete: true` in `@capacitor/preferences` after the user advances past card 3.
3. Web is unchanged.

## 3.10 Accessibility (VoiceOver)

**Tasks:**
1. Every interactive element has either text content or `aria-label`.
2. Map markers have accessible labels (opener name, status).
3. Test with VoiceOver enabled on iOS — every screen should be navigable left/right with swipes.
4. Color contrast: minimum 4.5:1 for body text per WCAG AA.

## Verification

Side-by-side screenshots: current build vs HIG sample apps (Mail, Calendar, Weather). Each screen should feel like it belongs on the same device.

Run the iOS build on:
- iPhone 15 Pro Max (large, notch + Dynamic Island)
- iPhone SE 3rd gen (small, home button)
- iPad (10th gen) — at minimum verify it doesn't crash, even if not optimized

Take screenshots for App Store listing while doing this — kills two birds.
