(function () {
  // Force-update gate (Phase 6.5).
  //
  // On native shell launch, fetch /api/version/min-supported and compare
  // against the app's own CFBundleShortVersionString / versionName via
  // @capacitor/app's App.getInfo(). Three states:
  //
  //   currentVersion <  min          → hard block (modal can't be dismissed)
  //   currentVersion <  recommended  → soft banner ("Update available")
  //   currentVersion >= recommended  → silent no-op
  //
  // Web users see nothing — they get the latest HTML on every navigation.
  // The endpoint defaults to '0.0.0' min so a brand-new server returns
  // no-gate; production should set IOS_MIN_VERSION when a v1.0 bug
  // surfaces in the wild.

  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  const platform = Cap.getPlatform();
  if (platform !== 'ios' && platform !== 'android') return;

  const App = Cap.Plugins && Cap.Plugins.App;
  if (!App || typeof App.getInfo !== 'function') return;

  // major.minor.patch compare. Returns +1 if a > b, -1 if a < b, 0 equal.
  function cmpVersion(a, b) {
    const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const av = pa[i] || 0;
      const bv = pb[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function openStore(url) {
    if (!url) return;
    // capacitor:// origin can't navigate to https:// directly without
    // breaking the WebView; window.open uses the system browser handler.
    try { window.open(url, '_blank'); } catch (_) { window.location.href = url; }
  }

  function showHardBlock(storeUrl, current, min) {
    if (document.getElementById('akfi-force-update')) return;
    const overlay = document.createElement('div');
    overlay.id = 'akfi-force-update';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'akfi-fu-title');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.92);' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:env(safe-area-inset-top) 18px env(safe-area-inset-bottom);' +
      'color:var(--text,#dde8f4);font-family:-apple-system,BlinkMacSystemFont,sans-serif';
    overlay.innerHTML =
      '<div style="background:var(--surface,#0d1520);border:1px solid var(--border,#1a2d3f);' +
      'padding:28px 22px;max-width:340px;width:100%;text-align:center">' +
        '<h2 id="akfi-fu-title" style="font-size:1.25rem;font-weight:700;margin:0 0 10px">' +
          'Update Required' +
        '</h2>' +
        '<p style="font-size:0.875rem;line-height:1.55;color:var(--muted,#5a7288);margin:0 0 18px">' +
          'This version of akFISHinfo is no longer supported. ' +
          'Please update to keep receiving openings alerts.' +
        '</p>' +
        '<p style="font-size:0.6875rem;color:var(--muted,#5a7288);margin:0 0 18px">' +
          'You have ' + current + ', minimum is ' + min +
        '</p>' +
        '<button type="button" id="akfi-fu-update" ' +
          'style="background:var(--accent,#00b4d8);color:#000;border:0;' +
          'padding:12px 24px;font-size:0.875rem;font-weight:700;' +
          'letter-spacing:-0.01em;cursor:pointer;min-height:44px;min-width:160px">' +
          'Update now' +
        '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('akfi-fu-update').addEventListener('click', () => openStore(storeUrl));
  }

  function showSoftBanner(storeUrl) {
    if (document.getElementById('akfi-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'akfi-update-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));' +
      'z-index:9999;background:var(--surface,#0d1520);border:1px solid var(--accent,#00b4d8);' +
      'padding:10px 14px;display:flex;align-items:center;justify-content:space-between;' +
      'gap:12px;color:var(--text,#dde8f4);font-size:0.75rem;' +
      'box-shadow:0 6px 18px rgba(0,0,0,0.35)';
    banner.innerHTML =
      '<span>Update available</span>' +
      '<span style="display:flex;gap:6px">' +
        '<button type="button" id="akfi-banner-update" style="background:var(--accent,#00b4d8);color:#000;' +
          'border:0;padding:6px 12px;font-size:0.6875rem;font-weight:700;letter-spacing:0.05em;' +
          'text-transform:uppercase;cursor:pointer">Update</button>' +
        '<button type="button" id="akfi-banner-dismiss" style="background:transparent;color:var(--muted,#5a7288);' +
          'border:1px solid var(--border,#1a2d3f);padding:6px 10px;font-size:0.6875rem;cursor:pointer">' +
          'Later</button>' +
      '</span>';
    document.body.appendChild(banner);
    document.getElementById('akfi-banner-update').addEventListener('click', () => openStore(storeUrl));
    document.getElementById('akfi-banner-dismiss').addEventListener('click', () => {
      banner.remove();
      try { sessionStorage.setItem('akfi.update.dismissed', '1'); } catch (_) {}
    });
  }

  (async function go() {
    try {
      const info = await App.getInfo();
      const current = info && info.version;
      if (!current) return;

      const r = await fetch('/api/version/min-supported');
      if (!r.ok) return;
      const cfg = await r.json();
      const cfgP = cfg && cfg[platform];
      if (!cfgP) return;

      if (cmpVersion(current, cfgP.min) < 0) {
        showHardBlock(cfgP.store_url, current, cfgP.min);
        return;
      }
      if (cmpVersion(current, cfgP.recommended) < 0) {
        try {
          if (sessionStorage.getItem('akfi.update.dismissed') === '1') return;
        } catch (_) {}
        showSoftBanner(cfgP.store_url);
      }
    } catch (e) {
      console.error('version-check failed', e);
    }
  })();
})();
