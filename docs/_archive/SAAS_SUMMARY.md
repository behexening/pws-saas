# What Changed — SaaS Pipeline Version

## Original vs. New Architecture

### Original (from first proposal)
```
Email → /webhooks/email
  → Claude extraction
  → Parse queue
  → Admin review
  → /api/openers endpoint
```

### New (SaaS version)
```
Email → /webhooks/email
  → Run live_test.py
  → Generate interactive HTML map
  → SMS alerts
  → Website displays latest HTML
  → Signup + Stripe payment
```

---

## Files You Need

### Deploy to Railway

1. **backend_v2.js** — Your Node.js server
   - Receives Mailgun emails
   - Queues live_test.py to run
   - Handles Stripe payments
   - Sends SMS via Twilio
   - Serves website + signup form

2. **live_test_server.py** — Your parser (hosted)
   - Modified version of your live_test.py
   - Accepts CLI args: `--announcement-id`, `--output`, `--input-text`
   - Runs Claude parsing
   - Generates HTML map
   - Returns exit code (0=success, 1=fail)

3. **public/index.html** — Landing page
4. **public/signup.html** — Signup + Stripe checkout
5. **package.json** — Node dependencies
6. **requirements.txt** — Python dependencies
7. **Procfile** — Railway multi-process config

### Configuration

- **SAAS_SETUP_GUIDE.md** — Step-by-step deployment
- All 6 env vars documented in the guide

---

## Key Differences from First Proposal

### ❌ Removed
- LLM-only extraction with confidence scores
- Admin review queue (`/api/queue`)
- Spatial validation layer
- PostGIS geometry storage

### ✅ Added
- **live_test.py as hosted service** (not local)
- **Interactive HTML maps** (your visual output)
- **Direct SMS alerts** (no queue)
- **Stripe payment** (freemium model)
- **Website + signup** (customer-facing)

---

## How It Works

### 1. Announcement Arrives
```
ADF&G sends email
  → Mailgun receives it
  → POST /webhooks/email
```

### 2. Backend Queues Parsing
```
Backend stores announcement in Postgres
  ↓
Calls: execFile('python3', ['live_test_server.py', '--announcement-id', '42', '--output', '/path/to/announcement_42.html', '--input-text', 'raw text...'])
  ↓
live_test.py runs in background
```

### 3. Parser Generates HTML
```
live_test.py:
  1. Extract text from input
  2. Call Claude API (same system prompt as your original)
  3. Load shapefiles + AWC data
  4. Build interactive Leaflet map
  5. Write HTML to specified path
  6. Exit with code 0
```

### 4. Backend Detects Completion
```
Backend polls for HTML file creation
  ↓
Extracts district names from HTML
  ↓
Stores result URL in DB
```

### 5. SMS Alerts
```
Backend queries DB:
  "SELECT phone_number FROM captains WHERE tier='pro' AND regions @> ARRAY[...]"
  ↓
For each user: twilio.messages.create(...)
  ↓
Log delivery status
```

### 6. Website Shows Latest
```
GET /api/latest
  ↓
Frontend fetches and displays
  ↓
User clicks "View Full Map"
  ↓
Opens /results/announcement_42_12345.html
```

---

## live_test.py Integration

### What Changed
- **CLI args** — accepts `--announcement-id`, `--output`, `--input-text`
- **Error handling** — returns exit code 0 on success, 1 on fail
- **Path handling** — writes to whatever path you specify
- **Logging** — goes to stderr (Railway captures this)

### What Stayed the Same
- Claude API calls
- Shapefile loading
- AWC stream points
- HTML visualization template
- Parsing logic

### How to Use Locally
```bash
# Still works for testing
python3 live_test_server.py --pdf-path announcement.pdf --output test.html

# Or with text input
python3 live_test_server.py --input-text "announcement text..." --announcement-id 1 --output out.html
```

---

## Database Schema Changes

### New Tables
```sql
announcements (as before)
parsed_results (NEW)
  ├─ announcement_id
  ├─ html_filename
  ├─ html_url
  ├─ districts (TEXT[])
  └─ sms_sent

captains (NEW)
  ├─ email
  ├─ phone_number
  ├─ tier ('free' | 'pro')
  ├─ stripe_customer_id
  └─ subscription_active

sms_log (NEW)
  ├─ captain_id
  ├─ phone_number
  ├─ message
  ├─ status
  └─ twilio_sid
```

---

## API Endpoints

### Public
- `GET /` — Landing page
- `GET /signup.html` — Signup form
- `GET /success` — Post-payment redirect
- `GET /results/{filename}` — Serve generated HTML
- `GET /health` — Health check

### Webhooks
- `POST /webhooks/email` — Mailgun email ingestion
- `POST /webhooks/stripe` — Stripe subscription events

### API
- `POST /api/signup` — Create user + initiate Stripe checkout
- `GET /api/latest` — Get latest parsed result

---

## Deployment Checklist

**Before you deploy:**
- [ ] Fork/clone the files to a GitHub repo
- [ ] Create Railway account
- [ ] Create PostgreSQL database on Railway
- [ ] Get API keys (Anthropic, Mailgun, Stripe, Twilio)
- [ ] Add env vars to Railway
- [ ] Push to GitHub
- [ ] Railway auto-builds and deploys

**After deployment:**
- [ ] Test `/health` endpoint
- [ ] Send test email to Mailgun address
- [ ] Check Railway logs for errors
- [ ] Verify HTML was generated in `/public/results/`
- [ ] Test signup → Stripe payment
- [ ] Check captains table for new user
- [ ] (Optional) Test SMS if you have Twilio credit

---

## Cost Estimate

| Component | Cost |
|---|---|
| Railway (web + Postgres) | $5/mo |
| Anthropic API (10 announcements/day, 500 tokens each) | ~$3/mo |
| Mailgun | Free |
| Stripe | 2.9% + $0.30 per subscription |
| Twilio | $0.0075 per SMS |
| **Total for 10 users** | ~$50–80/mo |

---

## Important Notes

### Python in Production
Railway auto-detects `requirements.txt` and installs Python packages. Make sure it includes:
```
pdfplumber>=0.10.0
shapefile>=2.3.0
shapely>=2.0.0
anthropic>=0.25.0
```

### live_test.py Execution
The backend uses Node's `execFile()` to run Python. This means:
- Python 3 must be installed on Railway (it is, by default)
- live_test_server.py must be executable (`chmod +x live_test_server.py`)
- Path must be correct relative to `__dirname`

### Timeouts
If live_test.py takes >30 seconds, increase the timeout in backend_v2.js:
```javascript
timeout: 60000, // 60 seconds
```

### File Paths
The backend writes HTML to `public/results/`. Make sure:
- Directory exists (created via `fs.mkdir`)
- Files are persistent (Railway rebuilds don't delete `/public`)
- Web server serves from `public/` (Express static middleware)

---

## Next Steps After Launch

**Week 1:**
- ✓ Deploy backend
- ✓ Test email → HTML pipeline
- ✓ Test signup + payment
- ✓ Get first 5 users

**Week 2:**
- Improve HTML template (use original live_test.py's full styling)
- Add geospatial validation (PostGIS + Shapely)
- Add more districts/regions to signup form

**Week 3:**
- Monitor metrics (SMS delivery, user retention, cost)
- Iterate on messaging
- Scale infrastructure as needed

---

## Questions to Ask Yourself

1. **Do I need the full live_test.py visualization right away?**
   - Current version is minimal. Original had Leaflet + districts + closures.
   - You can enhance the HTML generation later.

2. **Do I need geospatial validation?**
   - Not required for MVP. Optional for Phase 2.
   - Right now: just parse districts + send SMS.

3. **Do I need multiple regions/districts?**
   - Currently set up for PWS only. Easy to expand.
   - Signup form can add checkboxes for other regions.

4. **How do I handle multiple announcements in one day?**
   - Each one gets its own HTML file + SMS.
   - Website shows latest. Old ones stay in `/results/` for history.

---

## Success Criteria

You'll know it's working when:

- [ ] Real ADF&G email → backend receives it
- [ ] Backend runs live_test.py → HTML generated in 5–10s
- [ ] HTML appears at `/results/announcement_X.html`
- [ ] Website `/api/latest` shows the new announcement
- [ ] User signs up + pays → added to DB with tier='pro'
- [ ] Next announcement → SMS sent to all pro users
- [ ] User clicks link in SMS → opens map in browser

That's your MVP. You're live. Scale from here.

---

## Support

**If something breaks:**

1. Check Railway logs first
2. Search for the error message
3. Verify env variables are set correctly
4. Test locally (live_test_server.py with --pdf-path)
5. Check database for data integrity

You've got this. Build fast, iterate, and get paying customers.
