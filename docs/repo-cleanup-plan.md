# Repo Cleanup Plan (proposed — nothing moved yet)

**Status:** drafted 2026-05-14. Awaiting greenlight before executing.

Goal: trim top-level clutter so anyone (you in 3 weeks, an Upwork contractor, a security auditor) can land in the repo and find their way around in under 30 seconds. No code paths change.

---

## Layer 1 — Delete from disk (zero git impact)

These are local-only artifacts that are already gitignored or were never tracked. Removing them frees clutter without touching history.

| Path | What it is | Reason to drop |
|---|---|---|
| `live_output.html` (376 KB) | debug artifact from an old parser run | regenerable, gitignored |
| `log.svg` | one-off scratch file | unused |
| `accessibility-auditor.zip` | downloaded Claude skill | already loaded as a skill if needed |
| `legal-advisor.skill`, `stripe-integration-expert.skill` | Claude skill bundles | belong in `~/.claude/`, not here |
| `railway` (8.5 MB) | compiled Railway CLI binary | install globally instead, gitignored |
| `FOLDER_STRUCTURE.md` | outdated repo tour from Apr 10 | superseded by the new README |
| `docs/IMG_6539.PNG` | random screenshot | unused in any doc |
| `docs/Screenshot 2026-04-16 at 12-48-00 Twilio Console.png` | Twilio dashboard screenshot | Twilio is gone — historical only |
| `docs/projekt-blackbird-v2.otf` | duplicate of `public/static/projekt-blackbird-v2.otf` | served copy is the source of truth |
| `client_secret_2_…apps.googleusercontent.com.json` | Google OAuth client secret JSON | **SENSITIVE** — already gitignored, but should not sit in repo root; move to a personal secrets folder outside the repo |

## Layer 2 — Move within the repo

Cleaner organization, all moves keep git history (`git mv`).

| From | To | Why |
|---|---|---|
| `data/thetelegramplan` | `docs/plans/_archive/plan-telegram-delivery-source.md` | the bullet-point plan you wrote before we built it; archive for historical reference |
| `docs/plans/plan-twilio-10dlc.md` | `docs/plans/_archive/` | obsolete — Twilio rejected, Telegram replaces |
| `docs/plans/plan-about-page.md` | `docs/plans/_archive/` | shipped Apr 15 |
| `docs/plans/plan-legal-pages.md` | `docs/plans/_archive/` | shipped (ToS, Privacy live) |
| `docs/plans/plan-mg-domain-migration.md` | `docs/plans/_archive/` | shipped (Mailgun on akfishinfo.com) |
| `docs/plans/plan-telegram-delivery.md` | stays in `docs/plans/` | active runbook for ops |
| `docs/plans/plan-deckhand-seats.md` | stays | future feature, not started |
| `docs/plans/plan-account-deletion.md` | stays | future feature |
| `docs/plans/New Pricing Plan.md` | rename to `docs/plans/pricing-tiers.md` | proper kebab-case, drop the "New " |
| `docs/pricing-strategy.md` | stays | active strategy doc |
| `docs/SAAS_SETUP_GUIDE.md` | `docs/_archive/SAAS_SETUP_GUIDE.md` | from very early days, partially outdated; new README + plan-telegram-delivery.md replace |
| `docs/SAAS_SUMMARY.md` | `docs/_archive/SAAS_SUMMARY.md` | same — superseded by README + CLAUDE.md |
| `docs/adfg/` | stays | source emails / sample PDFs are reference material |
| `docs/closedwaters/` | stays | active (regulation refs + QGIS guide) |
| `docs/geo/` | stays | active (geometry methodology notes) |
| `docs/hand-created/` | stays | tracing in progress |
| `docs/design-language.md` | stays | active |
| `products.csv` | `docs/operations/stripe-products.csv` | Stripe product dump — keep but in operations folder |
| `public/closed_waters_review.html`, `public/georef.html`, `public/trace.html` | stay in `public/` | served as undocumented admin/dev tools — works as-is |

## Layer 3 — Add new structural folders

| New folder | Purpose |
|---|---|
| `docs/plans/_archive/` | shipped or canceled plans (underscore prefix sorts them last) |
| `docs/_archive/` | superseded docs |
| `docs/operations/` | runbooks, dashboards, exported data dumps |

## Layer 4 — Tighten `.gitignore`

Add a few lines so future scratch files don't reappear:

```
# Top-level scratch / debug
/live_output*.html
/log.svg
/products.csv
*.skill
*.zip
/railway
```

(Leaving the existing entries alone.)

---

## What I will NOT touch

- `backend_v2.js`, `live_test_server.py`, `package.json`, `Dockerfile`, `runtime.txt` — entrypoints, stay in root.
- `public/` — Express serves these, so the layout is functional. No moves.
- `data/` shapefiles and gazetteer outputs — used by parsers and scripts at known paths.
- `scripts/` — script-to-script imports could break. Leave flat for now.
- `.git/`, `node_modules/`, `logs/` — never.

---

## Execution order, if approved

1. `mkdir -p docs/plans/_archive docs/_archive docs/operations`
2. `git mv` the files per Layer 2
3. Delete Layer 1 files (`rm` — they're not tracked)
4. Append Layer 4 entries to `.gitignore`
5. Replace `README.md` with the new draft (see `README.md.draft` once I write it)
6. Single commit: `chore: tidy repo layout — archive shipped plans, drop dev artifacts`
7. Push to main

Total moves: ~12 git mv operations + a handful of deletions. Reversible if anything looks wrong.

---

**Ready to execute? Say "do the cleanup" and I'll run it.**
