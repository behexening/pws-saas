# Mailgun Domain Migration Checklist
**Change:** `alerts@akfishinfo.com` → `alerts@mg.akfishinfo.com`
**Why:** `akfishinfo.com` MX records moved to Google Workspace; `mg.akfishinfo.com` is now the Mailgun subdomain.

## Mailgun Dashboard

- [ ] Add domain `mg.akfishinfo.com` (if not already added)
- [ ] Verify DNS on the subdomain:
  - MX record: `mg.akfishinfo.com` → Mailgun MX servers
  - TXT record (SPF): `mg.akfishinfo.com`
  - CNAME (DKIM): `pic._domainkey.mg.akfishinfo.com`
  - These records are on the subdomain only — won't conflict with Google Workspace on the root domain
- [ ] Receiving → Routes: create or update a route matching `alerts@mg.akfishinfo.com` → forward to webhook URL
- [ ] Copy new **HTTP webhook signing key** for `mg.akfishinfo.com` (Mailgun → domain → Webhooks tab)

## Railway Env Vars

| Var | New value |
|---|---|
| `MAILGUN_DOMAIN` | `mg.akfishinfo.com` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | _(new key from Mailgun Webhooks tab)_ |
| `EXTRA_ALLOWED_SENDERS` | `blazekin1203@gmail.com` _(remove before going live)_ |

## Tell ADF&G

Update the email address they CC/send PDFs to: `alerts@mg.akfishinfo.com`

## Going Live

- Remove `EXTRA_ALLOWED_SENDERS` env var (or clear it) — after that, only `@adfg.alaska.gov` and `@alaska.gov` senders will trigger parsing
