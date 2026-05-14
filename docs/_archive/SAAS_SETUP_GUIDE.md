# PWS SaaS Pipeline Setup — Complete Guide

**Architecture:**
```
ADF&G Email
  ↓ (Mailgun webhook)
POST /webhooks/email
  ↓
Store announcement in Postgres
  ↓
Queue: run live_test.py
  ↓ (Claude parsing)
live_test.py generates HTML
  ↓
Store HTML URL + districts in DB
  ↓
alertProUsers() → send SMS
  ↓
Website displays latest HTML + signup form
```

---

## Step 1: Prepare Your Repository

```bash
mkdir pws-saas
cd pws-saas
git init
```

**Add these files:**
- `backend_v2.js` (your Node.js server)
- `live_test_server.py` (your parser service)
- `public/index.html` (website landing page)
- `public/signup.html` (signup form)
- `package.json` (Node dependencies)
- `requirements.txt` (Python dependencies)
- `.gitignore`
- `Procfile` (Railway multi-process)

**package.json:**
```json
{
  "name": "pws-saas",
  "version": "1.0.0",
  "description": "PWS Salmon Fishing SaaS",
  "main": "backend_v2.js",
  "scripts": {
    "start": "node backend_v2.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.0",
    "@anthropic-ai/sdk": "^0.10.0",
    "stripe": "^14.0.0",
    "twilio": "^4.0.0"
  },
  "engines": {
    "node": "18"
  }
}
```

**requirements.txt:**
```
pdfplumber>=0.10.0
shapefile>=2.3.0
shapely>=2.0.0
anthropic>=0.25.0
```

**Procfile:**
```
web: node backend_v2.js
```

**.gitignore:**
```
node_modules/
*.env
.DS_Store
api.env
public/results/*.html
```

Push to GitHub:
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

---

## Step 2: Deploy to Railway

### 2a. Create Railway Account
- railway.app → Sign up with GitHub

### 2b. Create Project
- Railway Dashboard → "New Project" → "Deploy from GitHub repo"
- Select your pws-saas repo
- Railway auto-detects Node.js, installs dependencies, builds

### 2c. Add PostgreSQL
- Project → "New" → "PostgreSQL"
- Railway auto-injects `DATABASE_URL`

### 2d. Environment Variables
Go to Project → "Variables" and add:

```
ANTHROPIC_API_KEY=sk-ant-...
MAILGUN_WEBHOOK_SECRET=...
MAILGUN_INBOUND_EMAIL=alerts@yourdomain.com

STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1-907-555-5555

BASE_URL=https://your-railway-app.railway.app
```

Railway redeploys with new env vars automatically.

---

## Step 3: Configure Mailgun

### 3a. Mailgun Setup
- mailgun.com → Sign up
- Get API key (private key)

### 3b. Create Inbound Route
**Routes** → **Create Route**:
- Filter: (leave blank, or use `recipients(alerts@yourdomain.com)`)
- Action: Forward To: `https://your-railway-app.railway.app/webhooks/email`
- Store message: Yes
- Webhook secret: (copy this → add to Railway as `MAILGUN_WEBHOOK_SECRET`)

### 3c. Subscribe to ADF&G Email List
- adfg.alaska.gov → PWS commercial fisheries email list
- Sign up with your Mailgun inbound address

---

## Step 4: Configure Stripe

### 4a. Stripe Setup
- stripe.com → Dashboard
- Get **Publishable Key** and **Secret Key**
- Products → Create → "PWS Pro (Monthly)" → $15/month
- Copy **Price ID** → add to Railway as `STRIPE_PRICE_ID`

### 4b. Webhook
- **Developers** → **Webhooks** → Add endpoint
- Endpoint: `https://your-railway-app.railway.app/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.deleted`
- Copy signing secret → add to Railway as `STRIPE_WEBHOOK_SECRET`

---

## Step 5: Configure Twilio

### 5a. Twilio Setup
- twilio.com → Console
- Get **Account SID** and **Auth Token**
- Phone Numbers → Buy number (e.g., +1-907-555-5555)

### 5b. Add to Railway Env
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1-907-555-5555
```

---

## Step 6: Important — Python Dependencies

**Railway doesn't auto-install Python packages.** You need to add a `runtime.txt` and `requirements.txt`:

**runtime.txt:**
```
python-3.11.0
```

**requirements.txt:** (add more if needed)
```
pdfplumber>=0.10.0
shapefile>=2.3.0
shapely>=2.0.0
anthropic>=0.25.0
```

Railway will install these automatically.

---

## Step 7: Test the Pipeline

### 7a. Health Check
```bash
curl https://your-railway-app.railway.app/health
# Response: {"ok":true}
```

### 7b. Send Test Email
Forward a real ADF&G announcement to your Mailgun inbound address:
```
To: alerts@yourdomain.com
Subject: Test
Body: [paste announcement text]
```

Check Railway logs:
```
✓ Announcement #1 stored
🔄 Parsing announcement #1...
✓ HTML generated → /results/announcement_1_12345.html
✓ SMS sent to 5 users
```

### 7c. Verify Signup Works
1. Go to `https://your-railway-app.railway.app/signup.html`
2. Fill form, click "Continue to Payment"
3. Use Stripe test card: `4242 4242 4242 4242`
4. Should create user in DB + upgrade to pro tier

### 7d. Check Database
```bash
psql -d yourdb -c "SELECT email, tier FROM captains LIMIT 10;"
```

---

## Step 8: Create Proper Website

**public/index.html** (landing page):
```html
<!DOCTYPE html>
<html>
<head>
    <title>AK Fish Info — PWS Alerts</title>
    <style>
        body { font-family: sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; }
        .latest { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        button { background: #667eea; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚓ PWS Salmon Fishing Alerts</h1>
        <p>Get SMS notifications when announcements are released.</p>
        
        <button onclick="location.href='/signup.html'">Sign Up Free</button>
        <p><small>Pro: $15/month for SMS alerts</small></p>
        
        <div class="latest" id="latest">
            <h2>Latest Announcement</h2>
            <p id="loading">Loading...</p>
        </div>
    </div>

    <script>
        async function loadLatest() {
            try {
                const resp = await fetch('/api/latest');
                const data = await resp.json();
                if (!data.latest) {
                    document.getElementById('loading').textContent = 'No announcements yet.';
                    return;
                }
                const { districts, html_url, parsed_at } = data.latest;
                document.getElementById('loading').innerHTML = `
                    <strong>Districts:</strong> ${districts.join(', ')}<br>
                    <strong>Parsed:</strong> ${new Date(parsed_at).toLocaleString()}<br>
                    <a href="${html_url}" target="_blank">View Full Map →</a>
                `;
            } catch (err) {
                document.getElementById('loading').textContent = 'Error loading data.';
            }
        }
        loadLatest();
        setInterval(loadLatest, 30000); // Refresh every 30s
    </script>
</body>
</html>
```

**public/signup.html** (already in the backend code, adjust as needed):
```html
<!DOCTYPE html>
<html>
<head>
    <title>Sign Up — AK Fish Info</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 2em auto; padding: 20px; }
        form { background: #f5f5f5; padding: 2em; border-radius: 8px; }
        label { display: block; margin-top: 1em; font-weight: bold; }
        input, select { width: 100%; padding: 0.5em; margin-top: 0.5em; font-size: 1em; }
        button { background: #667eea; color: white; padding: 1em 2em; margin-top: 2em; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; }
        .error { color: red; margin-top: 0.5em; }
    </style>
</head>
<body>
    <h1>Sign Up for SMS Alerts</h1>
    
    <form id="signupForm">
        <label>Name <input type="text" name="name" required></label>
        <label>Email <input type="email" name="email" required></label>
        <label>Phone <input type="tel" name="phone_number" placeholder="+1-907-555-0123" required></label>
        <label><input type="checkbox" name="alerts_enabled" checked> Subscribe to SMS alerts</label>
        <button type="submit">Continue to Payment →</button>
        <div id="error" class="error"></div>
    </form>

    <script>
        document.getElementById('signupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                name: formData.get('name'),
                email: formData.get('email'),
                phone_number: formData.get('phone_number'),
                alerts_enabled: formData.get('alerts_enabled') === 'on'
            };
            try {
                const resp = await fetch('/api/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!resp.ok) throw new Error(await resp.text());
                const { stripe_session_url } = await resp.json();
                window.location.href = stripe_session_url;
            } catch (err) {
                document.getElementById('error').textContent = err.message;
            }
        });
    </script>
</body>
</html>
```

---

## Step 9: Deployment Checklist

- [ ] Repo pushed to GitHub with all files
- [ ] Railway project created and connected
- [ ] PostgreSQL added to Railway
- [ ] All env variables set in Railway
- [ ] Health check passes (`/health`)
- [ ] Mailgun inbound route configured
- [ ] Stripe webhook configured
- [ ] Test email sent → check logs
- [ ] Test signup → check database
- [ ] HTML generated and served at `/results/{filename}`
- [ ] SMS sent to pro users ✓

---

## Step 10: Monitoring

**Check logs:**
```
Railway Dashboard → Project → Deployments → Latest → Logs
```

**Check database:**
```bash
# Connected users
psql -d yourdb -c "SELECT COUNT(*) FROM captains WHERE tier='pro';"

# Latest announcements
psql -d yourdb -c "SELECT id, districts, parsed_at FROM parsed_results ORDER BY parsed_at DESC LIMIT 5;"

# SMS delivery status
psql -d yourdb -c "SELECT phone_number, status, created_at FROM sms_log ORDER BY created_at DESC LIMIT 10;"
```

---

## Costs

| Service | Cost |
|---|---|
| Railway (web + db) | $5–10/mo |
| Anthropic (Claude) | ~$2–5/mo |
| Mailgun | Free (1000 emails/mo) |
| Stripe | 2.9% + $0.30/transaction |
| Twilio | $0.0075/SMS |
| **Total (10 users, 100 SMS/mo)** | ~$50–80/mo |

---

## Next Steps

1. ✓ Get email → HTML generation working
2. ✓ Get signup/payment working
3. ✓ Get SMS alerts working
4. Later: Improve HTML visualization (use your original live_test.py template)
5. Later: Add geospatial validation
6. Later: Add more districts/features

You're building the MVP. Everything else is polish.

---

## Troubleshooting

**Email not arriving?**
- Check Mailgun logs (Routes → View logs)
- Verify inbound email subscribed to ADF&G list

**live_test.py not running?**
- Check Python version: `python3 --version`
- Check Claude API key in env vars
- Run locally first: `python3 live_test_server.py --input-text "test" --output test.html`

**SMS not sending?**
- Check Twilio logs (console.twilio.com)
- Verify phone number format: `+1-907-555-5555`
- Check sms_log table for errors

**HTML not generated?**
- Check `/public/results/` directory exists
- Check Railway logs for live_test.py errors
- Increase `execFile` timeout if parsing is slow

---

You're live. The basic pipeline works. Scale from here.
