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
const helmet = require('helmet');
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
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const TRUSTED_SENDER_DOMAINS = ['@adfg.alaska.gov', '@alaska.gov'];
const EXTRA_ALLOWED_SENDERS = (process.env.EXTRA_ALLOWED_SENDERS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const upload = multer({
  dest: '/tmp/mailgun-uploads/',
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
});

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "unpkg.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "unpkg.com"],
      imgSrc:     ["'self'", "data:", "blob:", "*.basemaps.cartocdn.com"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'", "data:"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
}));

// Database — defined early so the session store can use it
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Sessions backed by Postgres so they survive server restarts.
// maxAge is NOT set globally here — it is set per-login based on the
// "remember me" checkbox. Without maxAge the cookie is a browser-session
// cookie (cleared when the browser closes), which is the safe default.
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set');
  process.exit(1);
}

app.use(session({
  store: new pgSession({
    pool: db,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: (process.env.BASE_URL || '').startsWith('https://'),
    httpOnly: true,
    sameSite: 'lax',
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

// Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Telegram bot — single bot DMs every captain. See docs/plans/plan-telegram-delivery.md.
const TELEGRAM_BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME   = process.env.TELEGRAM_BOT_USERNAME || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;
const TELEGRAM_LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000;

async function sendTelegramMessage(chatId, text, opts = {}) {
  if (!TELEGRAM_API) {
    console.warn('TELEGRAM_BOT_TOKEN not set — skipping send');
    return { ok: false, error: 'not_configured' };
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parse_mode || 'HTML',
        disable_web_page_preview: opts.disable_web_page_preview !== false,
      }),
    });
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.description || `tg_${res.status}` };
    return { ok: true, message_id: json.result.message_id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function generateLinkCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function telegramDeepLink(code) {
  if (!TELEGRAM_BOT_USERNAME) return null;
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`;
}

// ── Pricing / plan configuration ────────────────────────────
// Two parallel price ladders in Stripe: early-adopter (first 30 paying captains)
// and standard. Price IDs resolved lazily so missing env vars fail loudly at
// checkout time rather than at boot.
const EARLY_ADOPTER_SEAT_LIMIT = 30;
const PLAN_SLUGS = ['biweekly', 'monthly', 'season'];

function priceIdFor(plan, isEarlyAdopter) {
  const table = {
    biweekly: { ea: process.env.STRIPE_PRICE_EA_BIWEEKLY, std: process.env.STRIPE_PRICE_BIWEEKLY },
    monthly:  { ea: process.env.STRIPE_PRICE_EA_MONTHLY,  std: process.env.STRIPE_PRICE_MONTHLY  },
    season:   { ea: process.env.STRIPE_PRICE_EA_SEASON,   std: process.env.STRIPE_PRICE_SEASON   },
  };
  const row = table[plan];
  if (!row) return null;
  const picked = isEarlyAdopter ? row.ea : row.std;
  // Fall back to the legacy single-price env var so the boot doesn't break
  // if the new env vars haven't been set yet.
  return picked || process.env.STRIPE_PRICE_ID || null;
}

function planFromPriceId(priceId) {
  if (!priceId) return null;
  for (const slug of PLAN_SLUGS) {
    if (priceId === priceIdFor(slug, true) || priceId === priceIdFor(slug, false)) return slug;
  }
  return null;
}

function isEarlyAdopterPriceId(priceId) {
  if (!priceId) return false;
  return priceId === process.env.STRIPE_PRICE_EA_BIWEEKLY
      || priceId === process.env.STRIPE_PRICE_EA_MONTHLY
      || priceId === process.env.STRIPE_PRICE_EA_SEASON;
}

async function earlyAdopterSeatsLeft() {
  const r = await db.query(
    `SELECT COUNT(*)::int AS count FROM captains WHERE is_early_adopter = true AND subscription_active = true`
  );
  return Math.max(0, EARLY_ADOPTER_SEAT_LIMIT - r.rows[0].count);
}

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
      // 2. Existing account signed up manually — link it. Google has proven
      // they own the address, so flip email_verified too.
      result = await db.query('SELECT * FROM captains WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        await db.query(
          `UPDATE captains
           SET google_id = $1, is_admin = $2, email_verified = true,
               updated_at = NOW()
           WHERE id = $3`,
          [googleId, admin, result.rows[0].id]
        );
        result.rows[0].google_id      = googleId;
        result.rows[0].is_admin       = admin;
        result.rows[0].email_verified = true;
      } else {
        // 3. Brand-new user — create free-tier record. Google OAuth = email
        // already verified, so don't make them click a verification link.
        const preApprovedBeta = await hasApprovedBetaRequest(email.toLowerCase());
        result = await db.query(
          `INSERT INTO captains (email, name, google_id, tier, is_admin, email_verified, beta_access)
           VALUES ($1, $2, $3, 'free', $4, true, $5) RETURNING *`,
          [email, name, googleId, admin, preApprovedBeta]
        );
        if (preApprovedBeta) {
          await linkApprovedBetaRequestToCaptain(email.toLowerCase(), result.rows[0].id);
        }
      }
      // Existing captain matched on email: also flip beta_access if pre-approved.
      if (result.rows.length > 0 && !result.rows[0].beta_access) {
        const pre = await hasApprovedBetaRequest(email.toLowerCase());
        if (pre) {
          await db.query(
            `UPDATE captains SET beta_access = true, updated_at = NOW() WHERE id = $1`,
            [result.rows[0].id]
          );
          await linkApprovedBetaRequestToCaptain(email.toLowerCase(), result.rows[0].id);
          result.rows[0].beta_access = true;
        }
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

// ============================================================
// SIGN IN WITH APPLE (native iOS path)
// ============================================================
// The iOS app uses @capacitor-community/apple-sign-in to drive Apple's
// AuthenticationServices flow natively, then POSTs the result to
// /api/auth/apple/native. We verify the identityToken against Apple's
// JWKS server-side — never trust the client-supplied `user`/`email`
// fields without that check.

const APPLE_TEAM_ID    = process.env.APPLE_TEAM_ID;
const APPLE_BUNDLE_ID  = process.env.APPLE_BUNDLE_ID  || 'info.akfish.app';
const APPLE_SERVICE_ID = process.env.APPLE_SERVICE_ID || 'info.akfish.web';

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

async function verifyAppleIdentityToken(identityToken, expectedNonceHash) {
  // Accept either the bundle ID (native) or the Service ID (web/Android) as audience.
  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: [APPLE_BUNDLE_ID, APPLE_SERVICE_ID],
  });
  if (expectedNonceHash && payload.nonce !== expectedNonceHash) {
    throw new Error('Nonce mismatch — possible token replay.');
  }
  if (!payload.sub) throw new Error('Apple token missing sub claim.');
  return payload;
}

// ── Helpers ──────────────────────────────────────────────────

function isAdminEmail(email) {
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

// Beta testers — same access as pro tier, but NOT admin. Now stored as
// captains.beta_access (admin-toggleable from the /admin page). The legacy
// BETA_TESTERS env var is backfilled into the column at startup so any
// emails set there before this migration still get access without manual work.
const BETA_TESTERS = (process.env.BETA_TESTERS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function isBetaTester(user) {
  if (!user) return false;
  if (user.beta_access === true) return true;
  // Env var fallback covers the brief window between deploy and DB backfill,
  // and also any captain row not yet written when an env-listed user first hits hasAccess().
  return !!(user.email && BETA_TESTERS.includes(user.email.toLowerCase()));
}

// Returns true if there's an approved beta_request for this email but no
// captain has been linked yet. Used at signup time to auto-grant access.
async function hasApprovedBetaRequest(email) {
  if (!email) return false;
  try {
    const r = await db.query(
      `SELECT 1 FROM beta_requests
        WHERE LOWER(email) = LOWER($1) AND status = 'approved'
        LIMIT 1`,
      [email]
    );
    return r.rows.length > 0;
  } catch (err) {
    console.error('hasApprovedBetaRequest error:', err);
    return false;
  }
}

async function linkApprovedBetaRequestToCaptain(email, captainId) {
  try {
    await db.query(
      `UPDATE beta_requests SET captain_id = $2
        WHERE LOWER(email) = LOWER($1) AND status = 'approved' AND captain_id IS NULL`,
      [email, captainId]
    );
  } catch (err) {
    console.error('linkApprovedBetaRequestToCaptain error:', err);
  }
}

function isAlaskaGov(email) {
  return !!(email && email.toLowerCase().endsWith('@alaska.gov'));
}

// Express middleware: 403 unless the request belongs to an admin captain.
function requireAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.is_admin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

/** True if this captain has active access (admin, beta, alaska.gov, pro, or in-trial) */
function hasAccess(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  if (isBetaTester(user)) return true;
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
      else {
        try {
          resolve(crypto.timingSafeEqual(derived, Buffer.from(key, 'hex')));
        } catch {
          resolve(false);
        }
      }
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
    req.session.cookie.maxAge = THIRTY_DAYS;
    // alaska.gov and admins skip the link/trial setup entirely.
    // Everyone else lands on /setup if they haven't linked Telegram yet.
    if (!req.user.telegram_chat_id && !isAlaskaGov(req.user.email) && !req.user.is_admin) {
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

// ============================================================
// Sign in with Apple — native iOS path
// ============================================================
// POST /api/auth/apple/native
//   body: { identityToken, authorizationCode?, user?, email?, fullName?, nonce? }
//
//   - identityToken: JWT issued by Apple — REQUIRED, verified server-side
//   - email + fullName: Apple sends these ONLY on the first sign-in for a
//     given Apple ID + App ID. We persist them on first auth; subsequent
//     calls won't include them.
//   - nonce (optional): if the client generated one and SHA-256 hashed it,
//     pass the original here so we can check the `nonce` claim matches.
//
// Response mirrors /api/login: { redirect } on success, { error } on failure.
app.post('/api/auth/apple/native', authLimiter, express.json(), async (req, res) => {
  const { identityToken, email: bodyEmail, fullName, nonce } = req.body || {};
  if (!identityToken) {
    return res.status(400).json({ error: 'Missing identityToken.' });
  }

  try {
    // SHA-256 hash the supplied nonce to match Apple's `nonce` claim format.
    let expectedNonceHash;
    if (nonce) {
      expectedNonceHash = crypto.createHash('sha256').update(nonce).digest('hex');
    }

    const payload = await verifyAppleIdentityToken(identityToken, expectedNonceHash);

    const appleSub = payload.sub;
    // Email may live in the JWT (verified) OR only in the request body (first
    // sign-in). Prefer the JWT-verified one when present.
    const email = (payload.email || bodyEmail || '').toLowerCase() || null;
    const name = fullName
      ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim() || null
      : null;
    const admin = email ? isAdminEmail(email) : false;

    // 1. Look up by apple_user_id (returning user)
    let result = await db.query('SELECT * FROM captains WHERE apple_user_id = $1', [appleSub]);

    if (result.rows.length === 0 && email) {
      // 2. Existing account on the same email — link Apple ID to it.
      // Apple proved they own this address (email_verified claim is true unless
      // it's a relay address, which we treat the same since Apple controls it).
      result = await db.query('SELECT * FROM captains WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        await db.query(
          `UPDATE captains
           SET apple_user_id = $1, is_admin = $2, email_verified = true, updated_at = NOW()
           WHERE id = $3`,
          [appleSub, admin, result.rows[0].id]
        );
        result.rows[0].apple_user_id = appleSub;
        result.rows[0].is_admin = admin;
        result.rows[0].email_verified = true;
      }
    }

    if (result.rows.length === 0) {
      // 3. Brand-new captain — create. We must have an email (either from
      // the JWT or from the request body on first sign-in).
      if (!email) {
        return res.status(400).json({
          error: 'Apple did not provide an email on first sign-in. Try signing in again.',
        });
      }
      const preApprovedBeta = await hasApprovedBetaRequest(email);
      result = await db.query(
        `INSERT INTO captains (email, name, apple_user_id, tier, is_admin, email_verified, beta_access)
         VALUES ($1, $2, $3, 'free', $4, true, $5) RETURNING *`,
        [email, name, appleSub, admin, preApprovedBeta]
      );
      if (preApprovedBeta) {
        await linkApprovedBetaRequestToCaptain(email, result.rows[0].id);
      }
    } else if (admin && !result.rows[0].is_admin) {
      await db.query('UPDATE captains SET is_admin = true WHERE id = $1', [result.rows[0].id]);
      result.rows[0].is_admin = true;
    }

    const user = result.rows[0];
    req.login(user, (err) => {
      if (err) {
        console.error('SIWA req.login error:', err);
        return res.status(500).json({ error: 'Session error.' });
      }
      req.session.cookie.maxAge = THIRTY_DAYS;
      // Native clients skip the Telegram link gate entirely — alerts arrive
      // via push (Phase 2.4). Mirror the X-Client native trial-gate logic.
      const isNativeClient = /^native-(ios|android)$/.test(req.get('X-Client') || '');
      if (isNativeClient) {
        if (hasAccess(user)) return res.json({ redirect: '/app', user });
        return res.json({ redirect: '/setup', user });
      }
      // Web path (Service ID flow) — same conditions as Google callback.
      if (!user.telegram_chat_id && !isAlaskaGov(user.email) && !user.is_admin) {
        return res.json({ redirect: '/setup', user });
      }
      if (hasAccess(user)) return res.json({ redirect: '/app', user });
      res.json({ redirect: '/pricing', user });
    });
  } catch (err) {
    console.error('SIWA verify failed:', err.message);
    return res.status(401).json({ error: 'Apple sign-in verification failed.' });
  }
});

// Current session user (used by frontend to show login state)
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const { id, email, name, tier, subscription_active, trial_ends_at,
          is_admin, email_verified, google_id, plan_slug, is_early_adopter,
          subscription_status, stripe_current_period_end, cancel_at_period_end,
          stripe_customer_id, telegram_chat_id, telegram_username } = req.user;
  const trialActive = trial_ends_at && new Date(trial_ends_at) > new Date();
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;
  res.json({ user: { id, email, name, tier, subscription_active,
                     trial_ends_at, trial_active: trialActive, trial_days_left: trialDaysLeft,
                     is_admin, email_verified: !!email_verified, has_google: !!google_id,
                     plan_slug, is_early_adopter: !!is_early_adopter,
                     subscription_status, stripe_current_period_end, cancel_at_period_end,
                     has_billing: !!stripe_customer_id,
                     telegram_linked: !!telegram_chat_id,
                     telegram_username: telegram_username || null,
                     has_access: hasAccess(req.user) } });
});

// POST /api/billing/portal — open Stripe customer portal for self-serve billing
app.post('/api/billing/portal', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  if (!req.user.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account on file.' });
  }
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${BASE_URL}/account`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('billing portal error:', err);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// GET /api/early-adopter-spots — returns remaining early adopter seats
app.get('/api/early-adopter-spots', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS count FROM captains
       WHERE is_early_adopter = true AND subscription_active = true`
    );
    const taken = r.rows[0].count;
    const total = EARLY_ADOPTER_SEAT_LIMIT;
    const spots_left = Math.max(0, total - taken);
    res.json({
      spots_left,
      total,
      taken,
      early_adopter_active: spots_left > 0,
      prices: {
        biweekly: { early_adopter: 30,  standard: 50  },
        monthly:  { early_adopter: 50,  standard: 84  },
        season:   { early_adopter: 240, standard: 400 },
      },
    });
  } catch (err) {
    console.error('early-adopter-spots error:', err);
    res.status(500).json({ error: 'Could not fetch spot count' });
  }
});

// POST /api/setup — decides next step after signup.
//   intent='trial'     → grant 7-day trial. On web: requires email verified + telegram
//                        linked + that chat_id never used for a prior trial.
//                        On native (X-Client: native-ios/native-android): requires only
//                        email verified — alerts arrive via push, not Telegram.
//   intent='subscribe' → create Stripe Checkout session for the chosen plan
// Telegram linkage itself is captured via POST /api/telegram/link-code + the bot.
app.post('/api/setup', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  const isNativeClient = /^native-(ios|android)$/.test(req.get('X-Client') || '');

  try {
    const intent = req.body.intent || (req.body.grant_trial ? 'trial' : 'subscribe');
    const plan = req.body.plan;

    if (intent === 'trial') {
      if (!req.user.email_verified) {
        return res.status(400).json({ error: 'Please verify your email address before starting a trial. Check your inbox for a verification link.' });
      }
      if (!isNativeClient) {
        if (!req.user.telegram_chat_id) {
          return res.status(400).json({ error: 'Link your Telegram account first so we can deliver alerts.' });
        }
        const priorTrial = await db.query(
          `SELECT id FROM captains
           WHERE telegram_chat_id = $1
           AND trial_ends_at IS NOT NULL
           AND id != $2`,
          [req.user.telegram_chat_id, req.user.id]
        );
        if (priorTrial.rows.length > 0) {
          return res.status(400).json({ error: 'This Telegram account has already been used for a trial. Please subscribe to continue.' });
        }
      }
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query('UPDATE captains SET trial_ends_at = $1, updated_at = NOW() WHERE id = $2',
        [trialEndsAt, req.user.id]);
      return res.json({ redirect: '/app', trial: true, trial_days: 7 });
    }

    // Subscribe path: resolve plan + early-adopter pricing, then create checkout.
    const chosenPlan = PLAN_SLUGS.includes(plan) ? plan : 'monthly';
    const seatsLeft = await earlyAdopterSeatsLeft();
    const isEarlyAdopter = seatsLeft > 0;
    const priceId = priceIdFor(chosenPlan, isEarlyAdopter);
    if (!priceId) {
      console.error(`No Stripe price configured for plan=${chosenPlan} ea=${isEarlyAdopter}`);
      return res.status(500).json({ error: 'Billing is temporarily unavailable. Please try again later.' });
    }

    const checkoutParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      allow_promotion_codes: true,
      client_reference_id: req.user.id.toString(),
      success_url: `${BASE_URL}/success?captain_id=${req.user.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE_URL}/pricing`,
      metadata: {
        captain_id: req.user.id.toString(),
        plan: chosenPlan,
        is_early_adopter: isEarlyAdopter ? 'true' : 'false',
      },
      subscription_data: {
        metadata: {
          captain_id: req.user.id.toString(),
          plan: chosenPlan,
          is_early_adopter: isEarlyAdopter ? 'true' : 'false',
        },
      },
    };
    if (req.user.stripe_customer_id) {
      checkoutParams.customer = req.user.stripe_customer_id;
    } else {
      checkoutParams.customer_email = req.user.email;
    }

    const stripeSession = await stripe.checkout.sessions.create(checkoutParams);
    return res.json({ redirect: stripeSession.url, trial: false, plan: chosenPlan, is_early_adopter: isEarlyAdopter });
  } catch (err) {
    console.error('POST /api/setup error:', err);
    res.status(500).json({ error: 'Setup failed. Please try again.' });
  }
});

// ── Telegram linking ──────────────────────────────────────────

// POST /api/telegram/link-code
// Returns the captain's active 6-digit link code (mints a new one if missing/expired).
// Idempotent: calling repeatedly returns the same code until expiry.
app.post('/api/telegram/link-code', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    if (req.user.telegram_chat_id) {
      return res.json({ already_linked: true, telegram_username: req.user.telegram_username });
    }
    let code = req.user.telegram_link_code;
    const expiresAt = req.user.telegram_link_code_expires_at
      ? new Date(req.user.telegram_link_code_expires_at) : null;
    if (!code || !expiresAt || expiresAt < new Date()) {
      // Mint a new unique code (collisions are rare but possible — retry a few times).
      for (let i = 0; i < 5; i++) {
        const candidate = generateLinkCode();
        const conflict = await db.query(
          'SELECT id FROM captains WHERE telegram_link_code = $1 AND id != $2',
          [candidate, req.user.id]
        );
        if (conflict.rows.length === 0) { code = candidate; break; }
      }
      const newExpiry = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS);
      await db.query(
        `UPDATE captains SET telegram_link_code = $1, telegram_link_code_expires_at = $2,
                              updated_at = NOW() WHERE id = $3`,
        [code, newExpiry, req.user.id]
      );
      return res.json({
        code,
        bot_username: TELEGRAM_BOT_USERNAME,
        deep_link: telegramDeepLink(code),
        expires_at: newExpiry.toISOString(),
      });
    }
    return res.json({
      code,
      bot_username: TELEGRAM_BOT_USERNAME,
      deep_link: telegramDeepLink(code),
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('POST /api/telegram/link-code error:', err);
    res.status(500).json({ error: 'Could not generate link code.' });
  }
});

// POST /api/telegram/regenerate — invalidate current code and mint a new one.
app.post('/api/telegram/regenerate', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    if (req.user.telegram_chat_id) {
      return res.status(400).json({ error: 'Telegram is already linked. Unlink first if you want to re-link.' });
    }
    await db.query(
      `UPDATE captains SET telegram_link_code = NULL, telegram_link_code_expires_at = NULL,
                            updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );
    // Force re-issue by calling the link-code endpoint logic inline.
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = generateLinkCode();
      const conflict = await db.query(
        'SELECT id FROM captains WHERE telegram_link_code = $1 AND id != $2',
        [candidate, req.user.id]
      );
      if (conflict.rows.length === 0) { code = candidate; break; }
    }
    const newExpiry = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS);
    await db.query(
      `UPDATE captains SET telegram_link_code = $1, telegram_link_code_expires_at = $2,
                            updated_at = NOW() WHERE id = $3`,
      [code, newExpiry, req.user.id]
    );
    res.json({
      code,
      bot_username: TELEGRAM_BOT_USERNAME,
      deep_link: telegramDeepLink(code),
      expires_at: newExpiry.toISOString(),
    });
  } catch (err) {
    console.error('POST /api/telegram/regenerate error:', err);
    res.status(500).json({ error: 'Could not regenerate code.' });
  }
});

// POST /api/feedback — beta tester feedback from the web widget.
app.post('/api/feedback', express.json(), async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  if (!hasAccess(req.user)) {
    return res.status(403).json({ error: 'no_access' });
  }
  const { body, category } = req.body || {};
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'body_required' });
  }
  if (body.trim().length > 2000) {
    return res.status(400).json({ error: 'too_long' });
  }
  try {
    await db.query(
      `INSERT INTO feedback (captain_id, source, category, body)
       VALUES ($1, 'web', $2, $3)`,
      [req.user.id, category || null, body.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/feedback error:', err);
    res.status(500).json({ error: 'Could not save feedback.' });
  }
});

// Public beta-request page is reachable via QR codes at harbors. Cap
// submissions per IP to keep the table clean; scan pings get a looser
// cap. Declared here (rather than next to authLimiter) because both
// routes that consume them are registered immediately below and `const`
// is in the temporal dead zone until evaluated.
const betaRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
const qrScanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// POST /api/qr-scan — public, fired on /request-beta page load to track
// how many people scan QR codes at each port even if they don't submit.
app.post('/api/qr-scan', qrScanLimiter, express.json(), async (req, res) => {
  try {
    const source = normalizeBetaSource(req.body?.source);
    const ua = (req.get('user-agent') || '').slice(0, 500);
    await db.query(
      `INSERT INTO qr_scans (source, ip, user_agent) VALUES ($1, $2, $3)`,
      [source, req.ip || null, ua]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/qr-scan error:', err);
    res.status(500).json({ error: 'scan_log_failed' });
  }
});

// POST /api/beta-request — public submission from the /request-beta page.
// Captures email + name + source (port from QR), DMs admins on Telegram.
app.post('/api/beta-request', betaRequestLimiter, express.json(), async (req, res) => {
  const { email, name, source } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanName  = typeof name  === 'string' ? name.trim().slice(0, 120) : '';
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'email_invalid' });
  }
  const src = normalizeBetaSource(source);
  const ua  = (req.get('user-agent') || '').slice(0, 500);
  try {
    // If this email already has access (admin / @alaska.gov / existing beta),
    // shortcut so they know to just sign in.
    const existing = await db.query(
      `SELECT id, beta_access, is_admin FROM captains WHERE LOWER(email) = $1`,
      [cleanEmail]
    );
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      if (u.is_admin || u.beta_access) {
        return res.json({ ok: true, already_has_access: true });
      }
    }
    const ins = await db.query(
      `INSERT INTO beta_requests (email, name, source, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cleanEmail, cleanName || null, src, req.ip || null, ua]
    );
    const requestId = ins.rows[0].id;
    // Fire-and-forget admin DM
    notifyAdminsOfBetaRequest({ name: cleanName, email: cleanEmail, source: src, requestId })
      .catch(err => console.error('beta-request admin DM failed:', err));
    res.json({ ok: true, request_id: requestId });
  } catch (err) {
    console.error('POST /api/beta-request error:', err);
    res.status(500).json({ error: 'submit_failed' });
  }
});

// POST /api/telegram/unlink — disconnect Telegram from this captain.
app.post('/api/telegram/unlink', express.json(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    await db.query(
      `UPDATE captains SET telegram_chat_id = NULL, telegram_username = NULL,
                            telegram_linked_at = NULL, updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/telegram/unlink error:', err);
    res.status(500).json({ error: 'Could not unlink.' });
  }
});

// POST /webhooks/telegram — receives bot updates.
// Auth via Telegram's secret-token header (set in setWebhook).
app.post('/webhooks/telegram', express.json(), async (req, res) => {
  if (TELEGRAM_WEBHOOK_SECRET) {
    const got = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (got !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).send('bad secret');
    }
  }
  // Always 200 quickly — process async so retries don't pile up.
  res.status(200).send('ok');
  try {
    await processTelegramUpdate(req.body);
  } catch (err) {
    console.error('Telegram update error:', err);
  }
});

async function processTelegramUpdate(update) {
  const msg = update && update.message;
  if (!msg || !msg.text || !msg.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const username = msg.from.username || '';

  // /start <code>  → link
  const startMatch = text.match(/^\/start(?:@\S+)?(?:\s+(\d{6}))?\s*$/i);
  if (startMatch) {
    const code = startMatch[1];
    if (!code) {
      await sendTelegramMessage(chatId,
        `Hi! To link your akFISHinfo account, paste your 6-digit code here (e.g. <code>123456</code>) ` +
        `or tap the "Open Telegram" button on the akfishinfo.com setup page.`);
      return;
    }
    return linkChatToCaptain(chatId, code, username);
  }

  // Bare 6-digit code as a fallback (in case the user pastes it)
  const codeOnly = text.match(/^(\d{6})$/);
  if (codeOnly) {
    return linkChatToCaptain(chatId, codeOnly[1], username);
  }

  // /status
  if (/^\/status(?:@\S+)?\s*$/i.test(text)) {
    const r = await db.query(
      'SELECT email, name FROM captains WHERE telegram_chat_id = $1',
      [chatId]
    );
    if (r.rows.length === 0) {
      await sendTelegramMessage(chatId,
        `Not linked. Sign in at akfishinfo.com and paste your 6-digit code here.`);
    } else {
      await sendTelegramMessage(chatId,
        `Linked to <b>${escapeHtml(r.rows[0].email)}</b>. You'll get alerts when openings are announced.`);
    }
    return;
  }

  // /unlink
  if (/^\/unlink(?:@\S+)?\s*$/i.test(text)) {
    const r = await db.query(
      `UPDATE captains SET telegram_chat_id = NULL, telegram_username = NULL,
                            telegram_linked_at = NULL, updated_at = NOW()
       WHERE telegram_chat_id = $1 RETURNING email`,
      [chatId]
    );
    if (r.rows.length === 0) {
      await sendTelegramMessage(chatId, `You weren't linked. Nothing to do.`);
    } else {
      await sendTelegramMessage(chatId,
        `Unlinked. You won't get alerts here anymore. Re-link any time at akfishinfo.com/account.`);
    }
    return;
  }

  // /help and free-text
  if (/^\/help(?:@\S+)?\s*$/i.test(text)) {
    await sendTelegramMessage(chatId,
      `<b>Commands</b>\n` +
      `/start &lt;code&gt; — link your akFISHinfo account\n` +
      `/status — check link status\n` +
      `/unlink — disconnect this Telegram\n` +
      `/feedback &lt;message&gt; — send feedback or report a bug\n\n` +
      `Visit akfishinfo.com/account for billing and settings.`);
    return;
  }

  // /feedback <message>
  if (/^\/feedback(?:@\S+)?(?:\s|$)/i.test(text)) {
    const body = text.replace(/^\/feedback(?:@\S+)?\s*/i, '').trim();
    if (!body) {
      await sendTelegramMessage(chatId,
        `Usage: <code>/feedback your message here</code>\n\nSend any feedback, bug report, or suggestion.`);
      return;
    }
    const r = await db.query(
      'SELECT id FROM captains WHERE telegram_chat_id = $1', [chatId]);
    const captainId = r.rows[0]?.id || null;
    await db.query(
      `INSERT INTO feedback (captain_id, source, body) VALUES ($1, 'telegram', $2)`,
      [captainId, body.slice(0, 2000)]
    );
    await sendTelegramMessage(chatId, `Feedback received. Thank you.`);
    return;
  }

  // Anything else — placeholder until the Haiku help bot ships.
  await sendTelegramMessage(chatId,
    `I can't answer questions yet — that's coming soon. For help, visit akfishinfo.com or use /help.`);
}

async function linkChatToCaptain(chatId, code, username) {
  // Look up captain by code
  const r = await db.query(
    `SELECT id, email, telegram_chat_id, telegram_link_code_expires_at
       FROM captains WHERE telegram_link_code = $1`,
    [code]
  );
  if (r.rows.length === 0) {
    await sendTelegramMessage(chatId,
      `That code isn't valid. Go to akfishinfo.com/setup or /account to get a fresh one.`);
    return;
  }
  const captain = r.rows[0];
  const expiresAt = captain.telegram_link_code_expires_at
    ? new Date(captain.telegram_link_code_expires_at) : null;
  // Expired codes are still honored when the captain hasn't linked yet — codes are
  // cleared on successful link, so a matching-but-stale code means "still waiting."
  // This keeps long-dormant deep links working (e.g. tester opened email next day).
  if ((!expiresAt || expiresAt < new Date()) && captain.telegram_chat_id) {
    await sendTelegramMessage(chatId,
      `That code has expired. Get a fresh one at akfishinfo.com/setup or /account.`);
    return;
  }
  // Refuse if this chat is already linked to a different captain (anti-meta-gaming).
  const existing = await db.query(
    'SELECT id, email FROM captains WHERE telegram_chat_id = $1',
    [chatId]
  );
  if (existing.rows.length > 0 && existing.rows[0].id !== captain.id) {
    await sendTelegramMessage(chatId,
      `This Telegram is already linked to a different akFISHinfo account ` +
      `(<b>${escapeHtml(existing.rows[0].email)}</b>). Unlink from that account first.`);
    return;
  }
  try {
    await db.query(
      `UPDATE captains
       SET telegram_chat_id = $1, telegram_username = $2,
           telegram_linked_at = NOW(),
           telegram_link_code = NULL, telegram_link_code_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $3`,
      [chatId, username || null, captain.id]
    );
  } catch (err) {
    if (err.code === '23505') {
      await sendTelegramMessage(chatId,
        `This Telegram is already linked to another account. Unlink there first.`);
      return;
    }
    throw err;
  }
  await sendTelegramMessage(chatId,
    `<b>You're signed up.</b>\n` +
    `Linked to <b>${escapeHtml(captain.email)}</b>.\n\n` +
    `<b>What happens next</b>\n` +
    `Every time ADF&amp;G publishes a PWS commercial salmon opening, ` +
    `I'll DM you here with:\n` +
    `• Which districts are open\n` +
    `• When the opening starts and ends (AKDT)\n` +
    `• Gear types and any subdistrict/hatchery exclusions\n` +
    `• A tap-through link to the live map at akfishinfo.com/app\n\n` +
    `<b>Commands</b>\n` +
    `/status — confirm you're still linked\n` +
    `/unlink — stop receiving alerts\n` +
    `/help — list these again\n\n` +
    `<i>Alerts are informational only — verify the official notice at adfg.alaska.gov before fishing.</i>`);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

// Generic Mailgun sender used by transactional emails other than verification.
// Returns { ok, statusCode, body, mailgun_id, domain } so callers can surface
// the result (the old version threw away the response body, which made it
// impossible to tell whether the API actually accepted the message).
async function sendMailgun({ to, subject, text, html }) {
  const domain = process.env.MAILGUN_DOMAIN;
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!domain || !apiKey) {
    console.warn('Mailgun not configured — skipping email to', to);
    return { ok: false, statusCode: 0, body: 'mailgun_not_configured', domain };
  }
  const body = new URLSearchParams({
    from: `akFISHinfo <noreply@${domain}>`,
    'h:Reply-To': 'admin@akfishinfo.com',
    to, subject, text, html,
  }).toString();
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.mailgun.net/v3/${domain}/messages`,
      { method: 'POST', headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      }},
      res => {
        let chunks = '';
        res.on('data', c => { chunks += c; });
        res.on('end', () => {
          let mailgunId = null;
          try { mailgunId = JSON.parse(chunks).id || null; } catch {}
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            console.error(`Mailgun ${res.statusCode} sending to ${to} via ${domain}:`, chunks);
          } else {
            console.log(`Mailgun ${res.statusCode} sent to ${to} via ${domain} (id=${mailgunId})`);
          }
          resolve({ ok, statusCode: res.statusCode, body: chunks, mailgun_id: mailgunId, domain });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// HTML email sent when an admin approves a beta request. Mirrors the
// site's dark theme + accent. Uses tables and inline styles so it renders
// in Gmail, iOS Mail, Outlook, etc. — no @font-face, no external CSS.
function renderBetaApprovalEmail({ requesterEmail, signupUrl }) {
  const e = escapeHtml;
  const text =
    `You've been accepted into the akFISHinfo beta.\n\n` +
    `Get started: ${signupUrl}\n\n` +
    `Two things to know:\n` +
    `1. Sign up with the same email you requested with (${requesterEmail}). ` +
    `That's the email we approved — any other will land in the regular signup queue.\n` +
    `2. During beta, alerts go through Telegram. You'll need to install the free Telegram app and link it to your akFISHinfo account during setup. ` +
    `It takes 60 seconds and works on every device.\n\n` +
    `— Oliver, akFISHinfo`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're in — akFISHinfo beta</title>
</head>
<body style="margin:0;padding:0;background:#060a0f;color:#dde8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#060a0f;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#0d1520;border:1px solid #1a2d3f;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #1a2d3f;">
          <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#dde8f4;">akFISH<span style="color:#00b4d8;">info.</span></span>
        </td></tr>

        <tr><td style="padding:36px 28px 16px;">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#00b4d8;margin-bottom:14px;">2026 PWS season</div>
          <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:36px;line-height:1.05;letter-spacing:-0.01em;color:#dde8f4;font-weight:800;">
            You've been<br><span style="color:#00b4d8;">accepted.</span>
          </h1>
        </td></tr>

        <tr><td style="padding:8px 28px 6px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#9fb1c4;">
            Welcome to the akFISHinfo beta. The moment ADF&amp;G drops a Prince William Sound opening, you'll get a live map and a Telegram alert &mdash; before you leave the dock.
          </p>
        </td></tr>

        <tr><td align="center" style="padding:14px 28px 26px;">
          <a href="${e(signupUrl)}" style="display:inline-block;background:#00b4d8;color:#000000;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:14px 28px;border:1px solid #00b4d8;">
            Get started &rarr;
          </a>
        </td></tr>

        <tr><td style="padding:6px 28px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#132030;border:1px solid #1a2d3f;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.10em;color:#00b4d8;margin-bottom:8px;">Step 1 &mdash; sign up</div>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#dde8f4;">
                Use the same email you requested with: <strong style="color:#dde8f4;">${e(requesterEmail)}</strong>. That's the address we approved &mdash; if you sign up with a different one, the system won't know it's you.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 28px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#132030;border:1px solid #1a2d3f;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.10em;color:#00b4d8;margin-bottom:8px;">Step 2 &mdash; install Telegram</div>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#dde8f4;">
                During beta, alerts are delivered through the messaging app <strong style="color:#dde8f4;">Telegram</strong>. It's free, takes about 60 seconds to install, and a single account works across phone, tablet, and desktop.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#9fb1c4;">
                You'll link Telegram to your akFISHinfo account on the setup page right after signup &mdash; we'll show you exactly how.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 28px 30px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#5a7288;">
            Questions? Just reply to this email &mdash; it reaches me directly.<br>
            &mdash; Oliver, akFISHinfo
          </p>
        </td></tr>

        <tr><td style="padding:16px 28px;border-top:1px solid #1a2d3f;background:#0a121b;">
          <p style="margin:0;font-size:11px;color:#5a7288;line-height:1.5;">
            You're receiving this because you requested beta access at akfishinfo.com. If that wasn't you, ignore this email &mdash; no account will be created.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
}

async function sendBetaApprovalEmail(requesterEmail) {
  const signupUrl = `${BASE_URL}/signup`;
  const { text, html } = renderBetaApprovalEmail({ requesterEmail, signupUrl });
  return sendMailgun({
    to: requesterEmail,
    subject: "You're in — akFISHinfo beta access approved",
    text, html,
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// betaRequestLimiter / qrScanLimiter / BETA_REQUEST_SOURCES /
// normalizeBetaSource / notifyAdminsOfBetaRequest are hoisted earlier in
// the file (before the /api/qr-scan and /api/beta-request route
// registrations that consume them) to avoid a TDZ ReferenceError at
// module load.

const BETA_REQUEST_SOURCES = ['whittier', 'valdez', 'cordova', 'direct', 'other'];

function normalizeBetaSource(raw) {
  if (!raw || typeof raw !== 'string') return 'direct';
  const v = raw.toLowerCase().trim();
  return BETA_REQUEST_SOURCES.includes(v) ? v : 'other';
}

async function notifyAdminsOfBetaRequest({ name, email, source, requestId }) {
  // DM every admin captain who has a linked Telegram chat. ADMIN_EMAILS env
  // var is the source of truth; we look up their chat_id from the captains
  // table. No new env var needed.
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.length === 0 || !TELEGRAM_API) return;
  try {
    const r = await db.query(
      `SELECT telegram_chat_id FROM captains
       WHERE telegram_chat_id IS NOT NULL
         AND LOWER(email) = ANY($1::text[])`,
      [adminEmails]
    );
    if (r.rows.length === 0) return;
    const text =
      `<b>New beta access request</b>\n` +
      `Name: ${escapeHtml(name || '(none)')}\n` +
      `Email: <code>${escapeHtml(email)}</code>\n` +
      `Port: ${escapeHtml(source)}\n` +
      `Request #${requestId} — approve at ${BASE_URL}/admin`;
    for (const row of r.rows) {
      await sendTelegramMessage(row.telegram_chat_id, text);
    }
  } catch (err) {
    console.error('notifyAdminsOfBetaRequest error:', err);
  }
}

// POST /api/register — create account with email + password
app.post('/api/register', authLimiter, express.json(), async (req, res) => {
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
    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const preApprovedBeta = await hasApprovedBetaRequest(email.toLowerCase());
    const result = await db.query(
      `INSERT INTO captains (name, email, password_hash, tier, is_admin, email_verify_token, email_verify_expires, beta_access)
       VALUES ($1, $2, $3, 'free', $4, $5, $6, $7) RETURNING *`,
      [name.trim(), email.toLowerCase(), hash, admin, verifyToken, verifyExpires, preApprovedBeta]
    );
    const user = result.rows[0];
    if (preApprovedBeta) {
      await linkApprovedBetaRequestToCaptain(email.toLowerCase(), user.id);
    }

    // Fire-and-forget verification email
    sendVerificationEmail(email.toLowerCase(), verifyToken).catch(e => console.error('Verify email send failed:', e));

    req.login(user, err => {
      if (err) return res.status(500).json({ error: 'Session error.' });
      if (remember_me) req.session.cookie.maxAge = THIRTY_DAYS;
      if (isAlaskaGov(user.email) || user.is_admin) return res.json({ redirect: '/app' });
      // Everyone else: go to /setup to link Telegram.
      res.json({ redirect: '/setup' });
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// POST /api/login — sign in with email + password
app.post('/api/login', authLimiter, express.json(), async (req, res) => {
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
      if (!user.telegram_chat_id && !isAlaskaGov(user.email) && !user.is_admin) {
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
    // Sign in with Apple — `sub` claim from Apple's identity token. Stable
    // across sessions per (Apple ID, App ID) pair. NULL for non-Apple sign-ins.
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS apple_user_id VARCHAR(255);`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_apple_user_id
      ON captains(apple_user_id) WHERE apple_user_id IS NOT NULL;
    `);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN DEFAULT false;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS sms_opted_in_at TIMESTAMPTZ;`);

    // Plan / billing metadata — added for multi-tier pricing (biweekly | monthly | season)
    // and early-adopter seat locking. plan_slug lets us tell Season subscribers apart
    // (required for deckhand seat entitlement, per docs/plans/plan-deckhand-seats.md).
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS plan_slug TEXT;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS is_early_adopter BOOLEAN DEFAULT false;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS subscription_status TEXT;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;`);

    // Telegram delivery — replaces SMS. See docs/plans/plan-telegram-delivery.md.
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64);`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_link_code VARCHAR(8);`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at TIMESTAMPTZ;`);
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;`);

    // Beta access — admin-toggleable column, replaces the BETA_TESTERS env var.
    // The env var is still backfilled at startup below for migration.
    await db.query(`ALTER TABLE captains ADD COLUMN IF NOT EXISTS beta_access BOOLEAN DEFAULT false;`);

    // Anti-meta-gaming: one chat per captain. Same chat trying to link a second account is rejected.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_telegram_chat_id
      ON captains(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_telegram_link_code
      ON captains(telegram_link_code) WHERE telegram_link_code IS NOT NULL;
    `);

    // Idempotency ledger for Stripe webhooks — prevents double-processing retries.
    await db.query(`
      CREATE TABLE IF NOT EXISTS stripe_events (
        id VARCHAR(255) PRIMARY KEY,
        type TEXT NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      );
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

    // Telegram notification log — analogue of sms_log, used by notifyCaptains().
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id SERIAL PRIMARY KEY,
        captain_id INT REFERENCES captains(id),
        chat_id BIGINT,
        message TEXT,
        status TEXT,
        telegram_message_id BIGINT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notification_log_captain ON notification_log(captain_id);
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id           SERIAL PRIMARY KEY,
        captain_id   INT REFERENCES captains(id) ON DELETE SET NULL,
        source       TEXT NOT NULL CHECK (source IN ('web', 'telegram')),
        category     TEXT,
        body         TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Beta access requests captured by the public /request-beta page (QR-code flow).
    await db.query(`
      CREATE TABLE IF NOT EXISTS beta_requests (
        id           SERIAL PRIMARY KEY,
        email        VARCHAR(255) NOT NULL,
        name         VARCHAR(255),
        source       VARCHAR(64),
        status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'denied')),
        captain_id   INT REFERENCES captains(id) ON DELETE SET NULL,
        ip           VARCHAR(64),
        user_agent   TEXT,
        notes        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at   TIMESTAMPTZ
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_beta_requests_email ON beta_requests(LOWER(email));`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_beta_requests_status ON beta_requests(status);`);

    // QR-code scan pings — fired on /request-beta page load so we can see
    // scan-to-submit conversion per port.
    await db.query(`
      CREATE TABLE IF NOT EXISTS qr_scans (
        id           SERIAL PRIMARY KEY,
        source       VARCHAR(64),
        ip           VARCHAR(64),
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_qr_scans_created ON qr_scans(created_at);`);

    // Migration: backfill beta_access from the legacy BETA_TESTERS env var.
    // Idempotent — only flips false → true; never unsets.
    if (BETA_TESTERS.length > 0) {
      const r = await db.query(
        `UPDATE captains SET beta_access = true
         WHERE beta_access = false AND LOWER(email) = ANY($1::text[])`,
        [BETA_TESTERS]
      );
      if (r.rowCount > 0) {
        console.log(`✓ Backfilled beta_access=true for ${r.rowCount} captain(s) from BETA_TESTERS env`);
      }
    }

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
 * Verify a Mailgun webhook signature.
 * Uses HMAC-SHA256(timestamp + token, MAILGUN_WEBHOOK_SIGNING_KEY).
 * Docs: https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/#securing-webhooks
 */
function verifyMailgunSignature(timestamp, token, signature) {
  const signingKey =
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY ||
    process.env.MAILGUN_WEBHOOK_SECRET;
  if (!signingKey) {
    console.warn('⚠ MAILGUN_WEBHOOK_SIGNING_KEY/MAILGUN_WEBHOOK_SECRET not set — skipping webhook signature check');
    return true;
  }
  if (typeof timestamp !== 'string' || typeof token !== 'string' || typeof signature !== 'string') {
    console.warn('⚠ Mailgun webhook missing signature fields — cannot verify');
    return false;
  }
  try {
    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(timestamp + token)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * POST /webhooks/email
 * Receives email from Mailgun, extracts PDF, queues parsing
 */
app.post('/webhooks/email', upload.any(), async (req, res) => {
  // Verify this request actually came from Mailgun.
  // multer.any() leaves req.body undefined on non-multipart requests
  // (probes, empty POSTs), so guard against that before destructuring.
  const body = req.body || {};
  // Mailgun sends signature fields top-level for inbound route forwards,
  // but some configurations nest them under `signature[...]`. Try both.
  const timestamp = body.timestamp || body['signature[timestamp]'];
  const token     = body.token     || body['signature[token]'];
  const signature = body.signature || body['signature[signature]'];
  if (!verifyMailgunSignature(timestamp, token, signature)) {
    console.warn(`⚠ Mailgun webhook signature mismatch — rejected. body keys: ${Object.keys(body).join(',')}`);
    return res.status(403).send('Forbidden');
  }
  const sender = (body.sender || body.from || '').toLowerCase();
  const trusted =
    TRUSTED_SENDER_DOMAINS.some(d => sender.endsWith(d)) ||
    EXTRA_ALLOWED_SENDERS.some(s => sender.includes(s));
  if (!trusted) {
    console.warn(`⚠ Untrusted sender ignored: ${sender}`);
    return res.status(200).send('OK');
  }
  try {
    const subject = body.subject || '';
    const attachmentCount = parseInt(body['attachment-count'] || '0', 10);

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

    // Store announcement record. Persist the raw PDF bytes so /admin reparse
    // can re-run the parser later — Railway's filesystem is ephemeral, so the
    // multer temp file at pdfFile.path will be gone after the next restart.
    const result = await db.query(
      `INSERT INTO announcements (source, raw_text, content_hash, published_at, pdf_filename, pdf_data)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       RETURNING id`,
      ['email', '', contentHash, pdfFile.originalname, pdfBuffer]
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
    const { htmlPath, districts, district_details, announcement_date, has_open, earliest_opens_at, latest_closes_at } = await runLiveTest(announcementId, pdfPath);

    // Read HTML content to store in DB (Railway filesystem is ephemeral)
    const htmlContent = await fs.readFile(htmlPath, 'utf8');
    const htmlFilename = path.basename(htmlPath);
    const htmlUrl = `/results/${htmlFilename}`;

    await db.query(
      `INSERT INTO parsed_results
         (announcement_id, html_filename, html_path, html_url, districts, parsed_json, html_content,
          announcement_date, has_open_districts, earliest_opens_at, latest_closes_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [announcementId, htmlFilename, htmlPath, htmlUrl, districts, JSON.stringify(district_details || []), htmlContent,
       announcement_date, has_open, earliest_opens_at, latest_closes_at]
    );

    console.log(`✓ Announcement #${announcementId} parsed → ${htmlUrl}`);

    // Mark announcement as parsed
    await db.query('UPDATE announcements SET parsed = true WHERE id = $1', [announcementId]);

    // DM eligible captains via Telegram
    await notifyCaptains(districts, district_details);
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
      let parsed = { districts: [], district_details: [], announcement_date: null, has_open: false, earliest_opens_at: null, latest_closes_at: null };
      try {
        const raw = JSON.parse(stdout.trim());
        if (Array.isArray(raw)) {
          parsed.districts = raw;
        } else {
          parsed = {
            districts:          raw.districts           || [],
            district_details:   raw.district_details    || [],
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
  if (htmlPath.includes('..') || path.isAbsolute(htmlPath)) {
    throw new Error('Invalid file path');
  }
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
// TELEGRAM ALERTS
// ============================================================

/**
 * DM all eligible captains via Telegram when openings are announced.
 * Eligibility: paid + active subscription (or admin/alaska.gov via existing access
 * predicates handled elsewhere) AND captain has a linked telegram_chat_id AND
 * alerts_enabled is true AND captain subscribes to one of the open districts.
 */
const ALERT_DISTRICT_LIMIT = 5;
const GEAR_LABELS = {
  drift_gillnet: 'Drift gillnet',
  purse_seine:   'Purse seine',
  set_gillnet:   'Set gillnet',
};

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtAKTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Anchorage',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function fmtAKTzLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Anchorage',
    timeZoneName: 'short',
  }).formatToParts(d);
  const tz = parts.find(p => p.type === 'timeZoneName');
  return tz ? tz.value : '';
}

function fmtAKDateHeader(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Anchorage',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

function renderDistrictBlock(detail) {
  const name = escapeHTML(detail.district || 'Unknown district');
  const status = (detail.status || '').toUpperCase();
  const lines = [`<b>${name}</b>${status ? ` — ${escapeHTML(status)}` : ''}`];

  const opens = fmtAKTime(detail.opens_at);
  const closes = fmtAKTime(detail.closes_at);
  const tz = fmtAKTzLabel(detail.closes_at || detail.opens_at);
  if (opens && closes) {
    const dur = detail.duration_hours ? ` (${detail.duration_hours}h)` : '';
    lines.push(`  ${escapeHTML(opens)} → ${escapeHTML(closes)}${tz ? ' ' + escapeHTML(tz) : ''}${dur}`);
  } else if (opens) {
    lines.push(`  Opens ${escapeHTML(opens)}${tz ? ' ' + escapeHTML(tz) : ''}`);
  } else if (closes) {
    lines.push(`  Closes ${escapeHTML(closes)}${tz ? ' ' + escapeHTML(tz) : ''}`);
  }

  const gear = (detail.gear_types || [])
    .map(g => GEAR_LABELS[g] || g.replace(/_/g, ' '))
    .filter(Boolean);
  const excl = [
    ...(detail.excluded_subdistricts || []),
    ...(detail.excluded_hatchery_areas || []),
  ];
  const gearLine = [
    gear.length ? gear.join(', ') : null,
    excl.length ? `excl. ${excl.join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  if (gearLine) lines.push(`  ${escapeHTML(gearLine)}`);

  return lines.join('\n');
}

function buildAlertText(districts, details, opts = {}) {
  const list = Array.isArray(details) && details.length ? details : districts.map(d => ({ district: d }));
  const headerDate = list.map(d => d.opens_at).find(Boolean);
  const headerStr = fmtAKDateHeader(headerDate);
  const label = opts.kind === 'correction' ? 'CORRECTION' : 'UPDATE';
  const head = headerStr
    ? `<b>ADF&amp;G ${label} — ${escapeHTML(headerStr)}</b>`
    : `<b>ADF&amp;G ${label}</b>`;

  const shown = list.slice(0, ALERT_DISTRICT_LIMIT);
  const overflow = list.length - shown.length;
  const blocks = shown.map(renderDistrictBlock).join('\n\n');
  const more = overflow > 0 ? `\n\n+${overflow} more — see map` : '';

  return [
    head,
    '',
    blocks + more,
    '',
    'Map: https://akfishinfo.com/app',
    '<i>Not legal advice — verify at adfg.alaska.gov</i>',
  ].join('\n');
}

async function notifyCaptains(districts, district_details = [], opts = {}) {
  if (!districts || districts.length === 0) {
    console.log('⚠ No districts to alert');
    return;
  }

  try {
    // Recipients = pro subscribers, admins, and beta testers — anyone who
    // should see what the app is producing. Beta testers come from the
    // captains.beta_access column (admin-toggleable); admins from is_admin.
    const captains = await db.query(
      `SELECT id, telegram_chat_id, name FROM captains
       WHERE telegram_chat_id IS NOT NULL
       AND alerts_enabled = true
       AND (regions && $1 OR regions = ARRAY['PWS'])
       AND (
         (tier = 'pro' AND subscription_active = true)
         OR is_admin = true
         OR beta_access = true
       )`,
      [districts]
    );

    if (captains.rows.length === 0) {
      console.log('📵 No captains to alert');
      return;
    }

    const text = buildAlertText(districts, district_details, opts);

    for (const captain of captains.rows) {
      const result = await sendTelegramMessage(captain.telegram_chat_id, text);
      if (result.ok) {
        await db.query(
          `INSERT INTO notification_log (captain_id, chat_id, message, status, telegram_message_id)
           VALUES ($1, $2, $3, 'sent', $4)`,
          [captain.id, captain.telegram_chat_id, text, result.message_id]
        );
        console.log(`✓ Telegram sent to ${captain.name} (chat ${captain.telegram_chat_id})`);
      } else {
        await db.query(
          `INSERT INTO notification_log (captain_id, chat_id, message, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [captain.id, captain.telegram_chat_id, text, result.error]
        );
        console.error(`❌ Telegram failed for chat ${captain.telegram_chat_id}: ${result.error}`);
      }
    }
  } catch (err) {
    console.error('Error in notifyCaptains:', err);
  }
}

// ============================================================
// USER SIGNUP & SUBSCRIPTION
// ============================================================

/**
 * GET /success
 * Shown after Stripe checkout completes. The actual upgrade is handled
 * by the Stripe webhook (checkout.session.completed) — not here.
 */
app.get('/success', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.send(`
    <html>
      <head><meta http-equiv="refresh" content="3;url=/app"></head>
      <body style="font-family:sans-serif;text-align:center;margin-top:4em;background:#0d1117;color:#e6edf3">
        <h2 style="color:#27ae60">Payment received!</h2>
        <p>Your account is being activated&hellip; you'll be redirected shortly.</p>
        <p><a href="/app" style="color:#58a6ff">Open the app</a></p>
      </body>
    </html>
  `);
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

  // Idempotency — Stripe retries on any 5xx, so short-circuit if we've processed this event.
  try {
    const seen = await db.query('SELECT id FROM stripe_events WHERE id = $1', [event.id]);
    if (seen.rows.length) return res.json({ received: true, skipped: true });
  } catch (e) {
    console.error('stripe_events lookup failed:', e);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      default:
        // Silence: Stripe emits many event types we don't care about.
        break;
    }

    // Mark processed only on success — failures return 500 so Stripe retries.
    await db.query(
      'INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [event.id, event.type]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(`Webhook processing error (${event.type}):`, err);
    res.status(500).send('Error processing webhook');
  }
});

async function handleCheckoutCompleted(session) {
  if (session.mode !== 'subscription') return;
  const captainId = session.metadata?.captain_id || session.client_reference_id;
  if (!captainId) {
    console.warn('checkout.session.completed without captain_id metadata');
    return;
  }

  // Always re-fetch the subscription — webhook payloads can be stale.
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const priceId = subscription.items.data[0]?.price?.id;
  const planSlug = session.metadata?.plan || planFromPriceId(priceId);
  const isEarlyAdopter =
    session.metadata?.is_early_adopter === 'true' || isEarlyAdopterPriceId(priceId);

  await db.query(
    `UPDATE captains
     SET stripe_customer_id = $1,
         stripe_subscription_id = $2,
         stripe_price_id = $3,
         stripe_current_period_end = to_timestamp($4),
         cancel_at_period_end = $5,
         subscription_status = $6,
         subscription_active = $7,
         plan_slug = $8,
         is_early_adopter = COALESCE(is_early_adopter, false) OR $9,
         tier = 'pro',
         updated_at = NOW()
     WHERE id = $10`,
    [
      session.customer,
      subscription.id,
      priceId,
      subscription.current_period_end,
      !!subscription.cancel_at_period_end,
      subscription.status,
      subscription.status === 'active' || subscription.status === 'trialing',
      planSlug,
      isEarlyAdopter,
      captainId,
    ]
  );
  console.log(`✓ Captain #${captainId} upgraded to pro (plan=${planSlug}, ea=${isEarlyAdopter})`);
}

async function handleSubscriptionUpdated(subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const planSlug = planFromPriceId(priceId);
  const active = subscription.status === 'active' || subscription.status === 'trialing';

  // Prefer subscription ID, fall back to customer ID (e.g. subscription.created before DB has ID).
  const bySub = await db.query(
    `UPDATE captains
     SET stripe_price_id = $1,
         stripe_current_period_end = to_timestamp($2),
         cancel_at_period_end = $3,
         subscription_status = $4,
         subscription_active = $5,
         plan_slug = COALESCE($6, plan_slug),
         tier = CASE WHEN $5 THEN 'pro' ELSE tier END,
         updated_at = NOW()
     WHERE stripe_subscription_id = $7
     RETURNING id`,
    [priceId, subscription.current_period_end, !!subscription.cancel_at_period_end,
     subscription.status, active, planSlug, subscription.id]
  );
  if (bySub.rows.length) return;

  await db.query(
    `UPDATE captains
     SET stripe_subscription_id = $1,
         stripe_price_id = $2,
         stripe_current_period_end = to_timestamp($3),
         cancel_at_period_end = $4,
         subscription_status = $5,
         subscription_active = $6,
         plan_slug = COALESCE($7, plan_slug),
         tier = CASE WHEN $6 THEN 'pro' ELSE tier END,
         updated_at = NOW()
     WHERE stripe_customer_id = $8`,
    [subscription.id, priceId, subscription.current_period_end,
     !!subscription.cancel_at_period_end, subscription.status, active, planSlug,
     subscription.customer]
  );
}

async function handleSubscriptionDeleted(subscription) {
  await db.query(
    `UPDATE captains
     SET subscription_active = false,
         subscription_status = 'canceled',
         tier = 'free',
         cancel_at_period_end = false,
         updated_at = NOW()
     WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2`,
    [subscription.id, subscription.customer]
  );
  console.log(`⚠️ Subscription canceled: ${subscription.id}`);
}

async function handleInvoicePaymentSucceeded(invoice) {
  if (!invoice.subscription) return;
  await db.query(
    `UPDATE captains
     SET subscription_status = 'active',
         subscription_active = true,
         tier = 'pro',
         stripe_current_period_end = to_timestamp($1),
         updated_at = NOW()
     WHERE stripe_subscription_id = $2`,
    [invoice.period_end, invoice.subscription]
  );
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  await db.query(
    `UPDATE captains
     SET subscription_status = 'past_due',
         updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [invoice.subscription]
  );
  console.warn(`Payment failed for subscription ${invoice.subscription} (attempt ${invoice.attempt_count})`);
}

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
 * Openings happening right now (between earliest_opens_at and latest_closes_at,
 * plus a 12h grace after close so a captain glancing at the app after the
 * window doesn't see "no live announcements" while gear is still being pulled).
 * Falls back to "announcement_date = today/tomorrow AKDT" for legacy rows
 * where the parser didn't extract a window.
 */
app.get('/api/results/live', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, announcement_id, html_url, districts, parsed_at,
              announcement_date, has_open_districts, earliest_opens_at, latest_closes_at
       FROM parsed_results
       WHERE
         (earliest_opens_at IS NOT NULL
          AND earliest_opens_at <= NOW()
          AND (latest_closes_at IS NULL OR latest_closes_at >= NOW() - INTERVAL '12 hours'))
         OR (
           earliest_opens_at IS NULL
           AND (
             announcement_date = (NOW() AT TIME ZONE 'America/Anchorage')::date
             OR announcement_date = ((NOW() AT TIME ZONE 'America/Anchorage') + INTERVAL '1 day')::date
           )
         )
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
 * GET /api/results/upcoming
 * Announcements that have been published but whose opening hasn't started yet
 * (earliest_opens_at > NOW()). Sorted nearest-first.
 */
app.get('/api/results/upcoming', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, announcement_id, html_url, districts, parsed_at,
              announcement_date, has_open_districts, earliest_opens_at, latest_closes_at
       FROM parsed_results
       WHERE earliest_opens_at IS NOT NULL
       AND earliest_opens_at > NOW()
       ORDER BY earliest_opens_at ASC
       LIMIT 20`
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
       WHERE earliest_opens_at IS NULL OR earliest_opens_at <= NOW()
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
 * GET /api/result/:id/pdf
 * Stream the original ADF&G PDF for a parsed result. Public — ADF&G
 * announcements are public records, mirrors the /html route's auth posture.
 */
app.get('/api/result/:id/pdf', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.pdf_data, a.pdf_filename
         FROM parsed_results pr
         JOIN announcements a ON a.id = pr.announcement_id
        WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length || !r.rows[0].pdf_data) {
      return res.status(404).send('PDF not found');
    }
    const filename = r.rows[0].pdf_filename || `adfg-result-${req.params.id}.pdf`;
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].pdf_data);
  } catch (err) {
    res.status(500).send('Error');
  }
});

/**
 * POST /api/result/:id/reparse
 * Force re-run live_test_server.py on the original PDF for this result.
 * Updates html_content in DB with freshly generated HTML.
 */
app.post('/api/result/:id/reparse', requireAdmin, express.json(), async (req, res) => {
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
              let freshDistricts = [];
              let freshDetails = [];
              let freshOpens = null;
              let freshCloses = null;
              try {
                const raw = JSON.parse(stdout.trim());
                if (Array.isArray(raw)) {
                  freshDistricts = raw;
                } else {
                  freshDistricts = raw.districts        || [];
                  freshDetails   = raw.district_details || [];
                  freshOpens     = raw.earliest_opens_at || null;
                  freshCloses    = raw.latest_closes_at  || null;
                }
              } catch (_) {
                console.warn('reparse: could not parse stdout JSON, falling back to HTML-only update');
              }
              try {
                const htmlContent = await fs.readFile(outputPath, 'utf8');
                if (freshDistricts.length) {
                  await db.query(
                    `UPDATE parsed_results
                     SET html_content = $1, html_filename = $2, html_url = $3,
                         districts = $4, parsed_json = $5,
                         earliest_opens_at = $6, latest_closes_at = $7
                     WHERE id = $8`,
                    [htmlContent, outputFilename, `/results/${outputFilename}`,
                     freshDistricts, JSON.stringify(freshDetails),
                     freshOpens, freshCloses, req.params.id]
                  );
                } else {
                  await db.query(
                    `UPDATE parsed_results SET html_content = $1, html_filename = $2, html_url = $3 WHERE id = $4`,
                    [htmlContent, outputFilename, `/results/${outputFilename}`, req.params.id]
                  );
                }
                console.log(`✓ Reparse complete for result #${req.params.id}`);
              } catch (e) { console.error('reparse DB update failed:', e); }
              if (freshDistricts.length) {
                try {
                  await notifyCaptains(freshDistricts, freshDetails, { kind: 'correction' });
                } catch (e) { console.error('reparse correction alert failed:', e); }
              }
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
app.use('/static', express.static(path.join(__dirname, 'public', 'static'), { maxAge: '7d' }));

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
 * GET /
 * Landing page — redirect logged-in users straight to /app
 */
app.get('/', (req, res) => {
  if (req.user && hasAccess(req.user)) return res.redirect('/app');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
 * GET /signup
 * Registration page — public, redirects away if already logged in
 */
app.get(['/signup', '/signup.html'], (req, res) => {
  if (req.user) return res.redirect(hasAccess(req.user) ? '/app' : '/setup');
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
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
  if (req.user.telegram_chat_id) {
    return res.redirect(hasAccess(req.user) ? '/app' : '/pricing');
  }
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

/**
 * GET /pricing
 * Redirect unauthenticated users to login first
 */
app.get('/pricing', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

/**
 * GET /about
 * Public about page — no auth required
 */
app.get('/request-beta', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request-beta.html'));
});

app.get('/about', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

/**
 * GET /privacy
 * Privacy Policy — public, no auth required
 */
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

/**
 * GET /terms
 * Terms of Service — public, no auth required
 */
app.get('/terms', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ============================================================
// ADMIN PANEL
// Read-mostly. The only write actions exposed are reparse (already in
// /api/result/:id/reparse) and a self-only test DM. No bulk messaging,
// no captain edits, no deletes — keep it that way.
// ============================================================

app.get('/admin', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (!req.user.is_admin) return res.status(403).send('Forbidden');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const captainCounts = await db.query(`
      SELECT
        COUNT(*)::int                                                    AS total,
        COUNT(*) FILTER (WHERE tier = 'pro' AND subscription_active)::int AS pro_active,
        COUNT(*) FILTER (WHERE trial_ends_at > NOW())::int               AS trial_active,
        COUNT(*) FILTER (WHERE telegram_chat_id IS NOT NULL)::int        AS telegram_linked,
        COUNT(*) FILTER (WHERE is_early_adopter)::int                    AS early_adopters,
        COUNT(*) FILTER (WHERE is_admin)::int                            AS admins
      FROM captains
    `);
    const notif24h = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent')::int   AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM notification_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    res.json({
      captains: captainCounts.rows[0],
      notifications_24h: notif24h.rows[0],
    });
  } catch (err) {
    console.error('admin stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/announcements', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const result = await db.query(
      `SELECT pr.id            AS result_id,
              pr.announcement_id,
              pr.parsed_at,
              pr.announcement_date,
              pr.has_open_districts,
              pr.districts,
              pr.html_url,
              a.source,
              a.pdf_filename,
              a.fetched_at
         FROM parsed_results pr
         LEFT JOIN announcements a ON a.id = pr.announcement_id
        ORDER BY pr.parsed_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error('admin announcements error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/feedback', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.id, f.source, f.category, f.body, f.created_at,
              c.email, c.name
         FROM feedback f
         LEFT JOIN captains c ON c.id = f.captain_id
        ORDER BY f.created_at DESC
        LIMIT 200`
    );
    res.json({ feedback: rows });
  } catch (err) {
    console.error('admin feedback error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const result = await db.query(
      `SELECT n.id, n.captain_id, n.chat_id, n.status, n.error_message,
              n.created_at, c.email, c.name
         FROM notification_log n
         LEFT JOIN captains c ON c.id = n.captain_id
        ORDER BY n.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    console.error('admin notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sends a sample alert ONLY to the calling admin's own linked Telegram chat.
// Intentionally cannot target other users — keeps the panel safe.
// POST /api/admin/broadcast — send a plain-text message to every captain with
// a linked Telegram chat. Body: { message: string }. Returns per-chat results.
app.post('/api/admin/broadcast', requireAdmin, express.json(), async (req, res) => {
  const raw = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!raw) return res.status(400).json({ error: 'Message is required.' });
  if (raw.length > 3500) return res.status(400).json({ error: 'Message too long (max 3500 chars).' });

  try {
    const captains = await db.query(
      `SELECT id, telegram_chat_id, name, email FROM captains
        WHERE telegram_chat_id IS NOT NULL`
    );

    if (captains.rows.length === 0) {
      return res.json({ ok: true, sent: 0, failed: 0, total: 0 });
    }

    const text = escapeHTML(raw);
    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const captain of captains.rows) {
      const result = await sendTelegramMessage(captain.telegram_chat_id, text);
      if (result.ok) {
        sent++;
        await db.query(
          `INSERT INTO notification_log (captain_id, chat_id, message, status, telegram_message_id)
           VALUES ($1, $2, $3, 'sent', $4)`,
          [captain.id, captain.telegram_chat_id, text, result.message_id]
        );
      } else {
        failed++;
        failures.push({ captain: captain.name || captain.email, error: result.error });
        await db.query(
          `INSERT INTO notification_log (captain_id, chat_id, message, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [captain.id, captain.telegram_chat_id, text, result.error]
        );
      }
    }

    console.log(`📣 Broadcast by ${req.user.email}: ${sent} sent, ${failed} failed (${captains.rows.length} total)`);
    res.json({ ok: true, sent, failed, total: captains.rows.length, failures });
  } catch (err) {
    console.error('POST /api/admin/broadcast error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/test-dm', requireAdmin, express.json(), async (req, res) => {
  if (!req.user.telegram_chat_id) {
    return res.status(400).json({ error: 'Your account has no linked Telegram chat. Link it first at /setup.' });
  }
  const text =
    `<b>akFISHinfo test alert</b>\n` +
    `If you can read this, Telegram delivery is working end-to-end.\n\n` +
    `<i>Sent from /admin by ${escapeHTML(req.user.email)}</i>`;
  const result = await sendTelegramMessage(req.user.telegram_chat_id, text);
  if (!result.ok) return res.status(502).json({ ok: false, error: result.error });
  res.json({ ok: true, message_id: result.message_id });
});

// GET /api/admin/beta-requests — list pending + recent requests, plus
// QR-scan totals by source so admin can see scan → submit conversion.
app.get('/api/admin/beta-requests', requireAdmin, async (req, res) => {
  try {
    const requests = await db.query(
      `SELECT br.id, br.email, br.name, br.source, br.status,
              br.created_at, br.decided_at,
              c.id   AS captain_id,
              c.beta_access,
              c.telegram_chat_id IS NOT NULL AS telegram_linked
         FROM beta_requests br
         LEFT JOIN captains c ON LOWER(c.email) = LOWER(br.email)
        ORDER BY (br.status = 'pending') DESC, br.created_at DESC
        LIMIT 200`
    );
    const scans = await db.query(
      `SELECT source, COUNT(*)::int AS count
         FROM qr_scans
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY source`
    );
    const submissions = await db.query(
      `SELECT source, COUNT(*)::int AS count
         FROM beta_requests
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY source`
    );
    res.json({
      requests: requests.rows,
      scans_30d: scans.rows,
      submissions_30d: submissions.rows,
    });
  } catch (err) {
    console.error('admin beta-requests error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/beta-requests/:id/approve — grants beta access to the
// requester's email. If a captain row exists, flip beta_access=true. If
// not, the request is still marked approved; the auto-grant on signup
// will pick it up when they create an account.
app.post('/api/admin/beta-requests/:id/approve', requireAdmin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const r = await db.query(`SELECT * FROM beta_requests WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    const reqRow = r.rows[0];
    const captain = await db.query(
      `UPDATE captains SET beta_access = true, updated_at = NOW()
       WHERE LOWER(email) = LOWER($1) RETURNING id`,
      [reqRow.email]
    );
    await db.query(
      `UPDATE beta_requests
          SET status = 'approved', decided_at = NOW(), captain_id = $2
        WHERE id = $1`,
      [id, captain.rows[0]?.id || null]
    );
    // Fire-and-forget approval email — never block the admin's response on it.
    sendBetaApprovalEmail(reqRow.email).catch(err =>
      console.error('beta approval email failed for', reqRow.email, err)
    );
    res.json({
      ok: true,
      captain_updated: captain.rowCount > 0,
      pending_signup: captain.rowCount === 0,
      email_sent_to: reqRow.email,
    });
  } catch (err) {
    console.error('approve beta request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/beta-requests/test-email — send the approval email
// template to the project's admin@ address (always, regardless of which
// admin clicked). Surfaces the Mailgun status code + response body so we
// can debug deliverability failures from the toast.
const TEST_EMAIL_RECIPIENT = 'admin@akfishinfo.com';
app.post('/api/admin/beta-requests/test-email', requireAdmin, express.json(), async (req, res) => {
  try {
    const result = await sendBetaApprovalEmail(TEST_EMAIL_RECIPIENT);
    res.json({
      ok: !!result?.ok,
      sent_to: TEST_EMAIL_RECIPIENT,
      mailgun_status: result?.statusCode ?? 0,
      mailgun_id: result?.mailgun_id ?? null,
      mailgun_domain: result?.domain ?? null,
      mailgun_body: result?.body ?? null,
    });
  } catch (err) {
    console.error('test approval email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/beta-requests/:id/resend-email — re-send the approval
// email for a request already marked approved. Useful if the original
// landed in spam or the requester typo'd their email and we fix it.
app.post('/api/admin/beta-requests/:id/resend-email', requireAdmin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const r = await db.query(
      `SELECT email, status FROM beta_requests WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (r.rows[0].status !== 'approved') {
      return res.status(400).json({ error: 'not_approved' });
    }
    await sendBetaApprovalEmail(r.rows[0].email);
    res.json({ ok: true, email: r.rows[0].email });
  } catch (err) {
    console.error('resend approval email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/beta-requests/:id/deny — mark denied. Does not touch
// the captain row (admin can still grant manually later if they change their mind).
app.post('/api/admin/beta-requests/:id/deny', requireAdmin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const r = await db.query(
      `UPDATE beta_requests SET status = 'denied', decided_at = NOW()
        WHERE id = $1 RETURNING id`,
      [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('deny beta request error:', err);
    res.status(500).json({ error: err.message });
  }
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
      console.log(`💳 Stripe webhook: POST /webhooks/stripe`);
      console.log(`🗂️ Results: GET /results/{filename}`);
      console.log(`✅ Health: GET /health\n`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
