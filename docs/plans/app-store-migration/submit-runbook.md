# Submit Runbook — akFISHinfo v1.0 (iOS)

Concrete admin checklist for getting the iOS build into App Review. Do top-down; each step is a prerequisite for the next.

## Step 1 — App Store Connect paperwork (no waiting on anyone)

Open ASC → My Apps → akFISHinfo.

### App Information
- **Category — Primary:** `Business` *(not Sports — this is a commercial trade tool, not a recreational fishing app)*
- **Category — Secondary:** `Weather` *(tides + weather strip + Miles Lake sonar)* — alternative: `Navigation` if you'd rather lean on the map
- **Primary Language:** English (U.S.)
- **License Agreement:** Apple Standard EULA (leave default)

### Pricing & Availability
- Free
- All territories (or narrow to United States if you want to limit support load on v1.0)

### App Privacy → Data Types
See §7.0.2 in [phase-7-submit.md](phase-7-submit.md) for the table. Summary:
- Email, Name, User ID, Phone, Device ID (push token), Purchase history — all **Linked**, purpose **App Functionality**
- Coarse location (boundary alerts) — **Not Linked** (on-device only, never transmitted)
- Crash data (Sentry) — **Not Linked**
- **Tracking: None.** Do not check any tracking box.

### App Review → Sign-In Information
- Username: `apple-review@akfishinfo.com`
- Password: *(the one you set in Step 2 below)*

### App Review → Notes
Paste:
```
PWS = Prince William Sound, Alaska. akFISHinfo is a commercial fishing
information tool that surfaces ADF&G salmon-opening announcements
in real time. It is region-specific to commercial PWS salmon
operators.

The app is a free companion to akfishinfo.com. There are no in-app
purchases — subscriptions are created and managed on the web at
akfishinfo.com (Apple 3.1.3(f) Path B).

After signing in with the demo account, the Account page exposes a
"Reviewer Tools" card with "Send test push" — use this to verify
push delivery without waiting for an ADF&G announcement.

Account deletion is at Account → Delete Account (Apple 5.1.1(v)).
```

## Step 2 — Create the reviewer captain on prod

Prerequisite for Step 1's Sign-In Information.

```bash
# Get the prod DB public URL
PUB_URL=$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)

# Pick a strong password — paste it into ASC and store it in 1Password
REVIEWER_PW='PickAStrongPassword!'

node -e "
const { Client } = require('pg');
const crypto = require('crypto');
const PW = process.argv[2];
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(PW, salt, 64).toString('hex');
const stored = salt.toString('hex') + ':' + hash;
(async () => {
  const c = new Client({ connectionString: process.argv[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(\`
    INSERT INTO captains (email, name, password_hash, email_verified)
    VALUES ('apple-review@akfishinfo.com','Apple Review',\$1,true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash, email_verified = true
  \`, [stored]);
  console.log('reviewer ready');
  await c.end();
})();
" \"$PUB_URL\" \"$REVIEWER_PW\"
```

The reviewer email is in `REVIEWER_EMAILS` env (or in the default list in `backend_v2.js`), so `hasAccess()` grants full access and they skip the /setup phone gate.

## Step 3 — Listing copy

Paste into ASC. **Do not mention prices** anywhere — Apple rejects.

- **App name:** `akFISHinfo`
- **Subtitle** (30 char): `Prince William Sound Openers`
- **Promotional text** (170 char): `Real-time push the moment ADF&G opens a PWS commercial salmon period. Live map, district cards, tides & weather, Miles Lake sonar.`
- **Keywords** (100 char): `fishing,salmon,alaska,prince william sound,opener,adfg,commercial fishing,cordova,valdez`
- **Support URL:** `https://akfishinfo.com/about`
- **Marketing URL:** `https://akfishinfo.com`
- **Privacy Policy URL:** `https://akfishinfo.com/privacy`
- **Description** (4000 char): adapt the hero + features from `about.html`. Lead with "alerts the moment ADF&G opens a PWS commercial salmon period." Mention native push, Sign in with Apple, offline tile cache, live Miles Lake sonar. **Omit pricing entirely.**

## Step 4 — Build, archive, upload to TestFlight

You don't have a real-device test until you do this. **Real-device testing happens via TestFlight, not before it.**

1. Xcode → akFISHinfo target → General → Identity:
   - `CFBundleShortVersionString` = `1.0.0`
   - `CFBundleVersion` = `1`
2. Verify Signing & Capabilities → Team selected, "Automatically manage signing" on.
3. Connect any iPhone or use "Any iOS Device (arm64)" as the destination.
4. Product → Archive. Wait for compile (~5 min).
5. Window → Organizer → select the new archive → Distribute App → App Store Connect → Upload.
6. Wait for ASC to finish processing (5–30 min — you get an email when ready).

## Step 5 — Real-device testing via TestFlight

1. ASC → TestFlight → add your own Apple ID as an Internal Tester (no review required for internal).
2. Install **TestFlight** from the App Store on your iPhone.
3. Open TestFlight on your phone → accept invite → install akFISHinfo.
4. Walk the test matrix from §7.2 in [phase-7-submit.md](phase-7-submit.md). At minimum:
   - Sign in with Apple → lands on /app
   - Live tab cards show only currently-open districts (per-block filter)
   - Upcoming tab shows future-only blocks
   - Tap a card → map focuses
   - Account → Delete Account → second confirm → typed `DELETE` → signed out
   - Account → Reviewer Tools → Send test push → push arrives on this device
   - Push tap → opens the relevant announcement (deep link)
   - Conditions pill → tap → modal opens with tides + weather
   - Map ⓘ → attribution modal
5. **Capture screenshots as you go** — these become App Store screenshots. Use iPhone 15 Pro Max if you have one (1290×2796); otherwise the iPhone you have is fine and Apple will accept smaller. Five frames minimum.

## Step 6 — Upload screenshots + fill remaining ASC fields

ASC → 1.0 Prepare for Submission:
1. App Previews and Screenshots → upload the 5 frames from Step 5.
2. Description (from Step 3).
3. Promotional Text.
4. Keywords.
5. Support URL, Marketing URL.
6. App Review Information (already done in Step 1).
7. Version Information → What's New: `Initial release.`
8. Build → select the build that finished processing in Step 4.

## Step 7 — Submit for Review

- ASC → top right → "Add for Review" → "Submit for Review".
- Export Compliance: "uses encryption" → "exempt (HTTPS only)" → no ERN.
- Advertising Identifier (IDFA): No.

Apple's median first-review time is ~24h. Expect 0–2 rejections; each round-trip is 1–3 days. Most common rejections for this app shape:
- Missing screenshot for some required size (only 6.7" is required, but they sometimes ping for iPad if Universal target).
- Reviewer can't log in (Step 2 password mismatch — re-check).
- "App appears to be a webview" — reviewer notes from Step 1 address this; if rejected, point at: push notifications, Sign in with Apple, deep links / Universal Links, share sheet, offline tile cache.

## Phase 6 items deferred until after first submission
- Real branded icon (designer's queue — drop in for 1.0.1 or expedite if landed before review starts)
- Google Play submission (separate flow)
- Fastlane/Xcode Cloud automation (manual archive is fine for v1.0)
- App Store / Play badges on `index.html` marketing site (need the live App Store URL)
