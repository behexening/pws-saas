# PWS SaaS v1 — Folder Structure & Setup

## Exact Folder Layout

```
pws-saas/                          ← Root folder (your GitHub repo)
│
├── backend_v2.js                  ← Main Node.js server
├── package.json                   ← Node dependencies
├── requirements.txt               ← Python dependencies
├── runtime.txt                    ← Python version for Railway
├── Procfile                       ← Railway multi-process config
├── README.md                      ← Project overview
├── .gitignore                     ← What NOT to commit
│
├── live_test_server.py            ← Your hosted parser
│
├── public/                        ← Frontend files (served by Express)
│   ├── index.html                 ← Landing page
│   ├── signup.html                ← Signup form
│   └── results/                   ← Generated HTML maps (created at runtime)
│
├── docs/                          ← Documentation
│   ├── SAAS_SETUP_GUIDE.md
│   └── SAAS_SUMMARY.md
│
└── data/                          ← Reference data (PUSH THIS)
    ├── PWS_Districts_2024/
    │   ├── districts.shp
    │   ├── districts.shx
    │   ├── districts.dbf
    │   └── districts.prj
    ├── PWS_Subdistricts_2024/
    │   ├── subdistricts.shp
    │   ├── subdistricts.shx
    │   ├── subdistricts.dbf
    │   └── subdistricts.prj
    ├── PWS_StatisticalAreas_2024/
    │   ├── stat_areas.shp
    │   ├── stat_areas.shx
    │   ├── stat_areas.dbf
    │   └── stat_areas.prj
    └── 2025PWSAWC/
        └── scn_point.shp.kmz
```

---

## Step-by-Step Setup

### 1. Create Root Directory
```bash
mkdir pws-saas
cd pws-saas
git init
```

### 2. Download & Place Files

From outputs folder, copy:
- `backend_v2.js` → root
- `live_test_server.py` → root

### 3. Create package.json

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

### 4. Create requirements.txt

```
pdfplumber>=0.10.0
shapefile>=2.3.0
shapely>=2.0.0
anthropic>=0.25.0
```

### 5. Create runtime.txt

```
python-3.11.0
```

### 6. Create Procfile

```
web: node backend_v2.js
```

### 7. Create .gitignore

```
node_modules/
__pycache__/
*.pyc
.env
.env.local
api.env
.DS_Store
public/results/*.html
testing_parsers/
annotated/
*.log
```

### 8. Create public folder structure

```bash
mkdir -p public/results
```

Create `public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AK Fish Info — PWS Salmon Alerts</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 3rem; border-radius: 8px; text-align: center; margin-bottom: 2rem; }
        .header h1 { font-size: 2.5em; margin-bottom: 0.5rem; }
        .cta-section { background: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        button { background: #667eea; color: white; padding: 12px 30px; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; font-weight: 600; }
        button:hover { background: #5568d3; }
        .latest-section { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        #latest-content { font-size: 1.1em; line-height: 1.6; color: #666; }
        .disclaimer { background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 1rem; border-radius: 4px; margin-top: 2rem; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚓ AK Fish Info</h1>
            <p>Real-time PWS Salmon Fishing Alerts</p>
        </div>

        <div class="cta-section">
            <h2>Get SMS Alerts When Announcements Drop</h2>
            <p style="margin-bottom: 1.5rem;">Free to view the map. $15/month for SMS notifications.</p>
            <button onclick="location.href='/signup.html'">Sign Up Free</button>
        </div>

        <div class="latest-section">
            <h2>Latest Announcement</h2>
            <div id="latest-content">Loading...</div>
        </div>

        <div class="disclaimer">
            <strong>⚠️ Disclaimer:</strong> Always verify with ADF&G at (907) 424-3212 or adfg.alaska.gov
        </div>
    </div>

    <script>
        async function loadLatest() {
            try {
                const resp = await fetch('/api/latest');
                const data = await resp.json();
                if (!data.latest) {
                    document.getElementById('latest-content').innerHTML = 'No announcements yet.';
                    return;
                }
                const { districts, html_url, parsed_at } = data.latest;
                document.getElementById('latest-content').innerHTML = `
                    <p><strong>Districts:</strong> ${districts.join(', ')}</p>
                    <p><strong>Parsed:</strong> ${new Date(parsed_at).toLocaleString()}</p>
                    <p><a href="${html_url}" target="_blank">→ View Interactive Map</a></p>
                `;
            } catch (err) {
                document.getElementById('latest-content').innerHTML = 'Error loading data.';
            }
        }
        loadLatest();
        setInterval(loadLatest, 30000);
    </script>
</body>
</html>
```

Create `public/signup.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up — AK Fish Info</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .form-box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h1 { margin-bottom: 2rem; color: #333; text-align: center; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; font-weight: 600; color: #333; margin-bottom: 0.5rem; }
        input, select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; }
        input:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1); }
        button { width: 100%; background: #667eea; color: white; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; font-weight: 600; }
        button:hover { background: #5568d3; }
        .error { color: #e74c3c; margin-top: 1rem; padding: 1rem; background: #fadbd8; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="form-box">
            <h1>Sign Up for SMS Alerts</h1>
            
            <form id="signupForm">
                <div class="form-group">
                    <label>Name *<input type="text" name="name" required></label>
                </div>
                <div class="form-group">
                    <label>Email *<input type="email" name="email" required></label>
                </div>
                <div class="form-group">
                    <label>Phone *<input type="tel" name="phone_number" placeholder="+1-907-555-0123" required></label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" name="alerts_enabled" checked> Subscribe to SMS alerts ($15/month)</label>
                </div>
                <button type="submit">Continue to Payment →</button>
                <div id="error" class="error" style="display: none;"></div>
            </form>
        </div>
    </div>

    <script>
        document.getElementById('signupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorDiv = document.getElementById('error');
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
                if (!resp.ok) throw new Error('Signup failed');
                const { stripe_session_url } = await resp.json();
                window.location.href = stripe_session_url;
            } catch (err) {
                errorDiv.textContent = '❌ ' + err.message;
                errorDiv.style.display = 'block';
            }
        });
    </script>
</body>
</html>
```

### 9. Create docs folder

```bash
mkdir docs
cp SAAS_SETUP_GUIDE.md docs/
cp SAAS_SUMMARY.md docs/
```

### 10. Copy your data folder

```bash
cp -r /your/path/to/data ./data
```

### 11. Create README.md

```markdown
# AK Fish Info — PWS Salmon Fishing Alerts

Real-time SMS alerts when ADF&G releases announcements.

## Quick Start

See `docs/SAAS_SETUP_GUIDE.md` for complete setup.

## Tech Stack

- Node.js + Express
- PostgreSQL
- Python (Claude parser)
- Mailgun, Stripe, Twilio
- Railway hosting

## Cost

~$50–80/mo for 10 users.
```

---

## Before Pushing to Git

```bash
# Verify structure
ls -la
# Should see: backend_v2.js, live_test_server.py, package.json, etc.

# Install Node deps (optional, for local testing)
npm install

# Check Python syntax
python3 -m py_compile live_test_server.py

# Check git status
git status
# Should NOT show: .env, node_modules, .DS_Store, api.env

# Commit everything
git add .
git commit -m "Initial commit: PWS SaaS v1"

# Create GitHub repo, then:
git remote add origin https://github.com/yourusername/pws-saas.git
git branch -M main
git push -u origin main
```

---

## What Gets Pushed

✅ Pushed:
- All `.js`, `.py`, `.html` files
- `package.json`, `requirements.txt`, `Procfile`, `runtime.txt`
- `data/` folder (all shapefiles)
- `docs/` markdown files
- `README.md`
- `.gitignore`

❌ NOT pushed (in .gitignore):
- `.env`, `.env.local`, `api.env`
- `node_modules/`
- `public/results/*.html` (generated)
- `.DS_Store`
- Anything with `*.log`

---

That's it. Once you push, Railway can deploy it.
