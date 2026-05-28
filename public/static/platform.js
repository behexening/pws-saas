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
            // Bearer token (saved by login.html / setup flows) — used
            // as a fallback when WKWebView refuses to replay the
            // session cookie cross-origin. No-op when none stored.
            try {
              var bearer = localStorage.getItem('akfi.bearer');
              if (bearer && !headers.has('Authorization')) {
                headers.set('Authorization', 'Bearer ' + bearer);
              }
            } catch (_) {}
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
      // Backend-routed paths (/auth/logout, /api/..., /verify-email, …)
      // are NOT bundled HTML files. Don't .html them — navigate to the
      // real backend URL instead so the server can do its redirect / set
      // cookies / clear sessions. The previous .html append made
      // 'Sign out' silently fail on the native shell because there is
      // no /auth/logout.html in the bundle.
      if (shouldRouteToBackend(url)) {
        window.location.href = BACKEND_ORIGIN + url;
        return;
      }
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
      // /auth/logout is special on native: hitting it as a navigation
      // would leave the WebView on akfishinfo.com after the server
      // redirect. Instead fetch it to clear the session cookie + drop
      // the local bearer, then nav back to the bundled login page.
      if (href === '/auth/logout') {
        fetch('/auth/logout', { credentials: 'include' })
          .catch(function () { /* clear local state anyway */ })
          .then(function () {
            try { localStorage.removeItem('akfi.bearer'); } catch (_) {}
            akfiNav('/login');
          });
        return;
      }
      akfiNav(href);
    }, true);
  }

  // ── Deep-link bearer handoff from in-app OAuth ─────────────
  // Native OAuth flows that have to run in SFSafariViewController
  // (Google rejects WKWebView for OAuth) redirect to /auth/native-return,
  // which JS-redirects to info.akfish.app://auth-return#bearer=<JWT>.
  // iOS dismisses Safari and fires App.appUrlOpen here. We stash the
  // bearer and navigate the WebView to /app. The same mechanism is
  // reusable for any future scheme-based handoff.
  if (isNative && Cap && Cap.Plugins && Cap.Plugins.App) {
    try {
      Cap.Plugins.App.addListener('appUrlOpen', function (data) {
        var url = (data && data.url) || '';
        if (url.indexOf('info.akfish.app://auth-return') !== 0) return;
        var qs = '';
        var qmark = url.indexOf('?');
        var hash  = url.indexOf('#');
        if (qmark >= 0) qs = url.substring(qmark + 1);
        else if (hash >= 0) qs = url.substring(hash + 1);
        var params = new URLSearchParams(qs);
        var bearer = params.get('bearer');
        var err    = params.get('error');
        if (Cap.Plugins.Browser) {
          try { Cap.Plugins.Browser.close(); } catch (_) {}
        }
        if (err || !bearer) {
          console.error('native-return: no bearer:', err || 'missing');
          akfiNav('/login?error=google-native');
          return;
        }
        try { localStorage.setItem('akfi.bearer', bearer); } catch (_) {}
        akfiNav('/app');
      });
    } catch (e) {
      console.warn('appUrlOpen listener failed:', e);
    }
  }

  // ── Subtle haptic feedback on tap (native only) ────────────
  // Fires a light impact when any button or .btn is tapped. iOS users
  // expect this; Android Capacitor maps it to vibrate. On web it's
  // a no-op. Disabled controls don't fire.
  if (isNative && Cap && Cap.Plugins && Cap.Plugins.Haptics) {
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest('button, .btn, [role="button"]');
      if (!t) return;
      if (t.disabled || t.getAttribute('aria-disabled') === 'true') return;
      try { Cap.Plugins.Haptics.impact({ style: 'LIGHT' }); } catch (_) {}
    }, true);
  }

  // ── Native confirm dialog ─────────────────────────────────
  // Replacement for browser `confirm()`. The system confirm is fine but
  // looks identifiably "web" inside the Capacitor shell (rounded white
  // box, OS button styles). This one is theme-matched (sharp corners,
  // dark/light), safe-area aware, focus-trapped, and returns a Promise
  // so callers can `await akfiConfirm('...')`.
  //
  // Falls back to native confirm() if document isn't ready (e.g. early
  // in page load).
  function akfiConfirm(message, opts) {
    opts = opts || {};
    var okText     = opts.ok     || 'OK';
    var cancelText = opts.cancel || 'Cancel';
    var destructive = !!opts.destructive;
    if (typeof document === 'undefined' || !document.body) {
      return Promise.resolve(window.confirm(message));
    }
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
        'display:flex;align-items:center;justify-content:center;' +
        'padding:max(20px,env(safe-area-inset-left)) max(20px,env(safe-area-inset-right));' +
        'padding-top:max(20px,env(safe-area-inset-top));' +
        'padding-bottom:max(20px,env(safe-area-inset-bottom));' +
        'z-index:99999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
      var bg     = getComputedStyle(document.documentElement).getPropertyValue('--surface') || '#0d1520';
      var bord   = getComputedStyle(document.documentElement).getPropertyValue('--border')  || '#1a2d3f';
      var text   = getComputedStyle(document.documentElement).getPropertyValue('--text')    || '#dde8f4';
      var muted  = getComputedStyle(document.documentElement).getPropertyValue('--muted')   || '#5a7288';
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent')  || '#00b4d8';
      var closed = getComputedStyle(document.documentElement).getPropertyValue('--closed')  || '#ef4444';
      var primaryBg = destructive ? closed : accent;

      var panel = document.createElement('div');
      panel.style.cssText =
        'background:' + bg + ';border:1px solid ' + bord + ';' +
        'min-width:280px;max-width:420px;width:100%;padding:18px 18px 14px;' +
        'box-shadow:0 14px 36px rgba(0,0,0,0.5);';
      var msg = document.createElement('div');
      msg.textContent = message;
      msg.style.cssText = 'color:' + text + ';font-size:0.95rem;line-height:1.45;' +
                          'margin-bottom:18px;white-space:pre-wrap;';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = cancelText;
      cancel.style.cssText =
        'padding:10px 16px;min-height:44px;background:transparent;border:1px solid ' + bord + ';' +
        'color:' + muted + ';font-size:0.875rem;font-weight:600;cursor:pointer;' +
        'border-radius:0;font-family:inherit;';

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = okText;
      ok.style.cssText =
        'padding:10px 18px;min-height:44px;background:' + primaryBg + ';border:none;' +
        'color:#000;font-size:0.875rem;font-weight:700;letter-spacing:0.04em;' +
        'text-transform:uppercase;cursor:pointer;border-radius:0;font-family:inherit;';

      row.appendChild(cancel); row.appendChild(ok);
      panel.appendChild(msg); panel.appendChild(row); backdrop.appendChild(panel);

      function close(answer) {
        document.body.removeChild(backdrop);
        document.removeEventListener('keydown', onKey, true);
        resolve(answer);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
        if (ev.key === 'Enter')  { ev.preventDefault(); close(true);  }
      }
      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click',     function () { close(true);  });
      backdrop.addEventListener('click', function (ev) {
        if (ev.target === backdrop) close(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      setTimeout(function () { ok.focus(); }, 10);
    });
  }
  window.akfiConfirm = akfiConfirm;

  // ── Subtle haptic feedback on tap (native only) ────────────
  // Fires a light impact when any button or .btn is tapped. iOS users
  // expect this; Android Capacitor maps it to vibrate. On web it's
  // a no-op. Disabled controls don't fire.
  if (isNative && Cap && Cap.Plugins && Cap.Plugins.Haptics) {
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest('button, .btn, [role="button"]');
      if (!t) return;
      if (t.disabled || t.getAttribute('aria-disabled') === 'true') return;
      try { Cap.Plugins.Haptics.impact({ style: 'LIGHT' }); } catch (_) {}
    }, true);
  }

  window.akfiPlatform = {
    isNative: isNative,
    platform: platform,
    clientHeader: clientHeader,
    backendOrigin: BACKEND_ORIGIN,
    nav: akfiNav,
    confirm: akfiConfirm
  };
})();
