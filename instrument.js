/**
 * Sentry instrumentation — MUST be required as the very first line of
 * backend_v2.js, before any other module. Sentry's Node auto-instrumentation
 * monkey-patches express, http, pg, etc. on import; if Sentry loads after
 * those modules, the instrumentation silently no-ops and we lose tracing,
 * database query spans, and the Express error handler hook.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/guides/node/
 *       https://docs.sentry.io/platforms/javascript/guides/express/
 */

const Sentry = require('@sentry/node');

if (!process.env.SENTRY_DSN) {
  console.warn('⚠ SENTRY_DSN not set — Sentry crash reporting disabled.');
} else {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // TEMPORARY: verbose logging while we verify ingestion. Remove once
    // events are flowing to the dashboard reliably.
    debug: true,

    // `environment` separates events in the dashboard. Railway sets this
    // to "production" on the live service; local dev gets "development".
    environment: process.env.NODE_ENV || 'production',

    // Tag every event with the deployed commit so stack traces map back
    // to a known revision. Railway exposes the SHA via this env var.
    release: process.env.RAILWAY_GIT_COMMIT_SHA
      ? `akfishinfo@${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 12)}`
      : undefined,

    // Sample 10% of transactions for performance tracing. Bumping this
    // costs quota; 10% is a reasonable default for a low-traffic service.
    tracesSampleRate: 0.1,

    // DON'T attach the user's IP, cookies, or request headers automatically.
    // We do session auth so the user context is captured via setUser elsewhere
    // (TODO: hook into passport.serializeUser).
    sendDefaultPii: false,
  });
}

module.exports = Sentry;
