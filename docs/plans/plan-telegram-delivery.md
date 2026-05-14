# Plan — Telegram Delivery (Twilio Replacement)

**Status:** in progress on branch `feat/telegram-delivery` (started 2026-05-13)
**Why:** Twilio rejected 10DLC registration. Telegram Bot API is free, has zero approval/registration, and delivers push notifications natively. Replaces SMS as the primary alert channel.

---

## Scope

### In scope (this PR)

- Strip Twilio + SMS + phone-number capture from backend, registration, ToS, and `/setup`.
- Add a Telegram bot integration: per-captain 6-digit link code, deep-link to bot, `/start <code>` verification, alert fan-out via `sendMessage`.
- Notification log table (analogue of `sms_log`, but for Telegram).
- Anti-trial-farming defense: `UNIQUE` constraint on `telegram_chat_id` + prior-trial check by chat_id (replaces the prior phone-number-based check).
- Account page: show linked Telegram, regenerate code, unlink.
- Manual setup runbook (this doc).

### Out of scope (deferred)

- **Help bot via Anthropic Haiku** — the plan mentions this; build later as a follow-up. We add a *placeholder reply* (`I can't answer questions yet — for now use the website's help or email us`) that we'll swap out when the Haiku wrapper ships.
- **QR codes** on `/setup` — phase 2 if anyone asks. The `t.me/<bot>?start=<code>` deep link works as a tap-target on mobile.
- **Group chat / channels** — disabled in BotFather. This is a 1:1 DM bot.
- **Dropping `phone_number` / `sms_opted_in` / `sms_log`** from the schema — leave them in place. We stop writing to them; cleanup is a chore for later. Removing columns is high-risk for low reward.
- **TFN/SMS as a fallback channel** — apply for that separately in parallel.

### Design decisions

- **Webhook (not polling).** Webhook means Telegram POSTs to `/webhooks/telegram` when there's an update — zero polling cost, near-instant response. Polling would require a long-running worker we don't have.
- **Codes are 6 digits, single-use, 15-minute TTL, per-captain.** Generated lazily — the `/setup` page calls `POST /api/telegram/link-code` on load and gets the active code (or a new one if expired).
- **Chat ID is the source of truth.** Once a captain links, their `telegram_chat_id` is set. The link code is wiped after success.
- **Anti-meta-gaming:** `telegram_chat_id` is `UNIQUE` — if a chat tries to link to a second captain account, we refuse. Trial grants check both `phone_number` (legacy) and `telegram_chat_id` for prior trials, so users can't farm trials by making new email accounts but reusing the same Telegram.
- **One bot for the whole product.** No per-user bot tokens. The single bot DMs every captain.

---

## Manual setup (you do this once)

### 1. Create the bot in Telegram

1. Open Telegram, search for **@BotFather**, start a chat.
2. Send `/newbot`.
3. Name (what users see): `akFISHinfo Alerts`
4. Username (must end in `bot`): suggest `akfishinfo_bot` or `akfishinfo_alerts_bot` — BotFather will tell you if it's taken.
5. **Copy the token** BotFather replies with. It looks like `8123456789:AAH...`. Treat it like a password.

### 2. Configure the bot

In the BotFather chat:

```
/setdescription
<pick your bot from the list>
akFISHinfo sends commercial salmon opening alerts for Prince William Sound (Areas E & E0). Link to your akfishinfo.com account to receive notifications.
```

```
/setabouttext
<pick your bot>
PWS commercial salmon opening alerts — akfishinfo.com
```

```
/setuserpic
<upload your wordmark or app icon>
```

Disable group joining (this is a DM-only bot):

```
/setjoingroups
<pick your bot>
Disable
```

Disable inline mode:

```
/setinline
<pick your bot>
(reply nothing or "Disable")
```

Set the command menu:

```
/setcommands
<pick your bot>
start - Link to your akFISHinfo account
status - Check link status
unlink - Disconnect this Telegram from akFISHinfo
help - Get help
```

### 3. Configure environment variables

On Railway (or local `.env`), add:

| Variable | Value | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `8123456789:AAH...` | from BotFather |
| `TELEGRAM_BOT_USERNAME` | `akfishinfo_bot` | no `@`, lowercase, used to build deep links |
| `TELEGRAM_WEBHOOK_SECRET` | a random 32+ char string | run `openssl rand -hex 32` |

Restart the service so it picks up the new env vars.

### 4. Register the webhook with Telegram

Once the service is running and reachable at `https://akfishinfo.com` (or wherever `BASE_URL` points):

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://akfishinfo.com/webhooks/telegram",
    "secret_token": "<the TELEGRAM_WEBHOOK_SECRET you set>",
    "allowed_updates": ["message"]
  }'
```

Expected reply: `{"ok":true,"result":true,"description":"Webhook was set"}`

Verify:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Expected: `pending_update_count: 0`, `url: https://akfishinfo.com/webhooks/telegram`, `last_error_message: null`.

### 5. Smoke-test as a user

1. Sign up at `akfishinfo.com` with a test email (or use an existing test account).
2. On `/setup` you should see a 6-digit code and a "Open Telegram" button.
3. Tap the button — Telegram opens with the bot pre-loaded and `/start <code>` ready to send. Hit send.
4. The bot should reply: *"Linked to your akFISHinfo account, captain. You'll get alerts when openings are announced."*
5. Refresh the `akfishinfo.com` tab — `/setup` should auto-advance to `/pricing` (or `/app` for admins/alaska.gov).
6. From an admin account, trigger a test alert (re-parse a recent announcement or call the alerts function manually) — confirm the bot DM lands.

### 6. Common gotchas

- **Webhook returns 401:** the `TELEGRAM_WEBHOOK_SECRET` env var doesn't match what you sent to `setWebhook`. Re-run `setWebhook` with the right secret.
- **Bot replies "Unknown user" on `/start`:** the code expired (15 min) or was already used. Click "Regenerate code" in `/setup` or `/account`.
- **Deep link doesn't open Telegram:** the user doesn't have Telegram installed on that device. Fall back to copying the bot username + code manually.
- **`getWebhookInfo` shows a `last_error_date`:** check the service logs for the failing request. Common cause: returning a 500 from `/webhooks/telegram` — Telegram retries indefinitely until you 200 the same `update_id`.

---

## Data model

```sql
ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64);
ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_link_code VARCHAR(8);
ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at TIMESTAMPTZ;
ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_telegram_chat_id
  ON captains(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_telegram_link_code
  ON captains(telegram_link_code) WHERE telegram_link_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  captain_id INT REFERENCES captains(id),
  chat_id BIGINT,
  message TEXT,
  status TEXT,                          -- 'sent' | 'failed'
  telegram_message_id BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_captain ON notification_log(captain_id);
```

`hasAccess()` is unchanged. The trial-grant predicate now checks prior trials by **chat_id** (not phone number).

---

## API surface

| Route | Auth | Description |
|---|---|---|
| `POST /api/telegram/link-code` | session | Returns `{code, bot_username, deep_link, expires_at}`. Generates a new code if none active. |
| `POST /api/telegram/regenerate` | session | Forces a new code (invalidates the previous one). |
| `POST /api/telegram/unlink` | session | Clears `telegram_chat_id` from the captain. |
| `POST /webhooks/telegram` | header `X-Telegram-Bot-Api-Secret-Token` | Telegram → us. Handles `/start <code>`, `/status`, `/unlink`, `/help`. |

`/api/me` gains: `telegram_linked: bool`, `telegram_username: string|null`.

---

## Frontend changes

| Page | Change |
|---|---|
| `public/setup.html` | Replace phone-input form with Telegram-link panel: shows 6-digit code, "Open Telegram" deep-link button, step-by-step instructions, polls `/api/me` every 3 s for `telegram_linked: true`. |
| `public/account.html` | New "Notifications" section: shows linked Telegram username; "Regenerate code" + "Unlink" buttons. |
| `public/signup.html` | Remove phone-number field + SMS-consent checkbox. |
| `public/terms.html` | Replace SMS / 10DLC language with Telegram notifications language. |
| `public/app.html` | Remove any SMS-related copy; nothing else to change. |

---

## Rollout / migration

- Existing captains with `phone_number` set will see the Telegram-link panel on `/setup` next time they hit it (or via `/account`). No auto-redirect — they keep their access; we just stop sending them SMS.
- `alertProUsers()` is replaced by `notifyCaptains()` which fans out to anyone with `telegram_chat_id IS NOT NULL` plus the existing tier/region/alerts_enabled filters.
- The `sms_log` table is left untouched. Future PR can rename or drop.

---

## Open follow-ups

1. **Haiku-powered help bot.** Wire `/help` (and free-text messages) to a Claude Haiku call that has the app's FAQ in context. Out of scope here; the bot replies with a static "we can't answer questions yet" message in this PR.
2. **TFN SMS as fallback channel.** Apply with Plivo or Telnyx in parallel. When approved, add it alongside Telegram (not instead).
3. **Web push notifications** for users who refuse Telegram. Browser-native, no extra account.
4. **Drop SMS columns.** Once we're confident nobody is consuming them, drop `phone_number`, `sms_opted_in`, `sms_opted_in_at`, and the `sms_log` table.
