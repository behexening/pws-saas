(function () {
  // Sets data-platform on <html> before paint and monkey-patches
  // fetch + XHR so requests from the Capacitor native shell can reach
  // the backend at akfishinfo.com.
  //
  // When loaded from akfishinfo.com directly (regular web users), this
  // file does almost nothing — `isNative` is false and the patches are
  // skipped. Backend is same-origin, no URL rewriting needed.
  //
  // When loaded from the bundled Capacitor shell, the WebView origin is:
  //   - iOS:     capacitor://localhost
  //   - Android: https://localhost  (via androidScheme: "https")
  // The bundled HTML calls relative URLs like /api/me — those would
  // resolve to <capacitor://localhost>/api/me which doesn't exist. So
  // we rewrite same-origin paths to https://akfishinfo.com/<path> and
  // force `credentials: 'include'` so the session cookie travels with
  // the cross-origin request.
  //
  // The cookie itself is set SameSite=None;Secure on the backend, which
  // is REQUIRED for the WebView to send it on cross-origin fetches.
  // Include this BEFORE other scripts so the platform attribute is set early.

  var BACKEND_ORIGIN = 'https://akfishinfo.com';
  // Same-origin path prefixes the bundle uses but that we want to
  // route to the real backend instead of capacitor://localhost.
  var BACKEND_PATH_PREFIXES = ['/api', '/auth', '/webhooks', '/health',
                                '/verify-email', '/results', '/awc-points.json'];

  var root = document.documentElement;
  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  var platform = (Cap && typeof Cap.getPlatform === 'function') ? Cap.getPlatform() : 'web';

  root.setAttribute('data-platform', platform);
  if (isNative) root.setAttribute('data-native', '1');

  var clientHeader =
    platform === 'ios'     ? 'native-ios' :
    platform === 'android' ? 'native-android' :
    null;

  function shouldRouteToBackend(url) {
    if (!url) return false;
    // Already absolute to backend? Leave it.
    if (url.indexOf(BACKEND_ORIGIN) === 0) return false;
    // Other absolute URLs (unpkg, Sentry CDN, Apple JWKS, etc.) — leave alone.
    if (/^https?:\/\//.test(url)) return false;
    // Same-origin path on the WebView (e.g. capacitor://localhost/api/...).
    // Strip the host if any, then match path against backend prefixes.
    var path = url.charAt(0) === '/' ? url
             : url.indexOf(location.origin) === 0 ? url.slice(location.origin.length)
             : null;
    if (!path) return false;
    for (var i = 0; i < BACKEND_PATH_PREFIXES.length; i++) {
      var p = BACKEND_PATH_PREFIXES[i];
      if (path === p || path.indexOf(p + '/') === 0 || path.indexOf(p + '?') === 0) return true;
    }
    return false;
  }

  function rewriteUrl(url) {
    var path = url.charAt(0) === '/' ? url : url.slice(location.origin.length);
    return BACKEND_ORIGIN + path;
  }

  if (isNative && clientHeader) {
    // ── fetch ─────────────────────────────────────────────────
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var route = shouldRouteToBackend(url);
          if (route) {
            // Rewrite input. If it was a Request object, rebuild because
            // Request URL is immutable.
            if (typeof input === 'string') {
              input = rewriteUrl(input);
            } else if (input && input.url) {
              input = new Request(rewriteUrl(input.url), input);
            }
            init = init || {};
            var headers = new Headers((init && init.headers) ||
              (typeof input !== 'string' && input ? input.headers : null) || undefined);
            if (!headers.has('X-Client')) headers.set('X-Client', clientHeader);
            init.headers = headers;
            // Cross-origin session cookie travel requires this.
            if (!init.credentials) init.credentials = 'include';
          }
        } catch (e) { /* swallow — never break a request */ }
        return origFetch(input, init);
      };
    }

    // ── XHR ───────────────────────────────────────────────────
    var XHR = window.XMLHttpRequest;
    if (XHR) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        if (shouldRouteToBackend(url)) {
          args[1] = rewriteUrl(url);
          this.__akfi_routed = true;
        }
        this.__akfi_url = args[1];
        return origOpen.apply(this, args);
      };
      XHR.prototype.send = function () {
        try {
          if (this.__akfi_routed) {
            this.withCredentials = true;
            this.setRequestHeader('X-Client', clientHeader);
          }
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  }

  // ── Navigation helper ─────────────────────────────────────
  // The bundled Capacitor WebView serves files literally — there's no
  // Express-style /login → login.html mapping. We rewrite extensionless
  // internal paths to add `.html` before navigating. Use this anywhere
  // the JS would otherwise do `location.href = '/setup'`.
  //
  // On web, this is a no-op pass-through.
  function akfiNav(url) {
    if (!url) return;
    // Absolute URL? Leave alone (e.g. Stripe portal links, external sites).
    if (/^https?:\/\//.test(url)) {
      window.location.href = url;
      return;
    }
    if (isNative && url.charAt(0) === '/' && url.indexOf('.') === -1) {
      // Preserve query string + hash. Insert .html before them.
      var match = url.match(/^([^?#]*)(.*)$/);
      var pathPart = match[1];
      var qsHash = match[2];
      url = pathPart + '.html' + qsHash;
    }
    window.location.href = url;
  }
  window.akfiNav = akfiNav;

  // Document-wide click interceptor — catches <a href="/login"> style
  // anchor navigation in HTML without needing every page to call
  // akfiNav directly. Only runs on native; web users get default behavior.
  if (isNative) {
    document.addEventListener('click', function (ev) {
      // Walk up from the click target to find an <a> ancestor.
      var el = ev.target;
      while (el && el.nodeName !== 'A') el = el.parentElement;
      if (!el) return;
      var href = el.getAttribute('href');
      if (!href) return;
      // Ignore anchors that have explicit targets (e.g. target="_blank"),
      // mail/tel links, JS handlers, or already-absolute URLs.
      if (el.target && el.target !== '_self') return;
      if (/^(https?:|mailto:|tel:|javascript:|#)/i.test(href)) return;
      // Only extensionless internal paths need rewriting.
      if (href.charAt(0) !== '/' || href.indexOf('.') !== -1) return;
      ev.preventDefault();
      akfiNav(href);
    }, true);
  }

  window.akfiPlatform = {
    isNative: isNative,
    platform: platform,
    clientHeader: clientHeader,
    backendOrigin: BACKEND_ORIGIN,
    nav: akfiNav
  };
})();
