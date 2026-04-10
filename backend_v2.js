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
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

// ============================================================
// CONFIG
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
app.post('/webhooks/email', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    // Verify Mailgun signature
    if (process.env.MAILGUN_WEBHOOK_SECRET) {
      const timestamp = req.body.timestamp;
      const token = req.body.token;
      const signature = req.body.signature;

      const expectedSig = crypto
        .createHmac('sha256', process.env.MAILGUN_WEBHOOK_SECRET)
        .update(timestamp + token)
        .digest('hex');

      if (signature !== expectedSig) {
        console.warn('⚠ Invalid Mailgun signature');
        return res.status(401).send('Unauthorized');
      }
    } else {
      console.warn('⚠ MAILGUN_WEBHOOK_SECRET not set — skipping signature check');
    }

    // Extract subject and body
    const subject = req.body.subject || '';
    const rawText = req.body['body-plain'] || req.body['body-html'] || '';

    // Check if this is an ADF&G announcement
    if (!rawText.includes('Prince William Sound') && !rawText.includes('Announcement')) {
      return res.status(200).send('OK (not a PWS announcement)');
    }

    // Hash content to detect duplicates
    const contentHash = crypto.createHash('md5').update(rawText).digest('hex');

    // Check for existing
    const existing = await db.query(
      'SELECT id FROM announcements WHERE content_hash = $1',
      [contentHash]
    );

    if (existing.rows.length > 0) {
      console.log(`📋 Duplicate announcement (hash: ${contentHash})`);
      return res.status(200).send('OK (duplicate)');
    }

    // Extract PDF from Mailgun (if present)
    let pdfData = null;
    let pdfFilename = null;

    // Mailgun stores attachments — retrieve via API
    // For now, we'll store raw text; you can enhance to fetch PDF from Mailgun's storage
    
    // Insert announcement
    const result = await db.query(
      `INSERT INTO announcements (source, raw_text, content_hash, published_at, pdf_filename)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING id`,
      ['email', rawText, contentHash, pdfFilename]
    );

    const announcementId = result.rows[0].id;
    console.log(`✓ Announcement #${announcementId} stored`);

    // Queue async parsing
    parseAnnouncementAsync(announcementId, rawText).catch(err => {
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
async function parseAnnouncementAsync(announcementId, rawText) {
  console.log(`🔄 Parsing announcement #${announcementId}...`);

  try {
    // Write raw text to temp PDF file (you'll have the actual PDF from Mailgun)
    // For now, we're working with text; enhance later to handle actual PDF

    // Run live_test.py with the announcement text as input
    // You'll need to modify live_test.py to accept stdin or file input
    const htmlPath = await runLiveTest(announcementId, rawText);

    if (!htmlPath) {
      console.error(`❌ live_test.py failed for announcement #${announcementId}`);
      return;
    }

    // Extract districts from HTML (parse via regex or cheerio)
    const districts = extractDistrictsFromHTML(htmlPath);

    // Store result in DB
    const htmlFilename = path.basename(htmlPath);
    const htmlUrl = `${BASE_URL}/results/${htmlFilename}`;

    await db.query(
      `INSERT INTO parsed_results (announcement_id, html_filename, html_path, html_url, districts)
       VALUES ($1, $2, $3, $4, $5)`,
      [announcementId, htmlFilename, htmlPath, htmlUrl, districts]
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
async function runLiveTest(announcementId, rawText) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const outputFilename = `announcement_${announcementId}_${timestamp}.html`;
    const outputPath = path.join(__dirname, 'public', 'results', outputFilename);

    // Ensure output directory exists
    fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(reject);

    // Call live_test.py with announcement ID and output path
    execFile('python3', [
      'live_test_server.py',
      '--announcement-id', announcementId.toString(),
      '--output', outputPath,
      '--input-text', rawText,
    ], {
      cwd: __dirname,
      timeout: 30000, // 30s timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`live_test.py error: ${stderr}`);
        return reject(error);
      }

      console.log(`live_test.py output: ${stdout}`);

      // Check if HTML file was created
      fs.stat(outputPath).then(() => {
        resolve(outputPath);
      }).catch(reject);
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
 * GET /results/:filename
 * Serve generated HTML artifacts
 */
app.use('/results', express.static(path.join(__dirname, 'public', 'results')));

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
