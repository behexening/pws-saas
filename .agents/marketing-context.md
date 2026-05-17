# Marketing Context — akFISHinfo

*Last updated: 2026-05-17*

## Product Overview
**One-liner:** Real-time Telegram alerts for Alaska commercial salmon openings in Prince William Sound.
**What it does:** akFISHinfo monitors ADF&G email announcements, parses each PDF with AI, and pushes a Telegram DM to every subscribed captain within seconds of an official opening or closure. An interactive live map shows current district status and full announcement history.
**Product category:** Commercial fishing operations alerts / ADF&G opening notifications
**Product type:** SaaS
**Business model:** Subscription (biweekly / monthly / season). Early-adopter pricing: $30/2 wks · $50/mo · $240/season. Standard pricing: $50/2 wks · $84/mo · $400/season. Season plan supports deckhand-seat add-ons (up to 3). 7-day free trial, no card required.

---

## Target Audience
**Target customers:** Independent Alaska commercial salmon fishing captains and boat owners operating in Prince William Sound under ADF&G permits.
**Decision-makers:** Captain / permit holder (subscriber and financial buyer); deckhand (user under season seat).
**Primary use case:** Know the moment ADF&G issues a PWS opening — before the window closes and before word gets around.
**Jobs to be done:**
- Get instant, reliable notification of ADF&G district openings without checking email or waiting on the grapevine.
- Quickly understand which districts, gear types, and time windows are in a new announcement.
- Review past opening history to plan or dispute timing questions.
**Use cases:**
- Captain docked in Cordova receives Telegram DM within seconds of ADF&G sending the opening PDF — heads out before slower boats hear about it.
- Deckhand uses the map to see which districts are currently open while captain is away from phone.
- Season plan subscriber adds three crewmembers as deckhand seats so the whole boat is always synced.

---

## Personas

| Persona | Role | Cares about | Challenge | Value we promise |
|---------|------|-------------|-----------|------------------|
| Captain / permit holder | Decision maker + financial buyer | Timing advantage, reliable info, cost vs. catch value | Missing openings because of slow info chains or monitoring fatigue | Guaranteed first-to-know on every ADF&G announcement |
| Deckhand | User (season seat) | Knowing the plan without bugging the captain | No direct access to opening info | Own Telegram alerts + limited map access under captain's subscription |

---

## Problems & Pain Points
**Core problem:** ADF&G issues opening announcements via email with attached PDFs. By the time fishermen hear through normal channels — email forwarding chains, Telegram group chats, word of mouth ("the grapevine") — the prime window may already be closing. The difference between first-to-know and second-to-know can be tens of thousands of dollars per opening.
**Why alternatives fall short:**
- Email from ADF&G: arrives in a crowded inbox, requires manually opening and reading the PDF, no push notification.
- Fishing fleet group chats: human latency — someone has to read, understand, and relay the info; gossip and hearsay mix with official data.
- Checking the ADF&G website manually: no push, requires remembering to check, no history or map.
**What it costs them:** Missed fishing time during open windows; arriving at grounds after faster boats are already set; less total catch, reduced season income.
**Emotional tension:** The anxiety of not knowing whether an opening has been called while you're away from your phone or asleep; the frustration of finding out you were late because of a slow relay.

---

## Competitive Landscape

| Competitor | Type | How they fall short |
|-----------|------|---------------------|
| ADF&G email list | Indirect | Plain email with PDF attachment; no push notification, no parsing, no map |
| Fleet Telegram group chats | Indirect | Human relay — delayed, noisy, unofficial, unreliable |
| Manual ADF&G website checks | Indirect | No alerts, requires active monitoring, no history |
| Unknown tender-tracking app | Secondary | Tracks tender vessels, not ADF&G opening announcements — different use case, same fisherman audience |

---

## Differentiation
**Key differentiators:**
- Seconds-level latency from ADF&G email → Telegram DM (no human in the loop).
- AI-parsed structured data: district names, gear types, open/close windows, constraints — not just a forwarded PDF.
- Interactive live map with real-time district status and historical scrubber.
- Founder credibility: built by a working deckhand who experienced the pain firsthand.
- Early-adopter permanent price lock creates strong retention incentive.
**How we do it differently:** Full automation — ADF&G email triggers parsing (Claude API), database update, map refresh, and Telegram push in one pipeline with no manual step.
**Why that's better:** First-to-know advantage translates directly to catch and income. No cognitive load — no reading PDFs, no monitoring inboxes.
**Why customers choose us:** Speed, reliability, and trust. A fisherman who misses one opening because of slow info has already justified the season subscription cost.

---

## Objections

| Objection | Response |
|-----------|----------|
| "I already get the ADF&G emails." | You get a PDF in your inbox. We give you a Telegram push within seconds, with the key data already extracted — no reading required. |
| "Is $240/season worth it for just notifications?" | One missed opening can cost far more than $240. Early adopters lock in that rate permanently, so it only gets cheaper relative to your season earnings over time. |
| "What if there are tech problems during a real opening?" | The pipeline is automated with no single point of failure; Railway-hosted with PostgreSQL persistence. Alerts fall back to the map if Telegram delivery fails. |

**Anti-persona (NOT a good fit):** Sport fishermen, charter operators, aquaculture workers, or anyone without a Prince William Sound commercial salmon permit. Fishermen in other AK districts (Southeast, Kodiak, Bristol Bay) — PWS-only for now; those regions are on the roadmap.

---

## Switching Dynamics
**Push (away from current):** Tired of missing openings because email sat unread; frustrated by grapevine latency; annoyed by noisy group chats mixing rumor with official info.
**Pull (toward us):** Seconds-level notification with zero manual effort; clean map that shows exactly what's open right now; 7-day free trial so there's no risk to try.
**Habit (keeping them stuck):** Already in a fleet Telegram group; checking ADF&G website is a known routine; skepticism about paying for something the grapevine "kind of" provides for free.
**Anxiety (about switching):** "What if the alerts miss an opening?" / "Is this legit or will it go dark mid-season?" — addressed by trial period, founder transparency, and automated pipeline (no human needed to keep it running).

---

## Customer Language
**How they describe the problem:**
- "Finding out about openings late — through the grapevine, after the good window was closing — got old fast."
- "I'm staring at my inbox waiting for the ADF&G email and by the time I open the PDF everyone else already knows."
- "The group chat is full of garbage, you never know if it's official or someone's guess."
**How they describe us:**
- "I got the ping before anyone in my fleet knew there was an opening."
- "It just tells you what's open and when — I don't have to read the whole PDF."
**Words to use:** opening, alert, instant, ADF&G, district, announcement, PWS, Prince William Sound, season, captain, permit, deckhand, real-time, notification
**Words to avoid:** "solution," "leverage," "empower," "synergy," "platform," "ecosystem" — fishermen see through corporate marketing language immediately.

| Term | Meaning |
|------|---------|
| ADF&G | Alaska Department of Fish & Game — the state agency issuing opening announcements |
| PWS | Prince William Sound — the geographic region covered |
| Opening | An officially issued window when a district is legal to fish |
| District | One of 11 sub-regions within PWS (Eastern, Northern, Southeastern, etc.) |
| Gear type | Fishing method authorized in a specific announcement |
| Early adopter | First 30 subscribers; lock in their price permanently |
| Deckhand seat | Add-on for season plan; extends alerts and map to up to 3 crew |
| History scrubber | UI control for replaying past announcement states on the map |

---

## Brand Voice
**Tone:** Direct, plain-spoken, confident — not casual but never corporate.
**Style:** Concise and factual; let the utility speak for itself.
**Personality:** Reliable, honest, technical-but-accessible, Alaska-rooted, no-BS.
**Voice DO's:**
- Use short sentences and active verbs.
- Speak in fishing industry terms without explaining them — the audience knows them.
- Lead with the functional benefit (speed, reliability, simplicity).
- Reference the founder's deckhand experience when establishing credibility.
**Voice DON'T's:**
- No hyperbole or superlatives ("revolutionary," "game-changing," "best-in-class").
- No emojis in any customer-facing UI copy.
- No corporate buzzwords.
- Don't over-explain — fishermen don't want paragraphs.

---

## Style Guide
**Grammar:** Plain American English. Short sentences preferred. No passive voice.
**Capitalization:** "ADF&G" always all-caps; "PWS" always all-caps; "Prince William Sound" title case; district names title case (Eastern District, Northern District). "akFISHinfo" is one word, lowercase "ak," uppercase "FISH," lowercase "info" — never split or reordered.
**Formatting:** Pricing always shows all three tiers together. Dates in Month DD, YYYY format. Time in Alaska time (AKDT/AKST).
**Preferred terms:** "opening" not "opportunity"; "alert" not "notification" in marketing copy (but "notification" OK in technical contexts); "captain" not "user" or "customer" in fisherman-facing copy.

---

## Proof Points
**Metrics:**
- Alerts delivered within seconds of ADF&G announcement email (automated, no human relay).
- Covers all 11 PWS districts.
- 0–10 alerts per week during May–September fishing season; zero off-season noise.
- 7-day free trial (one per phone number) — no card required.
**Customers:** Pre-launch; no subscribers yet.
**Testimonials:** None yet.

| Value Theme | Supporting Proof |
|-------------|-----------------|
| Speed | Automated pipeline: ADF&G email → Claude parse → DB update → Telegram DM, no human step |
| Reliability | Railway-hosted, PostgreSQL-backed; not dependent on any individual person to relay info |
| Founder credibility | Built by a commercial fishing deckhand who experienced the latency problem firsthand |
| Low risk to try | 7-day free trial, no card required |
| Long-term value | Early adopters lock in pricing permanently — rate never increases |

---

## Content & SEO Context
**Target keywords:**

| Cluster | Primary Keyword | Secondary Keywords | Intent |
|---------|----------------|-------------------|--------|
| Core product | ADF&G opening alerts | prince william sound fishing alerts, PWS opening notifications | Commercial |
| Information | prince william sound commercial salmon openings | ADF&G commercial salmon announcements, PWS fishing districts | Informational |
| Competitor alternative | ADF&G email notification | fishing opening telegram alert, real-time fishing district status | Commercial |
| Local/seasonal | alaska commercial salmon fishing 2026 | PWS salmon season alerts, Cordova fishing alerts | Informational/Commercial |

**Internal links map:**

| Page | URL | Use for | Anchor text |
|------|-----|---------|-------------|
| Landing / home | akfishinfo.com | First touch, trial CTA | "Real-time PWS opening alerts" |
| Pricing | akfishinfo.com/#pricing | Conversion | "Early adopter pricing" |
| App / live map | akfishinfo.com/app | Retention, trial activation | "Open live map" |
| About | akfishinfo.com/about | Trust / credibility | "Built by a deckhand" |

**Writing examples:**
- Homepage hero: "Real time alerts for PWS. Know before you go." — ultra-concise, benefit-first, no fluff.
- Pricing copy: early-adopter permanent lock framing — creates urgency without fake scarcity.

---

## Goals
**Business goal:** Reach 50 paid subscribers by end of June 2026.
**Conversion action:** Start 7-day free trial → link Telegram → experience first real opening alert → convert to paid plan before trial ends.
**Current metrics:** Pre-launch; 0 subscribers as of 2026-05-17.
