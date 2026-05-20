# Plan — Deckhand Seats (PRO-MAX) Feature

**Working name:** PRO-MAX / Deckhand Seats
**Gate:** Only available on the `season` plan ($240 early adopter / $400 standard)
**Scope:** Up to 3 temp users per season captain, each gets SMS alerts (core value) + a limited `/app` view. SMS to deckhands is non-negotiable — it's the whole product. Restrictions focus on the *map view*, not the alerts.
**Motivator:** Closes the value gap between $50 monthly and $240 season so the season plan actually sells

---

## Phase 0 — Documentation & Code Discovery (read before planning work)

Before writing a line of code, re-read these to anchor every decision in the real codebase:

1. **Schema & tiers** — [backend_v2.js:605-624](backend_v2.js#L605-L624) `captains` CREATE TABLE + [backend_v2.js:628-644](backend_v2.js#L628-L644) `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern. This is the ONLY safe migration pattern in this project.
2. **Access model** — [backend_v2.js:193-200](backend_v2.js#L193-L200) `hasAccess()`. Any new role must pass through this predicate.
3. **SMS fan-out** — [backend_v2.js:892-945](backend_v2.js#L892-L945) `alertProUsers(districts)`. Current query is scoped to `tier='pro' AND subscription_active=true AND sms_opted_in=true`. Deckhand expansion happens here.
4. **Consent capture** — [backend_v2.js:353](backend_v2.js#L353) `sms_opted_in = true, sms_opted_in_at = NOW()` — this is the TCPA trail. Every new SMS recipient needs their own row.
5. **Stripe webhook state transitions** — [backend_v2.js:996-1020](backend_v2.js#L996-L1020) — where `subscription_active` flips. Deckhand access must cascade off this.
6. **Captain-facing UI** — [public/account.html](public/account.html) (416 lines, single template) and [public/app.html](public/app.html) (1434 lines, single template). No build step — edit HTML/JS directly.
7. **PR policy** — [docs/pr-workflow.md](docs/pr-workflow.md). `backend_v2.js` changes go through PRs, not direct `main`.

**Confidence:** High — all above files verified present at referenced line ranges as of 2026-04-18.

---

## Phase 1 — Data Model

### Decision: separate `deckhands` table, NOT `parent_captain_id` on `captains`

Reasoning:
- Deckhands are fundamentally a *different kind of user*. They don't pay, don't own a subscription, can't invite others, and their access is lifecycle-bound to their captain. Overloading `captains` means every query (`hasAccess`, alertProUsers, /api/me, admin counts, billing reports) needs an `AND parent_captain_id IS NULL` filter. That's noise everywhere forever.
- Using a separate table means the default `SELECT ... FROM captains` continues to mean "paying subscribers" with no churn.
- Deckhands also need to auth (Passport session) — so they still need a row somewhere with an email/password/google_id. We solve that by giving them their own table with the minimum auth columns, mirrored.

### New table

```sql
CREATE TABLE IF NOT EXISTS deckhands (
  id SERIAL PRIMARY KEY,
  captain_id INT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  name VARCHAR(255),

  password_hash TEXT,
  google_id VARCHAR(255) UNIQUE,
  email_verified BOOLEAN DEFAULT false,
  email_verify_token TEXT,
  email_verify_expires TIMESTAMPTZ,

  invite_token TEXT UNIQUE,
  invite_expires TIMESTAMPTZ,
  invite_accepted_at TIMESTAMPTZ,

  -- Anti-sharing: phone uniqueness across all deckhands
  -- Separate UNIQUE INDEX rather than UNIQUE column, since phone_number is nullable before accept
  last_fingerprint TEXT,
  last_login_ip VARCHAR(45),
  distinct_fingerprints_7d INT DEFAULT 0,

  sms_opted_in BOOLEAN DEFAULT false,
  sms_opted_in_at TIMESTAMPTZ,
  alerts_enabled BOOLEAN DEFAULT true,

  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deckhands_captain ON deckhands(captain_id);
CREATE INDEX IF NOT EXISTS idx_deckhands_email ON deckhands(email);
CREATE INDEX IF NOT EXISTS idx_deckhands_invite ON deckhands(invite_token);
-- Anti-sharing: one phone can only be one deckhand. NULL allowed (pre-accept).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deckhands_phone_unique
  ON deckhands(phone_number) WHERE phone_number IS NOT NULL AND revoked_at IS NULL;
```

### Anti-sharing controls (summary — see Drawbacks §3 for rationale)

- **Phone uniqueness** — partial unique index above. Same phone can't be two deckhands.
- **Single active session** — on deckhand login, delete prior rows from `user_sessions` for that deckhand ID. New login kicks the old device.
- **Fingerprint logging** — capture on login, store latest + 7-day distinct count. Surface to captain via `/account` roster ("Mike logged in from 3 devices this week"). Detection, not enforcement.

### Session/auth unification

The existing Passport serializer expects a `captains` row. Two options:
- **(A) Polymorphic serializer:** `serializeUser({ kind: 'captain'|'deckhand', id })`. Deserializer reads from the right table.
- **(B) Mirror deckhand logins into `captains` with a `role='deckhand'` column.**

**Pick (A).** (B) reintroduces the "filter noise everywhere" problem. (A) is a single file change — `passport.serializeUser` / `deserializeUser` in [backend_v2.js](backend_v2.js).

### Add to `captains`

```sql
ALTER TABLE captains ADD COLUMN IF NOT EXISTS plan_slug TEXT;
-- 'biweekly' | 'monthly' | 'season' — needed so we can tell who is entitled to deckhand seats
```

Stripe webhook handler already gets the line item; extend it to write `plan_slug` alongside `subscription_active`.

### Verification checklist (Phase 1)

- [ ] `initDatabase()` runs cleanly against a staging Postgres without error
- [ ] `\d deckhands` in psql shows all columns
- [ ] Existing `captains`-scoped queries unchanged
- [ ] `SELECT * FROM captains WHERE plan_slug = 'season'` returns current season subscribers

---

## Phase 2 — Invite & Signup Flow

### Chosen flow: captain-issued magic link → email landing → set password (or Google) → SMS consent → done

1. Captain goes to `/account`, sees a "Deckhand seats (0/3)" card, clicks **Add deckhand**.
2. Captain enters deckhand's email + (optional) name.
3. Backend creates a `deckhands` row with `invite_token = randomBytes(24).toString('hex')`, `invite_expires = NOW() + 7 days`.
4. Backend emails the deckhand via Mailgun: "Captain {name} invited you to akFISHinfo. Accept: {BASE_URL}/deckhand/accept?token={invite_token}".
5. Deckhand clicks the link → [public/deckhand-accept.html](public/deckhand-accept.html) (new). Form: set password OR continue with Google, then capture phone + SMS opt-in checkbox (copy must be TCPA-compliant — see Phase 6).
6. `POST /api/deckhand/accept` validates token, sets password or links Google ID, stores phone + `sms_opted_in=true, sms_opted_in_at=NOW()`, sets `invite_accepted_at=NOW()`.
7. Redirect to `/app?view=deckhand`.

### Why email magic link, not SMS code?

- SMS codes cost money (Twilio) per invite. Email is free via Mailgun.
- Phone number capture can't happen pre-invite because the *captain* typing a deckhand's phone wrongly would block the real deckhand from ever opting in. Email first, let the deckhand enter their own phone.
- Mailgun + verification tokens are already wired up for email verification ([backend_v2.js:436](backend_v2.js#L436)) — reuse the pattern.

### Alternative considered: captain types deckhand's phone directly, SMS invite

Rejected. Captain-entered phone numbers are not self-opt-in for TCPA purposes. We'd need a confirmation SMS anyway. Email-first is cheaper and cleaner legally.

### Verification checklist (Phase 2)

- [ ] Invite email actually arrives (test with a real inbox)
- [ ] Accepting a valid token creates the session
- [ ] Expired/used tokens return 400
- [ ] Phone number normalizes to E.164 (reuse helper at [backend_v2.js:339-341](backend_v2.js#L339-L341))
- [ ] Deckhand cannot sign up for a deckhand account independently — only via invite token

---

## Phase 3 — Limited `/app` View

### Route: `/app` with `?view=deckhand` param OR detection from session kind

Pick **session-kind detection**: when `req.user.kind === 'deckhand'`, `/app` serves a stripped template. Query-param routing is spoofable and will leak the full view.

### What to HIDE for deckhands

Compared to the full captain view ([public/app.html](public/app.html)):

| Feature | Captain | Deckhand | Rationale |
|---|---|---|---|
| Live tab | ✅ | ✅ | Core value — current openings on the map |
| Old tab + date scrubber | ✅ | ❌ | Historical research is a "pro" depth feature. Removes biggest reason deckhand would skip getting their own subscription. |
| Interactive district map | ✅ | ✅ (read-only) | Deckhands need to see what's open |
| Open-area polygons | ✅ | ✅ | Same SMS-triggered info, just visual |
| Closure lines | ✅ | ❌ | Subtle regulatory detail — keep as captain-only |
| AWC buffer toggle | ✅ | ❌ | Power-user overlay |
| "Reparse" admin button | ✅ (admin only) | ❌ | Already gated |
| Account link | ✅ | ✅ (limited /account) | They need to manage their own phone/opt-out |
| Trial badge | ✅ | ❌ | N/A — they're not on trial |
| Announcement list (left panel) | ✅ full | ✅ current open only | Hide history entries; show only the active one |

### Implementation note

Do NOT clone `app.html` into a second file. Instead: serve the same template, and let a `window.__USER_KIND = '<%= kind %>'` (or a `/api/me` kind field) toggle `.deckhand-only` / `.captain-only` CSS classes. This keeps the map rendering code single-source; only the chrome hides/shows. The product-complexity drawback (§Drawbacks) is reduced but not eliminated by this approach.

### API surface for deckhands

- `GET /api/results/live` — allowed
- `GET /api/results/all` — **deny for deckhands** (return 403)
- `GET /api/result/:id/html` — allowed (the map data is in here; without it the live view is empty)
- `POST /api/result/:id/reparse` — deny (already admin-gated)
- `GET /api/me` — return `{ kind: 'deckhand', captain_name, captain_id, phone_number, ... }`

### Verification checklist (Phase 3)

- [ ] Log in as deckhand → `/app` loads → old tab button absent from DOM
- [ ] Manually hitting `/api/results/all` as deckhand returns 403
- [ ] AWC toggle control not rendered
- [ ] Captain logging in as themselves is unchanged (regression check)

---

## Phase 4 — SMS Alert Routing

Current flow: [backend_v2.js:892](backend_v2.js#L892) `alertProUsers(districts)` selects from `captains` only.

### Change

Extend the query to union in deckhands tied to active-season captains:

```sql
-- Captains (unchanged)
SELECT id, phone_number, name, 'captain' AS kind
FROM captains
WHERE tier = 'pro'
  AND subscription_active = true
  AND alerts_enabled = true
  AND sms_opted_in = true
  AND (regions && $1 OR regions = ARRAY['PWS'])

UNION ALL

-- Deckhands of active-season captains
SELECT d.id, d.phone_number, d.name, 'deckhand' AS kind
FROM deckhands d
JOIN captains c ON c.id = d.captain_id
WHERE c.subscription_active = true
  AND c.plan_slug = 'season'
  AND d.invite_accepted_at IS NOT NULL
  AND d.revoked_at IS NULL
  AND d.alerts_enabled = true
  AND d.sms_opted_in = true;
```

### Log table

Extend `sms_log` with a nullable `deckhand_id INT` column (via `ALTER TABLE ADD COLUMN IF NOT EXISTS`) and make `captain_id` nullable, so we can attribute sends to either. Alternative: keep `captain_id` pointing to the *owning* captain for deckhand sends — useful for billing questions ("why did this captain's plan trigger 4 SMS last week?").

**Pick the latter.** It keeps the per-captain audit trail intact and avoids a join to understand SMS volume.

### Verification checklist (Phase 4)

- [ ] Trigger a live announcement in staging with 1 captain + 1 accepted deckhand → both phones receive SMS
- [ ] Revoke the deckhand → only captain receives next alert
- [ ] Downgrade captain from season → monthly → deckhand gets NO alert
- [ ] `sms_log` rows for deckhand sends have the correct attribution

---

## Phase 5 — Captain Roster UI (/account changes)

In [public/account.html](public/account.html), add a new card only visible when `user.plan_slug === 'season'`:

```
┌─────────────────────────────────────────┐
│ Deckhand seats                 1 / 3    │
│                                         │
│ + Invite deckhand                       │
│                                         │
│ ── Current deckhands ──                 │
│ • mike@gmail.com  (accepted 4/18)  [×]  │
│ • pending: dan@gmail.com  [resend] [×]  │
└─────────────────────────────────────────┘
```

### New backend routes

- `GET  /api/deckhands` — list for current captain
- `POST /api/deckhands` — body `{ email, name? }`, creates row + sends invite email. Rejects if seat count ≥ 3 or caller's plan isn't season.
- `POST /api/deckhands/:id/resend` — regenerates token, re-sends email
- `DELETE /api/deckhands/:id` — sets `revoked_at`, kills session if deckhand is logged in

### Edge cases to handle up front

- Email already belongs to an existing captain → reject with a clear error ("This email has their own akFISHinfo account")
- Email already belongs to another captain's deckhand → reject ("Already invited by another captain")
- Captain tries to invite themselves → reject

### Verification checklist (Phase 5)

- [ ] Monthly plan user does NOT see the deckhand card
- [ ] Season plan user sees 0/3 on first load
- [ ] Inviting 4th deckhand returns 400 with a user-friendly error
- [ ] Revoking a logged-in deckhand kicks them out within 1 request

---

## Phase 6 — Billing / Stripe Lifecycle

### Seat enforcement

Enforced at API-write time, not schema-time. The `POST /api/deckhands` handler:
```js
if (req.user.plan_slug !== 'season') return res.status(403).json({ error: 'Deckhand seats are included with the Season plan only.' });
const { rows } = await db.query('SELECT COUNT(*) FROM deckhands WHERE captain_id = $1 AND revoked_at IS NULL', [req.user.id]);
if (parseInt(rows[0].count, 10) >= 3) return res.status(400).json({ error: 'You've used all 3 deckhand seats. Revoke one to add another.' });
```

### Cascade when captain downgrades / lapses

The Stripe webhook at [backend_v2.js:996-1020](backend_v2.js#L996-L1020) handles `customer.subscription.updated` / `deleted`. Extend:

```js
// On any event that leaves captain without plan_slug='season' or subscription_active=false:
if (newPlanSlug !== 'season' || !subscription_active) {
  // Soft-revoke deckhands — flip alerts_enabled to false, null out invite_token.
  // Do NOT delete rows: captain may re-upgrade and re-activate same crew.
  await db.query(
    `UPDATE deckhands SET alerts_enabled = false, updated_at = NOW()
     WHERE captain_id = $1 AND revoked_at IS NULL`,
    [captainId]
  );
}
```

When a captain re-upgrades to season, provide a `POST /api/deckhands/:id/reactivate` (or do it automatically via the webhook). Auto-reactivation risks TCPA if the deckhand opted out in the interim — so require manual reactivation from the captain.

### Pricing page copy

Already updated in this session — the season plan card shows "includes up to 3 deckhand seats" ([public/pricing.html](public/pricing.html)).

### Verification checklist (Phase 6)

- [ ] In Stripe test mode, cancel a season sub → deckhands stop receiving SMS on next announcement
- [ ] Re-subscribe same captain to season → deckhands do NOT auto-resume alerts (by design)
- [ ] Downgrade season → monthly → season roster card disappears from /account

---

## Phase 7 — Final Verification

- [ ] End-to-end: new season signup → invite → deckhand accepts → alert fires → both get SMS
- [ ] Grep for `tier === 'pro'` and `subscription_active` across backend_v2.js — confirm no access path accidentally lets deckhands through `hasAccess()`
- [ ] Grep for any cloned `app.html` files — there should be exactly one
- [ ] Playwright / manual: captain login shows full UI, deckhand login shows limited UI, no CSS leak
- [ ] Twilio console: the test account shows double sends per announcement when a deckhand is attached

---

# 🚨 Drawbacks & Pitfalls — Read this before committing to the feature

These are real, not hypothetical. Several of them are reasons to NOT build this, or to build a smaller version first.

### 1. Support burden scales up 4x per paying account

One captain on the season plan can generate support tickets for themselves + up to 3 deckhands. The deckhands can't pay and can't self-serve billing, but they CAN hit you with "why didn't I get an alert," "I lost my phone," "captain fired me please transfer my account," "I want to upgrade to my own captain plan." You're providing 4 users of support per 1 user of revenue. For a solo founder this is the single biggest cost.

**Mitigation:** Very explicit in-app copy that deckhands get support *through their captain*. No direct support email for deckhand accounts.

### 2. Twilio cost multiplier — the math can flip a profitable plan into loss

Current per-announcement cost = `num_pro_captains × $0.0079` (US SMS). With 3 deckhands per captain, worst-case cost per announcement = `4 × num_season_captains × $0.0079` — a 4x multiplier on the subset of users paying for the *discounted* season plan.

**Quick numbers:** PWS season = ~120 days, ~5 announcements/day peak = ~600 announcements/season. One season captain at $240 = ~$0.40/announcement budget. With 3 deckhands = $0.032 Twilio cost per announcement = ~8% of revenue. Sounds fine UNTIL a deckhand's number is a landline / VOIP / international and fails/retries, or Twilio pricing changes, or a burst of announcements hits. You're spending early-adopter-discounted revenue on what is effectively a marketing feature.

**Mitigation:** Hard-cap deckhand alert volume per day (e.g., 10 SMS/day/deckhand), and add a kill-switch env var `DECKHAND_SMS_ENABLED`.

### 3. Privacy / abuse: captains will resell access as "deckhands"

Three extra SMS-receiving accounts for $240 = $60/user/season — cheaper than the $50/mo plan for anyone fishing >4 months. **This is a reseller arbitrage on paper.**

**The strongest mitigation is the fishery itself, not code.** PWS is a limited-access salmon fishery — the total catch is fixed and split across the boats that show up. Every person a captain shares alerts with is another boat that could race them to the best spot. The economic incentive to hoard intel is built into the business. This is probably enough for 90% of captains. Budget your anti-abuse engineering accordingly.

**Technical mitigations, in order of effort-to-value:**

- **Phone number uniqueness (cheap, high value).** `UNIQUE` constraint on `deckhands.phone_number` across the whole table. A shared login with a different phone can't receive the SMS, which is what the seat is *for*. A shared login re-using one phone means only that phone gets alerts — not actually abuse at scale.
- **One active session per deckhand (cheap, medium value).** On login, invalidate the deckhand's prior session in `user_sessions`. Casual sharing ("send me the login, I'll check too") becomes an annoying game of musical chairs — each new login boots the previous one. Already easy to implement with `connect-pg-simple` + a small query.
- **Device fingerprint logging (medium effort, detection only).** FingerprintJS or a self-hashed `userAgent + screen + timezone + language`. Log per-login in a `deckhand_sessions_audit` table. Don't block on it — just flag: "4 distinct fingerprints in 7 days for this deckhand." Surface it to the captain ("your deckhand logged in from multiple devices") so *they* police it.
- **Terms-of-service language.** Cheap, enforces nothing, but necessary for any future takedown.
- **Hard device-binding via native mobile attestation** (iOS DeviceCheck / Android Play Integrity) — don't build this. Requires a native app, which you don't have and shouldn't build just for this.

Skip attempts to verify "real crew" relationships. You cannot. Any gate you add (crew affiliation code, employment attestation) will get gamed and frustrate legitimate customers.

### 4. Orphaned accounts when captains lapse

When a captain cancels, 3 deckhands now have dormant accounts with their phone numbers, PII, login credentials, and TCPA consent records sitting in your DB. GDPR/CCPA implications if any are non-Alaskans. You also need to decide: do they get a "your captain lapsed" email? Can they subscribe themselves and keep their login? If not, why did you collect their email?

**Mitigation:** Automatic soft-delete after 90 days of deckhand-inactive + captain-lapsed. Build a proper deckhand → captain upgrade path so an orphaned deckhand can convert to a paying user rather than be a sunk DB row.

### 5. TCPA compliance is NOT automatic from captain consent

The captain consenting to SMS is **not** consent on behalf of the deckhand. Each deckhand is a separate "called party" under TCPA — they personally must give express written consent. The statutory damages are $500–$1,500 per unconsented message. **One unhappy deckhand who didn't realize they consented to marketing-adjacent SMS is a class-action vector.**

**Non-negotiable requirements:**
- Deckhand, not captain, must check the SMS opt-in checkbox during accept-invite flow.
- Store `sms_opted_in_at` timestamp + IP + user-agent per deckhand (add those columns now).
- STOP / HELP keyword handling must work per-phone (already exists for captains — verify it doesn't break when the number belongs to a deckhand).
- Consider whether transactional-vs-marketing classification changes anything. The openings SMS is arguably transactional; any future "upgrade to your own plan" nudge is marketing and needs separate consent.

**If you don't get this right, the feature is a liability, not an asset.** Have an attorney review the opt-in copy before launch. (See `legal-advisor.skill` in the repo root — user already has a legal review workflow.)

### 6. Scope creep — deckhands will ask for "just one more feature"

The stripped `/app` view will be universally annoying to people who use it every day. Requests you will get within a month:
- "Can deckhands see the old tab?"
- "Can deckhands get the reparse button?"
- "Can I add a 4th deckhand?"
- "Can deckhands have their own saved regions?"
- "Can deckhands export data?"

Each yes erodes the reason to buy your own plan. Each no is a support ticket.

**Mitigation:** Write down the feature boundary NOW, pin it as a rule: **"Deckhand view changes require either $X/month upcharge OR promotion to captain."** Commit to that rule before the first feature request lands.

### 7. Product complexity cost — the worst one

Every new feature you build in `/app` now has a 2-up matrix: does captain see it? does deckhand see it? What if they're both viewing the same announcement and the captain revokes the deckhand mid-session? What if a deckhand's captain changes plan mid-season? Your test surface just doubled.

**Every touch of `app.html` from here on pays this tax.** For a 1434-line single-template file with no build step and no component boundaries, this is expensive. The mitigation of "use CSS classes not a forked template" (Phase 3) helps, but doesn't eliminate it — backend access checks still need a kind-aware branch everywhere.

**Concrete cost estimate:** every new `/app` feature will take ~20-30% longer because of the two-view matrix. Multiply that by your planned roadmap for a gut-check on whether the added revenue from season-plan conversions is worth it.

### 8. Conversion risk — this cannibalizes monthly plan sales

The season plan is $240 early / $400 standard. The monthly plan is $50 early / $84 standard. Break-even between them is 4.8 months (early) or 4.76 months (standard). PWS season is roughly 4–5 months. That means the *monthly plan is already priced worse than season for almost everyone who fishes a real season*. Adding deckhand value to the season plan widens that gap — good if you want season to win, but **bad if you were hoping to make steady monthly revenue from casual/occasional users who start with monthly and upgrade.**

Ask yourself: is your goal max ARPU per season (build this feature) or max total captain count including dabblers (don't build this, or attach deckhands to monthly too)?

---

## Alternative: Don't Build This Yet

A defensible v0 that gets 80% of the sales incentive with 10% of the risk:

- Still price the season plan at $240 with the "up to 3 deckhands" copy
- **Don't actually ship the feature on day one** — let it be "coming soon for Season subscribers, included free when launched"
- Measure: of the early adopters, how many pick Season vs Monthly? If Season wins >40% on positioning alone, never build deckhands — the marketing did the work
- If Season loses, THEN build the feature with a clearer sense of what deckhands would actually value

This avoids burning engineering + compliance + support cost on a feature whose only job is to make a price card look better.

---

## Suggested sequencing if you proceed

1. **Week 1:** Phase 1 (schema) + Phase 6 (plan_slug on captains) — these are no-UI, no-risk, and they unlock everything else. Ship as a single PR.
2. **Week 2:** Phase 2 + Phase 5 (invite flow + roster UI). No SMS code yet — deckhands just *exist* and get an email.
3. **Week 3:** Phase 3 (limited /app view). Deckhands can now log in and see the map. Still no SMS.
4. **Week 4:** Phase 4 (SMS routing) + Phase 7 (verification). Turn on `DECKHAND_SMS_ENABLED=true` only after Twilio cost modeling.
5. **Ongoing:** monitor support volume & Twilio bill weekly for the first month. Be prepared to kill-switch.
