# Pre-launch Checklist — akFISHinfo

**Status:** drafted 2026-05-14, after Telegram delivery shipped to main. Targets a clean public launch before PWS commercial salmon season opens (late May / early June).

The checklist is in priority order. Items marked **(blocker)** must be true before you tell anyone to sign up.

---

## 1. End-to-end delivery — must work for one real announcement

- [ ] **(blocker)** Force-reparse one historical announcement from `/admin` and confirm the bot DMs the linked admin/test account. This proves `notifyCaptains()` → `sendTelegramMessage()` → real device.
- [ ] **(blocker)** When the next live ADF&G PDF arrives, watch the logs to confirm: Mailgun webhook → parser → `notifyCaptains` → Telegram DM received within ~10 seconds.
- [ ] Smoke-test the link flow with a *brand new* email (not your own admin account):
  - sign up → land on `/setup` → 6-digit code shows
  - tap Open Telegram → bot responds → setup page auto-advances
  - choose trial → land on `/app`, alerts wired up
- [ ] Verify the trial anti-farming check: try linking the same Telegram chat to a second new account, confirm `/api/setup` rejects the trial.

## 2. Payment flow — Stripe end-to-end on a real card

- [ ] **(blocker)** Run a real subscription purchase with a real card (any plan) and confirm:
  - Stripe webhook fires, captain flips to `tier='pro'` + `subscription_active=true`
  - User lands on `/app` after `/success`
  - `is_early_adopter` is true if seats remain (or false otherwise)
- [ ] Cancel that subscription via `/account` → confirm `cancel_at_period_end=true` and access persists until period end
- [ ] Refund the test charge in Stripe dashboard once verified
- [ ] Check early-adopter seat counter: should reflect the count after the test purchase

## 3. Auth + accounts

- [ ] Google OAuth login round-trip on prod (post-OAuth redirect lands on `/setup` if no Telegram linked, else `/app`)
- [ ] Email/password signup → verification email arrives via Mailgun (check the email_verified flag flips on click)
- [ ] Password reset path exists or is documented as "email us" (no reset flow exists yet — make sure ToS says so)
- [ ] `/api/me` returns expected shape for: anonymous, free, trial, pro, admin, @alaska.gov

## 4. Legal / customer-facing copy

- [ ] **(blocker)** ToS scrubbed of all SMS / Twilio language — already done in commit `4ebbe93`, but **re-read [public/terms.html](public/terms.html)** end-to-end one more time looking for stragglers
- [ ] Privacy policy mentions: Telegram, Stripe, Mailgun, Google OAuth (data flows to each)
- [ ] No marketing copy on `/`, `/about`, `/pricing` references "SMS," "text message," or "phone alerts" — re-grep before launch
- [ ] An attorney has reviewed the `[ATTORNEY REVIEW]` blocks in `terms.html` (or you have explicitly decided to launch without that and accept the risk)

## 5. Operational readiness

- [ ] Railway env vars set: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, plus all existing (DATABASE_URL, SESSION_SECRET, BASE_URL, Stripe, Mailgun, Anthropic, Google OAuth, ADMIN_EMAILS) — verify each is non-empty in the Railway dashboard
- [ ] Telegram `getWebhookInfo` shows `pending_update_count: 0` and no `last_error_*` field — already confirmed ✓
- [ ] Mailgun route active: `<your-inbound>@akfishinfo.com` → `https://akfishinfo.com/webhooks/email` (confirm in Mailgun dashboard)
- [ ] `client_secret_*.json` file moved out of repo root onto your machine only (sensitive)
- [ ] Database backup taken in Railway — at least one manual snapshot before launch
- [ ] Logs are readable: `railway logs` (or dashboard) shows successive boot + a clean `✓ Database initialized` line for the latest deploy

## 6. Map / app polish

- [ ] `/app` map loads on mobile (iPhone Safari, Android Chrome) — pinch-zoom works, district click works, scrubber works
- [ ] `/app` map loads on a laptop — both light and dark theme look right
- [ ] No JS errors in browser console for any logged-in page
- [ ] Closed-waters layer is **explicitly deferred** for v1 — make sure no part of the UI promises it ([see honest take in docs/plans/plan-telegram-delivery.md](plans/plan-telegram-delivery.md) about hiring it out or shipping without)

## 7. Monitoring / alerting (post-launch comfort)

- [ ] You know how to check the Railway logs for the live service
- [ ] You know how to query `notification_log` to see Telegram send success/failure counts
- [ ] You know how to query `captains` to count active subscribers / trials / linked-but-free
- [ ] You have a personal account that you keep linked + subscribed so you receive every alert as a canary

## 8. Things to explicitly NOT do before launch

These can absolutely wait — calling out so they don't become last-minute distractions:

- Closed-waters polygon layer (defer, hire out or ship later)
- Toll-free SMS as a fallback channel (apply in parallel, wire up when approved)
- Deckhand seats / PRO-MAX feature
- Account deletion UI (manually in DB if anyone asks)
- Web push notifications
- Haiku-powered Telegram help bot
- Dropping the legacy SMS columns from the schema

---

## Launch-day order of operations

1. Final deploy of any last fixes from this checklist
2. Manually sign up a fresh dummy account on prod → smoke test as a stranger would
3. Update the public landing page (`/` and `/about`) with the launch announcement (if not already worded that way)
4. Post in whatever channels you've been seeding interest (PWS captain groups, etc.)
5. Watch Railway logs + Telegram chats live for the first hour
6. Don't push code changes that day unless something is on fire — the deploy could break things and there's no rollback drill yet

---

## Rollback plan (if it goes wrong)

- Frontend bug only: `git revert` the offending commit, redeploy.
- Backend bug: same. The schema migrations are all additive, so reverting code is safe (the new columns just sit unused).
- Stripe webhook bug: pause new signups by switching the `Sign up` CTA on `/` to an "early access — email us" form. Existing subscribers keep working.
- Telegram bot misbehaving: the webhook secret is enforced server-side, so you can blank `TELEGRAM_WEBHOOK_SECRET` in Railway env and the bot stops responding (everything else keeps working).
