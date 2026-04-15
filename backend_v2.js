/**
 * PWS Parser Backend v2 — Production Pipeline
 * 
 * Architecture:
 * Mailgun email (with PDF)
 *   ↓
 * /webhooks/email (extracts PDF, stores raw)
 *   ↓
 * Queue job: parse PDF with live_test.py
 *   ↓
 * live_test.py generates HTML artifact
 *   ↓
 * Store HTML in public/ folder + DB
 *   ↓
 * Send SMS to pro users
 *   ↓
 * Website displays HTML + handles signups
 */

const express = require('express');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const upload = multer({ dest: '/tmp/mailgun-uploads/' });

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const app = express();

// Database — defined early so the session store can use it
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Sessions backed by Postgres so they survive server restarts.
// maxAge is NOT set globally here — it is set per-login based on the
// "remember me" checkbox. Without maxAge the cookie is a browser-session
// cookie (cleared when the browser closes), which is the safe default.
app.use(session({
  store: new pgSession({
    pool: db,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport: serialize/deserialize by captain id
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM captains WHERE id = $1', [id]);
    done(null, result.rows[0] || false);
  } catch (err) {
    done(err);
  }
});

// Anthropic
const client = new Anthropic();

// Stripe + Twilio
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const twilio = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============================================================
// GOOGLE OAUTH
// ============================================================

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${BASE_URL}/auth/google/callback`,
}, async (_accessToken, _refreshToken, profile, done) => {
  try {
    const email    = profile.emails?.[0]?.value;
    const name     = profile.displayName;
    const googleId = profile.id;

    if (!email) return done(new Error('Google account has no email'));

    const admin = isAdminEmail(email);

    // 1. Look up by google_id (returning user)
    let result = await db.query('SELECT * FROM captains WHERE google_id = $1', [googleId]);

    if (result.rows.length === 0) {
      // 2. Existing account signed up manually — link it
      result = await db.query('SELECT * FROM captains WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        await db.query(
          'UPDATE captains SET google_id = $1, is_admin = $2, updated_at = NOW() WHERE id = $3',
          [googleId, admin, result.rows[0].id]
        );
        result.rows[0].google_id = googleId;
        result.rows[0].is_admin  = admin;
      } else {
        // 3. Brand-new user — create free-tier record
        result = await db.query(
          `INSERT INTO captains (email, name, google_id, tier, is_admin)
           VALUES ($1, $2, $3, 'free', $4) RETURNING *`,
          [email, name, googleId, admin]
        );
      }
    } else if (admin && !result.rows[0].is_admin) {
      // Sync admin flag if env var was added after account creation
      await db.query('UPDATE captains SET is_admin = true WHERE id = $1', [result.rows[0].id]);
      result.rows[0].is_admin = true;
    }

    return done(null, result.rows[0]);
  } catch (err) {
    return done(err);
  }
}));

// ── Helpers ──────────────────────────────────────────────────

function isAdminEmail(email) {
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

function isAlaskaGov(email) {
  return !!(email && email.toLowerCase().endsWith('@alaska.gov'));
}

/** True if this captain has active access (admin, alaska.gov, pro, or in-trial) */
function hasAccess(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  if (isAlaskaGov(user.email)) return true;
  if (user.tier === 'pro' && user.subscription_active) return true;
  if (user.trial_ends_at && new Date(user.trial_ends_at) > new Date()) return true;
  return false;
}

// ── Password hashing (no external deps — uses built-in crypto.scrypt) ──

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, key] = stored.split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex') === key);
    });
  });
}

// Start Google OAuth flow
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google redirects here after login
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => {
    // alaska.gov and admins skip the phone/trial setup entirely
    if (!req.user.phone_number && !isAlaskaGov(req.user.email) && !req.user.is_admin) {
      return res.redirect('/setup');
    }
    if (hasAccess(req.user)) return res.redirect('/app');
    res.redirect('/pricing');
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Current session user (used by frontend to show login state)
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const { id, email, name, tier, subscription_active, phone_number, trial_ends_at, is_admin, email_verified, google_id } = req.user;
  const trialActive = trial_ends_at && new Date(trial_ends_at) > new Date();
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;
  res.json({ user: { id, email, name, tier, subscription_active, phone_number,
                     trial_ends_at, trial_active: trialActive, trial_days_left: trialDaysLeft,
                     is_admin, email_verified: !!email_verified, has_google: !!google_id,
                     has_access: hasAccess(req.user) } });
});

// POST /api/setup — called from /setup page to save phone + determine next step
app.post('/api/setup', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'Phone number required' });

  const phone = phone_number.trim();

  // Admin or already subscribed → skip everything
  if (req.user.is_admin || (req.user.tier === 'pro' && req.user.subscription_active)) {
    await db.query('UPDATE captains SET phone_number = $1, updated_at = NOW() WHERE id = $2',
      [phone, req.user.id]);
    return res.json({ redirect: '/app' });
  }

  // Check if this phone number has already been used for a trial on ANY account
  const priorTrial = await db.query(
    'SELECT id FROM captains WHERE phone_number = $1 AND trial_ends_at IS NOT NULL AND id != $2',
    [phone, req.user.id]
  );
  const phoneAlreadyTrialed = priorTrial.rows.length > 0;

  let trialEndsAt = null;
  if (!phoneAlreadyTrialed) {
    trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  await db.query(
    `UPDATE captains SET phone_number = $1, trial_ends_at = $2, updated_at = NOW() WHERE id = $3`,
    [phone, trialEndsAt, req.user.id]
  );

  // Trial granted → go straight to the app
  if (trialEndsAt) {
    return res.json({
      redirect: '/app',
      trial: true,
      trial_days: 7,
    });
  }

  // No trial available → go to Stripe
  const stripeSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    mode: 'subscription',
    customer_email: req.user.email,
    success_url: `${BASE_URL}/success?captain_id=${req.user.id}`,
    cancel_url:  `${BASE_URL}/pricing`,
    metadata: { captain_id: req.user.id.toString() },
  });

  res.json({ redirect: stripeSession.url, trial: false });
});

// ── Email verification via Mailgun ────────────────────────────

async function sendVerificationEmail(email, token) {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;
  const domain = process.env.MAILGUN_DOMAIN;
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!domain || !apiKey) {
    console.warn('Mailgun not configured — skipping verification email');
    return;
  }

  const body = new URLSearchParams({
    from: `akFISHinfo <noreply@${domain}>`,
    to: email,
    subject: 'Verify your akFISHinfo email',
    text: `Click the link below to verify your email address:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Click the link below to verify your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
  }).toString();

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`api:${apiKey}`).toString('base64');
    const req = https.request(
      `https://api.mailgun.net/v3/${domain}/messages`,
      { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => { res.on('data', () => {}); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// POST /api/register — create account with email + password
app.post('/api/register', express.json(), async (req, res) => {
  const { name, email, password, remember_me } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = await db.query('SELECT id FROM captains WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  try {
    const hash  = await hashPassword(password);
    const admin = isAdminEmail(email);
    const verifyToken    = crypto.randomBytes(32).toString('hex');
    const verifyExpires  = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.query(
      `INSERT INTO captains (name, email, password_hash, tier, is_admin, email_verify_token, email_verify_expires)
       VALUES ($1, $2, $3, 'free', $4, $5, $6) RETURNING *`,
      [name.trim(), email.toLowerCase(), hash, admin, verifyToken, verifyExpires]
    );
    const user = result.rows[0];

    // Fire-and-forget verification email
    sendVerificationEmail(email.toLowerCase(), verifyToken).catch(e => console.error('Verify email send failed:', e));

    req.login(user, err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      if (remember_me) req.session.cookie.maxAge = THIRTY_DAYS;
      if (isAlaskaGov(user.email) || user.is_admin) return res.json({ redirect: '/app' });
      res.json({ redirect: '/setup' });
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// POST /api/login — sign in with email + password
app.post('/api/login', express.json(), async (req, res) => {
  const { email, password, remember_me } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await db.query('SELECT * FROM captains WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    req.login(user, err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      if (remember_me) req.session.cookie.maxAge = THIRTY_DAYS;
      if (!user.phone_number && !isAlaskaGov(user.email) && !user.is_admin) {
        return res.json({ redirect: '/setup' });
      }
      if (hasAccess(user)) return res.json({ redirect: '/app' });
      res.json({ redirect: '/pricing' });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

// GET /verify-email?token=...
app.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login?error=badtoken');
  try {
    const result = await db.query(
      `UPDATE captains
       SET email_verified = true, email_verify_token = NULL, email_verify_expires = NULL, updated_at = NOW()
       WHERE email_verify_token = $1 AND email_verify_expires > NOW()
       RETURNING id`,
      [token]
    );
    if (!result.rows.length) {
      return res.send(`<html><body style="font-family:sans-serif;text-align:center;margin-top:4em;background:#0d1117;color:#e6edf3">
        <h2>Link expired or invalid</h2><p><a href="/login" style="color:#58a6ff">Back to login</a></p></body></html>`);
    }
    // Refresh session user if this is their own token
    if (req.user && req.user.id === result.rows[0].id) {
      req.user.email_verified = true;
    }
    res.send(`<html><body style="font-family:sans-serif;text-align:center;margin-top:4em;background:#0d1117;color:#e6edf3">
      <h2 style="color:#27ae60">Email verified!</h2><p><a href="/app" style="color:#58a6ff">Open the app</a></p></body></html>`);
  } catch (err) {
    console.error('Verify email error:', err);
    res.redirect('/login?error=1');
  }
});

// POST /api/resend-verification — resend verification email
app.post('/api/resend-verification', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  if (req.user.email_verified) return res.json({ ok: true, message: 'Already verified.' });
  try {
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      `UPDATE captains SET email_verify_token = $1, email_verify_expires = $2 WHERE id = $3`,
      [token, expires, req.user.id]
    );
    await sendVerificationEmail(req.user.email, token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not resend.' });
  }
});

// ============================================================
// DATABASE INIT
// ============================================================

async function initDatabase() {
  try {
    // Raw announcements
    await db.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        raw_text TEXT,
        pdf_filename VARCHAR(255),
        pdf_data BYTEA,
        content_hash VARCHAR(64) UNIQUE,
        published_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        parsed BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_announcements_hash ON announcements(content_hash);
      CREATE INDEX IF NOT EXISTS idx_announcements_parsed ON announcements(parsed);
    `);

    // Parsed results (output from live_test.py)
    await db.query(`
      CREATE TABLE IF NOT EXISTS parsed_results (
        id SERIAL PRIMARY KEY,
        announcement_id INT REFERENCES announcements(id),

        -- HTML artifact
        html_filename VARCHAR(255),
        html_path VARCHAR(512),
        html_url VARCHAR(512),
        html_content TEXT,

        -- Parsed data
        districts TEXT[],
        parsed_json JSONB,

        -- Status
        parsed_at TIMESTAMPTZ DEFAULT NOW(),
        sms_sent BOOLEAN DEFAULT false,
        sms_sent_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_parsed_results_announcement ON parsed_results(announcement_id);
    `);
    // Add columns for existing DBs
    await db.query(`ALTER TABLE parsed_results ADD COLUMN IF NOT EXISTS html_content TEXT;`);
    await db.query(`ALTER TABLE parsed_results ADD COLUMN IF NOT EXISTS announcement_date DATE;`);
    await db.query(`ALTER TABLE parsed_results ADD COLUMN IF NOT EXISTS has_open_districts BOOLEAN DEFAULT false;`);
    await db.query(`ALTER TABLE parsed_results ADD COLUMN IF NOT EXISTS earliest_opens_at TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE parsed_results ADD COLUMN IF NOT EXISTS latest_closes_at TIMESTAMPTZ;`);

    // Users
    await db.query(`
      CREATE TABLE IF NOT EXISTS captains (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20),
        name VARCHAR(255),
        
        tier TEXT DEFAULT 'free', -- 'free' | 'pro'
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        subscription_active BOOLEAN DEFAULT false,
        subscription_ends_at TIMESTAMPTZ,
        
        regions TEXT[] DEFAULT ARRAY['PWS'],
        alerts_enabled BOOLEAN DEFAULT true,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_captains_email ON captains(email);
      CREATE INDEX IF NOT EXISTS idx_captains_tier ON captains(tier);
    `);

    // Password hash for email/password auth
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS password_hash TEXT;`);

    // Email verification
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS email_verify_token TEXT;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ;`);

    // Google OAuth + trial + admin columns
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_google_id
      ON captains(google_id) WHERE google_id IS NOT NULL;
    `);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;`);

    // SMS log
    await db.query(`
      CREATE TABLE IF NOT EXISTS sms_log (
        id SERIAL PRIMARY KEY,
        captain_id INT REFERENCES captains(id),
        phone_number VARCHAR(20),
        message TEXT,
        status TEXT,
        twilio_sid VARCHAR(255),
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sms_log_captain ON sms_log(captain_id);
    `);

    console.log('✓ Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
    process.exit(1);
  }
}

// ============================================================
// MAILGUN EMAIL WEBHOOK
// ============================================================

/**
 * POST /webhooks/email
 * Receives email from Mailgun, extracts PDF, queues parsing
 */
app.post('/webhooks/email', upload.any(), async (req, res) => {
  try {
    const subject = req.body.subject || '';
    const attachmentCount = parseInt(req.body['attachment-count'] || '0', 10);

    console.log(`📨 Email received — subject: "${subject}", attachments: ${attachmentCount}, files: ${req.files?.length || 0}`);

    // Find PDF attachment
    const pdfFile = req.files?.find(f =>
      f.mimetype === 'application/pdf' || f.originalname?.endsWith('.pdf')
    );

    if (!pdfFile) {
      console.warn('⚠ No PDF attachment found — skipping');
      return res.status(200).send('OK (no PDF)');
    }

    console.log(`📎 PDF found: ${pdfFile.originalname} (${pdfFile.size} bytes) at ${pdfFile.path}`);

    // Use PDF path as duplicate hash
    const pdfBuffer = await fs.readFile(pdfFile.path);
    const contentHash = crypto.createHash('md5').update(pdfBuffer).digest('hex');

    const existing = await db.query(
      'SELECT id FROM announcements WHERE content_hash = $1',
      [contentHash]
    );

    if (existing.rows.length > 0) {
      console.log(`📋 Duplicate announcement (hash: ${contentHash})`);
      await fs.unlink(pdfFile.path).catch(() => {});
      return res.status(200).send('OK (duplicate)');
    }

    // Store announcement record
    const result = await db.query(
      `INSERT INTO announcements (source, raw_text, content_hash, published_at, pdf_filename)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING id`,
      ['email', '', contentHash, pdfFile.originalname]
    );

    const announcementId = result.rows[0].id;
    console.log(`✓ Announcement #${announcementId} stored`);

    // Queue async parsing with the PDF path
    parseAnnouncementAsync(announcementId, pdfFile.path).catch(err => {
      console.error(`Error parsing announcement #${announcementId}:`, err);
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Internal error');
  }
});

// ============================================================
// PARSE WITH live_test.py
// ============================================================

/**
 * Run live_test.py on the announcement to generate HTML
 */
async function parseAnnouncementAsync(announcementId, pdfPath) {
  console.log(`🔄 Parsing announcement #${announcementId} from ${pdfPath}...`);

  try {
    const { htmlPath, districts, announcement_date, has_open, earliest_opens_at, latest_closes_at } = await runLiveTest(announcementId, pdfPath);

    // Read HTML content to store in DB (Railway filesystem is ephemeral)
    const htmlContent = await fs.readFile(htmlPath, 'utf8');
    const htmlFilename = path.basename(htmlPath);
    const htmlUrl = `/results/${htmlFilename}`;

    await db.query(
      `INSERT INTO parsed_results
         (announcement_id, html_filename, html_path, html_url, districts, html_content,
          announcement_date, has_open_districts, earliest_opens_at, latest_closes_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [announcementId, htmlFilename, htmlPath, htmlUrl, districts, htmlContent,
       announcement_date, has_open, earliest_opens_at, latest_closes_at]
    );

    console.log(`✓ Announcement #${announcementId} parsed → ${htmlUrl}`);

    // Mark announcement as parsed
    await db.query('UPDATE announcements SET parsed = true WHERE id = $1', [announcementId]);

    // Send SMS to pro users
    await alertProUsers(districts);
  } catch (err) {
    console.error(`Error in parseAnnouncementAsync:`, err);
  }
}

/**
 * Execute live_test.py to generate HTML
 * 
 * You'll need to modify live_test.py to:
 * 1. Accept input (PDF path or text)
 * 2. Output HTML to a specific location
 * 3. Return exit code 0 on success
 */
async function runLiveTest(announcementId, pdfPath) {
  return new Promise(async (resolve, reject) => {
    const timestamp = Date.now();
    const outputFilename = `announcement_${announcementId}_${timestamp}.html`;
    const outputPath = path.join(__dirname, 'public', 'results', outputFilename);

    await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(reject);

    execFile('python3', [
      'live_test_server.py',
      '--announcement-id', announcementId.toString(),
      '--output', outputPath,
      '--pdf-path', pdfPath,
    ], {
      cwd: __dirname,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    }, (error, stdout, stderr) => {
      console.log(`live_test_server.py stderr: ${stderr}`);
      if (error) {
        console.error(`live_test_server.py failed (exit ${error.code}): ${stderr}`);
        return reject(error);
      }
      let parsed = { districts: [], announcement_date: null, has_open: false, earliest_opens_at: null, latest_closes_at: null };
      try {
        const raw = JSON.parse(stdout.trim());
        if (Array.isArray(raw)) {
          parsed.districts = raw;
        } else {
          parsed = {
            districts:          raw.districts           || [],
            announcement_date:  raw.announcement_date   || null,
            has_open:           raw.has_open            || false,
            earliest_opens_at:  raw.earliest_opens_at   || null,
            latest_closes_at:   raw.latest_closes_at    || null,
          };
        }
      } catch (_) {}
      console.log(`Districts: ${parsed.districts.join(', ')} | Date: ${parsed.announcement_date} | Opens: ${parsed.earliest_opens_at}`);
      fs.stat(outputPath)
        .then(() => resolve({ htmlPath: outputPath, ...parsed }))
        .catch(reject);
    });
  });
}

/**
 * Extract district names from generated HTML (simple regex)
 * You can enhance this to parse the actual data
 */
function extractDistrictsFromHTML(htmlPath) {
  const htmlContent = require('fs').readFileSync(htmlPath, 'utf8');
  const districts = [];
  
  // Look for "class="district-card"" and extract district names
  const regex = /data-district="([^"]+)"/g;
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    if (!districts.includes(match[1])) {
      districts.push(match[1]);
    }
  }

  return districts.length > 0 ? districts : null;
}

// ============================================================
// SMS ALERTS
// ============================================================

/**
 * Send SMS to all pro users subscribed to open districts
 */
async function alertProUsers(districts) {
  if (!districts || districts.length === 0) {
    console.log('⚠ No districts to alert');
    return;
  }

  try {
    // Find pro users in these districts
    const captains = await db.query(
      `SELECT id, phone_number, name FROM captains
       WHERE tier = 'pro'
       AND subscription_active = true
       AND alerts_enabled = true
       AND (regions && $1 OR regions = ARRAY['PWS'])`,
      [districts]
    );

    if (captains.rows.length === 0) {
      console.log('📵 No pro users to alert');
      return;
    }

    const message = `⚓ ADF&G UPDATE — ${districts.join(', ')} — Check akfishinfo.com for details. Not legal advice — verify at adfg.alaska.gov`;

    for (const captain of captains.rows) {
      try {
        const sms = await twilio.messages.create({
          to: captain.phone_number,
          from: process.env.TWILIO_PHONE_NUMBER,
          body: message,
        });

        // Log send
        await db.query(
          `INSERT INTO sms_log (captain_id, phone_number, message, status, twilio_sid)
           VALUES ($1, $2, $3, $4, $5)`,
          [captain.id, captain.phone_number, message, 'sent', sms.sid]
        );

        console.log(`✓ SMS sent to ${captain.name} (${captain.phone_number})`);
      } catch (err) {
        await db.query(
          `INSERT INTO sms_log (captain_id, phone_number, message, status, error_message)
           VALUES ($1, $2, $3, $4, $5)`,
          [captain.id, captain.phone_number, message, 'failed', err.message]
        );

        console.error(`❌ SMS failed for ${captain.phone_number}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Error in alertProUsers:', err);
  }
}

// ============================================================
// USER SIGNUP & SUBSCRIPTION
// ============================================================

/**
 * POST /api/signup
 * Create user and initiate Stripe checkout
 */
app.post('/api/signup', express.json(), async (req, res) => {
  try {
    const { name, email, phone_number, regions, alerts_enabled } = req.body;

    if (!email || !phone_number) {
      return res.status(400).json({ error: 'Email and phone required' });
    }

    // Check if exists
    const existing = await db.query('SELECT id FROM captains WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already signed up' });
    }

    // Create captain (free tier initially)
    const captain = await db.query(
      `INSERT INTO captains (name, email, phone_number, regions, alerts_enabled, tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, email, phone_number, regions || ['PWS'], alerts_enabled, 'free']
    );

    const captainId = captain.rows[0].id;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${BASE_URL}/success?captain_id=${captainId}`,
      cancel_url: `${BASE_URL}/pricing`,
      metadata: { captain_id: captainId.toString() },
    });

    res.json({ stripe_session_url: session.url });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /success
 * After payment, upgrade user to pro
 */
app.get('/success', async (req, res) => {
  const { captain_id } = req.query;
  if (!captain_id) {
    return res.status(400).send('Missing captain_id');
  }

  try {
    await db.query(
      `UPDATE captains SET tier = $1, subscription_active = true WHERE id = $2`,
      ['pro', captain_id]
    );

    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 2em;">
          <h1>✓ Payment successful!</h1>
          <p>Your SMS alerts are now active.</p>
          <a href="/">Return to map</a>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error updating account');
  }
});

/**
 * POST /webhooks/stripe
 * Handle subscription events
 */
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature failed:', err);
    return res.status(400).send('Webhook error');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const captainId = session.metadata?.captain_id;

        if (captainId) {
          await db.query(
            `UPDATE captains 
             SET stripe_customer_id = $1, tier = $2, subscription_active = true
             WHERE id = $3`,
            [session.customer, 'pro', captainId]
          );
          console.log(`✓ Captain #${captainId} upgraded to pro`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await db.query(
          `UPDATE captains 
           SET tier = $1, subscription_active = false
           WHERE stripe_customer_id = $2`,
          ['free', subscription.customer]
        );
        console.log(`⚠️ Subscription cancelled`);
        break;
      }

      default:
        break;
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).send('Error processing webhook');
  }
});

// ============================================================
// API ENDPOINTS
// ============================================================

/**
 * GET /api/latest
 * Get latest parsed result (for homepage display)
 */
app.get('/api/latest', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, announcement_id, html_url, districts, parsed_at
       FROM parsed_results
       ORDER BY parsed_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ latest: null });
    }

    res.json({ latest: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/results/live
 * Currently active, today's, or upcoming (within 48h) announcements.
 * - Openings that close within the last 12h (still relevant)
 * - Openings that haven't started yet but start within 48h
 * - Fallback: announcement_date = today or tomorrow (AKDT)
 */
app.get('/api/results/live', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, announcement_id, html_url, districts, parsed_at,
              announcement_date, has_open_districts, earliest_opens_at, latest_closes_at
       FROM parsed_results
       WHERE
         -- Opening window not yet fully past (allow 12h grace after close)
         (latest_closes_at IS NOT NULL AND latest_closes_at >= NOW() - INTERVAL '12 hours')
         -- Upcoming with known open time (within 48h)
         OR (earliest_opens_at IS NOT NULL AND earliest_opens_at <= NOW() + INTERVAL '48 hours' AND (latest_closes_at IS NULL OR latest_closes_at >= NOW()))
         -- Fallback: announcement date is today or tomorrow in AKDT
         OR announcement_date = (NOW() AT TIME ZONE 'America/Anchorage')::date
         OR announcement_date = ((NOW() AT TIME ZONE 'America/Anchorage') + INTERVAL '1 day')::date
       ORDER BY
         COALESCE(earliest_opens_at, parsed_at) DESC
       LIMIT 10`
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/results/all
 * All results sorted by announcement_date DESC (for old tab)
 */
app.get('/api/results/all', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, announcement_id, html_url, districts, parsed_at,
              announcement_date, has_open_districts, earliest_opens_at, latest_closes_at
       FROM parsed_results
       ORDER BY announcement_date DESC NULLS LAST, parsed_at DESC`
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/result/:id/html
 * Serve stored HTML content from DB
 */
app.get('/api/result/:id/html', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT html_content FROM parsed_results WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length || !result.rows[0].html_content) {
      return res.status(404).send('Not found');
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(result.rows[0].html_content);
  } catch (err) {
    res.status(500).send('Error');
  }
});

/**
 * POST /api/result/:id/reparse
 * Force re-run live_test_server.py on the original PDF for this result.
 * Updates html_content in DB with freshly generated HTML.
 */
app.post('/api/result/:id/reparse', express.json(), async (req, res) => {
  try {
    // Get the announcement_id from the parsed result
    const prRow = await db.query(
      `SELECT announcement_id FROM parsed_results WHERE id = $1`,
      [req.params.id]
    );
    if (!prRow.rows.length) return res.status(404).json({ error: 'Result not found' });

    const announcementId = prRow.rows[0].announcement_id;

    // Get the PDF data from announcements table
    const annRow = await db.query(
      `SELECT pdf_data, pdf_filename, raw_text FROM announcements WHERE id = $1`,
      [announcementId]
    );
    if (!annRow.rows.length) return res.status(404).json({ error: 'Announcement not found' });

    const ann = annRow.rows[0];
    let pdfPath = null;

    if (ann.pdf_data) {
      // Write PDF to temp file
      pdfPath = path.join('/tmp', `reparse_${announcementId}_${Date.now()}.pdf`);
      await fs.writeFile(pdfPath, ann.pdf_data);
    } else if (ann.raw_text) {
      // Use raw text directly via --input-text
      pdfPath = null;
    } else {
      return res.status(400).json({ error: 'No PDF or text available for this announcement' });
    }

    res.json({ ok: true, message: `Reparsing announcement #${announcementId} in background...` });

    // Run reparse async
    (async () => {
      try {
        const timestamp = Date.now();
        const outputFilename = `announcement_${announcementId}_${timestamp}.html`;
        const outputPath = path.join(__dirname, 'public', 'results', outputFilename);
        await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => {});

        const args = ['live_test_server.py', '--announcement-id', announcementId.toString(), '--output', outputPath];
        if (pdfPath) {
          args.push('--pdf-path', pdfPath);
        } else {
          args.push('--input-text', ann.raw_text);
        }

        const { execFile: ef } = require('child_process');
        await new Promise((resolve, reject) => {
          ef('python3', args, { cwd: __dirname, timeout: 180000, maxBuffer: 1024 * 1024 * 20 },
            async (error, stdout, stderr) => {
              console.log(`reparse stderr: ${stderr}`);
              if (error) { console.error(`reparse failed: ${stderr}`); return reject(error); }
              try {
                const htmlContent = await fs.readFile(outputPath, 'utf8');
                await db.query(
                  `UPDATE parsed_results SET html_content = $1, html_filename = $2, html_url = $3 WHERE id = $4`,
                  [htmlContent, outputFilename, `/results/${outputFilename}`, req.params.id]
                );
                console.log(`✓ Reparse complete for result #${req.params.id}`);
              } catch (e) { console.error('reparse DB update failed:', e); }
              resolve();
            }
          );
        });
        if (pdfPath) await fs.unlink(pdfPath).catch(() => {});
      } catch (e) { console.error('Reparse error:', e); }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /results/:filename
 * Serve generated HTML artifacts
 */
app.use('/results', express.static(path.join(__dirname, 'public', 'results')));

/**
 * GET /account
 * Account details page — requires login
 */
app.get('/account', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

/**
 * PATCH /api/account — update name and/or password
 */
app.patch('/api/account', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  const { name, current_password, new_password } = req.body;
  const updates = [];
  const vals    = [];

  if (name && name.trim()) {
    vals.push(name.trim());
    updates.push(`name = $${vals.length}`);
  }

  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'Current password required to set a new one.' });
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (!req.user.password_hash) return res.status(400).json({ error: 'Account uses Google sign-in; password cannot be set here.' });
    const ok = await verifyPassword(current_password, req.user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await hashPassword(new_password);
    vals.push(hash);
    updates.push(`password_hash = $${vals.length}`);
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

  vals.push(req.user.id);
  await db.query(
    `UPDATE captains SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
    vals
  );
  res.json({ ok: true });
});

/**
 * GET /login
 * Redirect already-authenticated users, otherwise serve login page
 */
app.get('/login', (req, res) => {
  if (req.user) return res.redirect(hasAccess(req.user) ? '/app' : '/setup');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/**
 * GET /signup  +  GET /signup.html
 * Old signup route — redirect everything to the Google OAuth login
 */
app.get(['/signup', '/signup.html'], (_req, res) => {
  res.redirect('/login');
});

/**
 * GET /app
 * The main map/results interface — requires login + active access
 */
app.get('/app', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (!hasAccess(req.user)) return res.redirect('/pricing');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

/**
 * GET /setup
 * Only accessible when logged in — redirect to login otherwise
 */
app.get('/setup', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.phone_number) {
    return res.redirect(hasAccess(req.user) ? '/app' : '/pricing');
  }
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

/**
 * GET /pricing
 * Redirect unauthenticated users to login first
 */
app.get('/pricing', (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  next(); // serve pricing.html if it exists
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STARTUP
// ============================================================

async function start() {
  console.log('ENV KEYS:', Object.keys(process.env).join(', '));
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);

  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`\n🚀 PWS Parser running on port ${PORT}`);
      console.log(`📧 Email webhook: POST /webhooks/email`);
      console.log(`💳 Signup: POST /api/signup`);
      console.log(`🗂️ Results: GET /results/{filename}`);
      console.log(`✅ Health: GET /health\n`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
