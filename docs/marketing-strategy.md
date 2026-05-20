# Marketing Strategy — akFISHinfo

*Last updated: 2026-05-18*

Working doc. Captures what we've learned, what's working, and what to do next.

---

## Current state

- **Stage:** Pre-launch, paid product live, no paid subscribers yet
- **Beta testers:** 20 captains recruited in one day from a single FB post
- **Goal:** 50 paid subscribers by end of June 2026
- **First PWS-proper opener:** mid-to-late June (estimated based on prior years and king count trends)

The acquisition channel question is mostly answered. The remaining questions are conversion timing, cohort management, and how hard to scale the channel.

---

## What worked in the first FB post

Posted in **Alaska Commercial Fisherman Jobs** (~19k members). Asked for 5-10 beta testers, got 20+ DMs/texts in one day. Texts vastly outnumbered likes — captains don't engage publicly, they reach out privately.

### Extractable assets

1. **The TimeZero hook is the strongest single asset.**
   *"You won't have to input it into TimeZero or whatever navigation software you use."*
   Re-keying ADF&G closure coordinates into nav software is a visceral pain. Every PWS gillnetter and seiner has done it. This hook outperforms the generic "real-time alerts" framing.

   Caveat: this hook is a **PWS-proper hook**, not a Copper River hook. Copper is flat with visible markers and no stream closures, so the TimeZero pain doesn't apply early season.

2. **Scarcity framing.** "Looking for 5-10 beta testers" created urgency and made it feel exclusive rather than promotional.

3. **Personal phone number for contact.** Fishermen trust a phone number, not a form. Texts > likes is the right ratio for this audience.

4. **Screenshots, not copy.** Dark map with green districts + the Copper River "OPEN" card sold harder than the text.

5. **Founder voice, plain English.** *"My new app that I built in the off season."* Sounds like a deckhand, not a startup.

### What to fix on the next post

- **Don't edit "Spots have been filled."** Replace with "Beta full — public trial starts [date], comment to be notified." Keeps the post recruiting after the initial wave.
- **Save non-PWS DMs.** The 19k-member group is bigger than the PWS permit count — Bristol Bay, SE, Kodiak captains saw the post. Those are latent demand for next-region expansion.

---

## Two value props, two segments

The product has two distinct value propositions that surface at different times in the season. The current marketing materials conflate them.

| Period | Audience experience | Value prop | What converts |
|--------|---------------------|------------|---------------|
| Early season (May → early June) | Copper / Bering only. Flat geometry, no stream closures, one opener per week. | **Push notification only.** "ADF&G announcement in your pocket in 30 seconds." | Biweekly / monthly plans |
| PWS proper (mid-June onward) | Northern, Eastern, Southwestern, etc. Stream closures, complex geometry, multiple openings, TimeZero replacement. | **Full pitch.** Closures, geometry, map, parsing. | Season plan + deckhand seats |

**Implication:** don't push the season plan hard during May. Push biweekly/monthly. Upgrade-prompt to season once PWS proper kicks in and captains have experienced the full value.

---

## Beta cohort strategy

Beta testers are gated by the `BETA_TESTERS` env var ([backend_v2.js:276](backend_v2.js#L276)). No time limit — access persists until their email is removed. They get full app access, Telegram alerts, and the feedback widget.

### Treat the cohort as warm leads, slow-cooked

The first ~3-4 weeks of beta access happen during low-value early season. Do not push for conversion during this period. Use it to:

- Send demo parses every time ADF&G drops a Copper opener — proves speed/reliability
- Pick a past PWS-proper opener (Northern District with closures), re-run the parser, and send the rendered map as a *"this is what your June will look like"* preview
- Activate the feedback widget — text each beta tester individually after opener #2 asking what's missing or broken
- Pre-PWS-proper "save your seat" nudge ~1 week before first complex opener: *"PWS proper starts next week — early adopter pricing locks in if you grab a plan before opener #1"*

### Graduation rule

**Graduate beta testers after their first PWS-proper opener, not before.**

By that point they've seen the full value prop. The access cliff is justified because the demo is complete. No trial extension needed at graduation — adding a 7-day trial on top of weeks of beta access dilutes the early-adopter price-lock urgency.

If you graduate them *before* a PWS-proper opener, you owe them a short access extension because the demo wasn't complete.

---

## Channel plan (next 6 weeks)

### Primary channel: Facebook fishing groups
Repeat the post template that worked, rotated across adjacent groups and rotated hooks. Same structure each time — founder voice, scarcity framing, phone number contact, two screenshots.

Groups to hit (in order):
- Alaska Commercial Fishermen (general AK)
- Cordova-specific groups
- Copper River District groups
- Drift gillnet / seine fleet pages

Hook rotation:
- **TimeZero pain** (best for PWS-proper audiences)
- **Grapevine latency** (best for general AK audiences)
- **First-to-know advantage** (best for competitive captains)

### Secondary channels (only after channel #1 saturates)

- **Cordova Times + KCHU radio** — local press, time for the week before first PWS-proper opener
- **Dock + harbormaster flyers** — Cordova, Whittier, Valdez harbors; processor lobbies (Copper River Seafoods, OBI, Trident, Peter Pan)
- **Processor partnerships** — pitch Copper River Seafoods / OBI / Trident on subsidizing season subs for contracted fleet captains. One deal could be 20-80 captains. Long-shot but transformative.

### Channels to skip
- Google / Meta / LinkedIn ads — audience doesn't search, doesn't scroll LinkedIn
- Programmatic SEO — TAM too small, search volume near zero
- Product Hunt — wrong audience
- Reddit r/fishing, r/Alaska — sport audience, not commercial permit holders

---

## Operational gotchas

### Env var management breaks at scale

`BETA_TESTERS` is parsed once at module startup. Adding a new tester requires a Railway redeploy. Worked fine for 20 captains. Will break at 50-100.

**Before the next FB post:** add an `is_beta_tester` boolean column on `captains`, update `isBetaTester()` to check the column OR the env var, and add an admin toggle. Env var becomes bootstrap mechanism; DB column becomes runtime mechanism. ~30-line change.

### Trial timing is currently mistimed

The 7-day trial flow was designed for a product that delivers daily value. With one opener per week in early season, a 7-day trial may see one Copper opener and zero PWS-proper value. Consider:

- Shift trial mechanism from "7 days" to "until your first 2 PWS-proper openers" — or run both clocks and take whichever is longer
- Or hold off on public trial launch until PWS proper begins (mid-June)

### "Beta full" → public launch handoff

When public trial opens, the FB post template should drop the scarcity framing and lead with the trial CTA. Save the "looking for testers" framing for next region's launch (Bristol Bay, SE, Kodiak).

---

## Conversion plan for the current 20 beta testers

1. **Now → first PWS-proper opener (mid-June):** slow-cook with demo parses, preview maps, individual feedback DMs
2. **~1 week before first PWS-proper opener:** "save your seat" nudge — lock in early-adopter price now
3. **Day of first PWS-proper opener:** experience the full value. Follow-up DM same evening: *"You got the ping first. Want to lock in the rate?"*
4. **Within 48 hours of first PWS-proper opener:** graduation. Cliff their beta access. Captains who paid keep access; captains who didn't get a single follow-up offering early-adopter pricing one more time, then they fall off.

If 50% of the 20 convert at graduation, that's 10 paid subs from a single FB post. Three to five more posts in adjacent groups should clear the 50-sub goal by end of June.

---

## Open questions

- Will processor partnerships actually move? Worth pitching Copper River Seafoods this month to find out.
- Does the FB post template scale to non-PWS regions (Bristol Bay, SE, Kodiak) before product expansion, or do we wait until parsing supports those regions?
- Is there appetite for a Cordova in-person presence (harbor visits, processor lobbies) once PWS proper starts? Highest-leverage moment to be physically present.

---

## Reference: original FB post

Posted 2026-05-17 in Alaska Commercial Fisherman Jobs.

> ISO PWS and Copper River Gillnetters/Seiners for beta testing
>
> Hello all, looking for 5-10 beta testers for my new app that I built in the off season that gives you a phone notification within ~30 seconds of an announcement for PWS and Copper River, and makes it into a visual map. It also has every single relevant stream closure in PWS, so you won't have to input it into TimeZero or whatever navigation software you use. If you're interested, shoot me a message on here or text me at 706-424-6523.
>
> Edit: Spots have been filled, thank you everyone!
