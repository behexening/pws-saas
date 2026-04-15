# Plan: Privacy Policy & Terms of Service

**Goal:** Create `/privacy` and `/terms` pages for akFISHinfo that are honest, legally protective, and don't undermine the product's value proposition.

**Critical context:** The existing disclaimer says "verify with ADF&G before fishing." But the product promise is "know before you go" — meaning fishermen *will* act on these alerts. The ToS must acknowledge this honestly, limit liability appropriately, and avoid language that would make the tool sound useless (which would be dishonest and bad for business).

> **IMPORTANT:** These pages must be reviewed by an actual attorney before the service goes live to paying customers. This plan produces a solid first draft with the right structure and flagged issues — not a final legal document.

---

## Phase 0: What the system actually does (facts for the attorney and for the docs)

### Data collected
| Data | Where stored | Why |
|------|-------------|-----|
| Email | `captains.email` (Postgres/Railway) | Auth, verification emails |
| Name | `captains.name` | Display, greeting |
| Password hash | `captains.password_hash` (scrypt) | Auth — plaintext never stored |
| Google ID | `captains.google_id` | OAuth login |
| Phone number | `captains.phone_number` | SMS alert delivery |
| Subscription tier / status | `captains.tier`, `subscription_active` | Access control |
| Trial dates | `captains.trial_ends_at` | Trial expiry |
| Stripe customer/subscription IDs | `captains.stripe_customer_id`, `stripe_subscription_id` | Payment management |
| Session cookies | `user_sessions` table | Stay-signed-in |
| SMS delivery log | `sms_log` | Audit trail (phone, message, timestamp) |

**Not stored:** Credit card numbers (Stripe handles card data entirely — we only store the Stripe customer/subscription ID).

### Third-party processors
| Service | What we share | Purpose |
|---------|--------------|---------|
| **Stripe** | Name, email, Stripe handles card data directly | Subscription billing |
| **Twilio** | Phone number, alert message text | SMS delivery |
| **Mailgun** | Email address | Verification emails + inbound PDF receipt |
| **Google** | Email, name (via OAuth) | Sign-in |
| **Anthropic** | PDF text content from ADF&G announcements | AI parsing of opening announcements |
| **Railway** | All server-side data (hosting provider) | Infrastructure |
| **CARTO / OpenStreetMap** | IP address (map tile requests) | Map display |

### What the system DOES NOT guarantee
- Real-time delivery (SMS can be delayed by Twilio, carrier, or service outage)
- Parsing accuracy (Claude can misread ambiguous PDF announcements)
- Complete coverage (ADF&G must email the monitored inbox — missed emails = missed alerts)
- Regulatory advice (ADF&G regulations are complex and change; the tool parses what the announcement says, not what the law requires)

---

## Phase 1: Terms of Service — content requirements

### 1.1 The core liability problem (read this before writing)

The tension: The tool's value is that fishermen act on the alerts. A disclaimer that says "don't rely on this for fishing decisions" would be:
1. Dishonest — the product is literally designed for that
2. Unenforceable — courts are skeptical of disclaimers that contradict the product's stated purpose

**The right approach:** Limit liability for *specific failure modes* rather than disclaiming the entire use case. Fishermen can reasonably rely on the alert; they cannot hold akFISHinfo liable for system failures (delayed SMS, parsing errors, missed emails from ADF&G, carrier outages) or for ADF&G issuing last-minute amendments after an announcement.

This is similar to how weather apps work: you rely on the forecast, but the app isn't liable when the forecast is wrong.

### 1.2 Required ToS sections

**1. Acceptance of Terms**
- By using the service, user agrees to these terms
- Must be 18+ or have a commercial fishing permit (targeting commercial operators)
- Terms may be updated; continued use = acceptance

**2. Description of Service**
- akFISHinfo monitors ADF&G communications and delivers alerts to subscribers
- The service is an information delivery tool, not an authoritative source of fishing regulations
- Alerts are derived from official ADF&G communications — we do not generate or modify regulatory information

**3. Subscription and Payment**
- $15/month, billed via Stripe
- 7-day free trial (one per phone number)
- Auto-renews monthly until canceled
- Cancel any time — access continues through the end of the paid period
- No refunds for partial billing periods (standard SaaS terms)
- Price may change with 30 days notice

**4. SMS Alerts — CRITICAL SECTION**

This section must do two things simultaneously:
- Confirm that alerts are intended to be acted upon (honest)
- Limit liability for delivery failures and parsing errors (protective)

Recommended language (have attorney review):

> "Alerts are derived directly from official ADF&G opening announcements and are intended to provide timely notification of district openings and closures. However, akFISHinfo does not guarantee (a) the accuracy of AI-parsed announcement data, (b) delivery timing — SMS delivery depends on Twilio and carrier networks outside our control, (c) that all ADF&G announcements will be received or processed, or (d) that subsequent ADF&G amendments or corrections will be reflected in previously sent alerts. **You are responsible for verifying that a fishery is open before deploying gear.** akFISHinfo shall not be liable for fines, permit violations, lost catch, vessel damage, or any other consequences resulting from a delayed, incorrect, or missed alert."

**5. No Regulatory Advice**
- The service parses and delivers ADF&G announcements as-is; it does not provide legal, regulatory, or fishing advice
- ADF&G regulations are the authoritative source; announcements may contain complex conditions that the parser may not fully capture
- User is solely responsible for compliance with all Alaska commercial fishing regulations

**6. Limitation of Liability**
- Service provided "as is"
- Maximum liability capped at fees paid in the preceding 12 months
- No liability for indirect, consequential, or incidental damages
- This section should be in ALL CAPS as required by many jurisdictions for enforceability

**7. Indemnification**
- User indemnifies akFISHinfo against claims arising from their use of the service or violation of these terms

**8. Account and Phone Number**
- One trial per phone number (enforced technically)
- User is responsible for keeping phone number current — missed alerts due to outdated phone number are not our liability
- Account sharing is not permitted

**9. Prohibited Uses**
- Reselling alert data
- Automated scraping/harvesting of parsed announcement data
- Using the service to conduct fishing in violation of applicable regulations

**10. Termination**
- We may suspend or terminate accounts that violate these terms
- Cancellation process: user-initiated via account page

**11. Governing Law**
- Laws of the State of Alaska (where the regulated activity occurs)
- Jurisdiction: Alaska courts

**12. Contact**
- Support email (once customer support email is set up via Mailgun)

---

## Phase 2: Privacy Policy — content requirements

Privacy policies are increasingly regulated (CCPA, GDPR, various state laws). Even if the user base is primarily Alaskans, anyone can sign up, so basic compliance is prudent.

### 2.1 Required sections

**1. Introduction**
- Who we are (akFISHinfo, contact email)
- What this policy covers
- Effective date

**2. Information We Collect**

*Directly from you:*
- Name, email, password (hashed — plaintext never stored or transmitted)
- Phone number
- Payment information (note: card data is handled entirely by Stripe — we only store a Stripe customer ID)

*Automatically:*
- Session cookies (for stay-signed-in functionality)
- Server logs (IP address, browser type, pages visited) — standard server logging

*From third parties:*
- Google OAuth: name and email when you sign in with Google

**3. How We Use Your Information**
- Delivering SMS alerts (phone number → Twilio)
- Account authentication and management
- Sending verification and account emails (Mailgun)
- Processing payments (Stripe)
- Improving and debugging the service (server logs)
- We do NOT sell your personal information

**4. Third-Party Service Providers**

List each processor with a brief description and link to their own privacy policy:
- Stripe (payments): stripe.com/privacy
- Twilio (SMS): twilio.com/legal/privacy
- Mailgun (email): mailgun.com/privacy-policy
- Google (OAuth): policies.google.com/privacy
- Anthropic (AI parsing): anthropic.com/privacy — note: only ADF&G PDF content is processed, not user data
- Railway (hosting): railway.app/legal/privacy

**5. Data Retention**
- Account data: retained while account is active + 30 days after deletion request
- SMS log: retained for 90 days (audit purposes)
- Session data: expires per session settings (30 days for remember-me)

**6. Your Rights**
- Access your data: account page shows name, email, phone
- Delete your account: contact us at [support email] — we will delete within 30 days
- Opt out of SMS: cancel subscription (SMS alerts only go to active subscribers)
- For CCPA (California residents): right to know, right to delete, right to opt-out of sale (we don't sell data)

**7. Cookies**
- One session cookie (`connect.sid`) — strictly necessary for authentication
- No advertising or tracking cookies
- No third-party cookies except from map tile provider (CARTO/OpenStreetMap)

**8. Security**
- Passwords stored as scrypt hashes (not plaintext)
- Database hosted on Railway with encrypted connections
- Payment data handled entirely by Stripe (PCI-compliant) — we never see card numbers
- HTTPS enforced in production

**9. Children**
- Service not directed at users under 13 (or 18 — align with commercial fishing age requirements)
- We do not knowingly collect data from minors

**10. Changes to This Policy**
- Updates posted to this page; continued use = acceptance
- Significant changes will be emailed to registered users

**11. Contact**
- [Support email — set up via Mailgun first]

---

## Phase 3: Implementation

### 3.1 Backend routes (backend_v2.js)

Add two routes following the same pattern as `GET /about` (public, no auth check):

```js
/**
 * GET /privacy
 * Privacy Policy — public, no auth required
 */
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

/**
 * GET /terms
 * Terms of Service — public, no auth required
 */
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
```

Insert before the `express.static` catch-all at line 1224.

### 3.2 HTML pages

Both pages use the same design pattern as `public/about.html`:
- Nav bar with Blackbird wordmark
- `.page` container, max-width 720px (wider than account/pricing — legal text needs room)
- `h1` with Blackbird font
- Content in `.card` divs, organized by section
- Sections use `.card-title` labels

**about.html** (reference for the page template, lines 1–end)

For legal text, use this card body pattern:
```html
<div class="card">
  <div class="card-title">Section Name</div>
  <div class="legal-body">
    <p>...</p>
    <p>...</p>
  </div>
</div>
```

```css
.legal-body p {
  font-size: 13px;
  color: var(--text);
  line-height: 1.75;
  margin-bottom: 12px;
}
.legal-body p:last-child { margin-bottom: 0; }
.legal-body strong { color: var(--text); font-weight: 600; }
.legal-body .warning {
  color: var(--warn);
  background: rgba(245,158,11,0.07);
  border: 1px solid rgba(245,158,11,0.2);
  border-radius: 4px;
  padding: 10px 14px;
  margin: 12px 0;
}
```

### 3.3 Footer links

Both pages should be linked from the footer/bottom of:
- `public/index.html` — add footer links at bottom of left panel
- `public/pricing.html` — add "By subscribing you agree to our [Terms] and [Privacy Policy]" below the subscribe button (standard SaaS practice, also legally important for consent)
- `public/setup.html` — same consent line below the phone submit button

The pricing.html consent line is especially important — it's the point of purchase. Pattern:
```html
<p class="legal-consent">
  By subscribing you agree to our
  <a href="/terms">Terms of Service</a> and
  <a href="/privacy">Privacy Policy</a>.
</p>
```

### 3.4 Update CLAUDE.md

Add to the Public pages table:
```
| `/privacy` | `public/privacy.html` | none |
| `/terms`   | `public/terms.html`   | none |
```

---

## Phase 4: Attorney review checklist

Before the pages go live, have an Alaska-licensed attorney review:

- [ ] The SMS liability limitation language in ToS section 4 — this is the highest-risk section
- [ ] Whether "laws of the State of Alaska" is the right governing law choice
- [ ] The indemnification clause
- [ ] Whether a "reasonable reliance" standard is appropriate given the product purpose
- [ ] CCPA compliance if any California users are expected
- [ ] Whether the trial-abuse prevention (one trial per phone) creates any consumer protection issues
- [ ] Cancellation and refund policy language

---

## Final: Verification checklist

```bash
# Routes present
grep -n "GET /privacy\|GET /terms" backend_v2.js

# Files exist
ls public/privacy.html public/terms.html

# No old design tokens
grep -n "#5b8dee\|Helvetica\|#0f1117" public/privacy.html public/terms.html

# Consent line present on pricing page
grep -n "Terms of Service\|Privacy Policy" public/pricing.html

# Links in nav/footer
grep -rn 'href="/terms"\|href="/privacy"' public/
```

Commit message template:
```
Add /privacy and /terms pages with backend routes

- Privacy Policy: data collection, third-party processors, user rights
- Terms of Service: service description, SMS liability scope, subscription terms
- Consent link added to pricing.html and setup.html
- Public routes added to backend_v2.js
```
