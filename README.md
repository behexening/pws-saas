# akFISHinfo

Real-time alerts for Alaska Department of Fish & Game commercial salmon openings in Prince William Sound. ADF&G emails a PDF → we parse it with Claude → the live map updates and every linked captain gets a Telegram DM within seconds.

Live at [akfishinfo.com](https://akfishinfo.com).

## Stack

- **Backend:** Node.js / Express in a single file: [backend_v2.js](backend_v2.js).
- **Database:** PostgreSQL on Railway.
- **Auth:** Passport (Google OAuth + email/password, scrypt).
- **Payments:** Stripe subscriptions, three tiers + early-adopter rate lock.
- **Alerts:** Telegram Bot API (see [docs/plans/plan-telegram-delivery.md](docs/plans/plan-telegram-delivery.md)).
- **Email ingress / verification:** Mailgun.
- **PDF parsing:** Python child process ([live_test_server.py](live_test_server.py)) calling the Claude API.
- **Frontend:** Plain HTML/JS in [public/](public/), Leaflet for the map. No build step.
- **Hosting:** Railway (app + Postgres).

## Repo tour

```
backend_v2.js            — entire backend (~1600 lines)
live_test_server.py      — PDF→GeoJSON parser, spawned by backend
public/                  — static frontend (no build)
data/                    — shapefiles, gazetteers, closure source data
scripts/                 — one-off Python / Node helpers (data prep)
docs/                    — see below
CLAUDE.md                — codebase guide for AI assistants (and humans)
```

### Docs that matter

| Path | What |
|---|---|
| [docs/pre-launch-checklist.md](docs/pre-launch-checklist.md) | What must be true before announcing launch |
| [docs/plans/plan-telegram-delivery.md](docs/plans/plan-telegram-delivery.md) | Live alert channel — BotFather + Railway runbook |
| [docs/plans/plan-deckhand-seats.md](docs/plans/plan-deckhand-seats.md) | Planned: shared seats under one season subscription |
| [docs/plans/plan-account-deletion.md](docs/plans/plan-account-deletion.md) | Planned: user-initiated account deletion |
| [docs/closedwaters/](docs/closedwaters/) | Closed-water polygons + QGIS tracing guide |
| [docs/pricing-strategy.md](docs/pricing-strategy.md) | Pricing rationale + early-adopter logic |
| [docs/design-language.md](docs/design-language.md) | UI/typography decisions |
| [docs/pr-workflow.md](docs/pr-workflow.md) | When PRs are required (backend + parser) |

## Running locally

Prereqs: Node 20, Python 3.11+, a Postgres reachable via `DATABASE_URL`, and the env vars below.

```bash
npm install
python3 -m pip install -r requirements.txt   # if/when one exists
node backend_v2.js
```

Visit [http://localhost:3000](http://localhost:3000).

### Required env vars

```
DATABASE_URL                    postgres://…
SESSION_SECRET                  any random 32+ char string
BASE_URL                        http://localhost:3000  (or your prod URL)

# OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# Admins (comma-separated)
ADMIN_EMAILS

# Payments
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_EA_BIWEEKLY        early-adopter price IDs
STRIPE_PRICE_EA_MONTHLY
STRIPE_PRICE_EA_SEASON
STRIPE_PRICE_STD_BIWEEKLY       standard price IDs
STRIPE_PRICE_STD_MONTHLY
STRIPE_PRICE_STD_SEASON

# Email (inbound + verification mail)
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILGUN_WEBHOOK_SECRET

# Parser (Claude)
ANTHROPIC_API_KEY

# Telegram
TELEGRAM_BOT_TOKEN              from BotFather
TELEGRAM_BOT_USERNAME           e.g. akfishinfo_bot (no @)
TELEGRAM_WEBHOOK_SECRET         random 32+ char string, must match setWebhook
```

`api.env` and `client_secret*.json` are gitignored — never commit them.

## Deployment

Railway watches `main` and auto-deploys. To deploy code:

```bash
git push origin main
```

Schema migrations are additive (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) and run on boot via `initDatabase()` — no separate migration step.

Backend / parser changes are supposed to land via PR; see [docs/pr-workflow.md](docs/pr-workflow.md).

## License

Proprietary. All rights reserved.
