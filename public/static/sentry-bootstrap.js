(function () {
  // Sentry browser SDK loader. Uses Sentry's "Loader Script" pattern so
  // we don't have to bundle the full SDK ourselves — the loader is ~10KB
  // and lazy-fetches the rest only when an error or transaction needs it.
  //
  // The hash in the URL is the *public key* portion of our DSN. It's
  // safe to hardcode — Sentry public keys are designed for client-side
  // use; they can only write events, not read the project.
  //
  // Captures errors on:
  //   - akfishinfo.com web pages
  //   - The iOS Capacitor WebView (which loads prod via `server.url`)
  // Same Sentry project receives both; filter by `environment` tag.

  if (window.__akfiSentryLoaded) return;
  window.__akfiSentryLoaded = true;

  // Configure the SDK after it auto-initializes. Sentry fires
  // `sentryOnLoad` once the loader has bootstrapped enough to accept
  // settings — at which point we can override sample rates, env, etc.
  window.sentryOnLoad = function () {
    if (!window.Sentry || !window.Sentry.init) return;
    var Cap = window.Capacitor;
    var platform = 'web';
    if (Cap && typeof Cap.getPlatform === 'function') platform = Cap.getPlatform();

    window.Sentry.init({
      environment: location.hostname === 'akfishinfo.com' ? 'production' : 'development',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      initialScope: {
        tags: {
          surface: Cap && Cap.isNativePlatform && Cap.isNativePlatform()
            ? ('native-' + platform)
            : 'web',
        },
      },
    });
  };

  var s = document.createElement('script');
  s.src = 'https://js.sentry-cdn.com/190c4393228ba3b7ce8143b508fdca96.min.js';
  s.crossOrigin = 'anonymous';
  s.defer = true;
  document.head.appendChild(s);
})();
