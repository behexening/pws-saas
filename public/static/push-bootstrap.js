(function () {
  // Native push registration. Safe to include on every page — it no-ops
  // unless the page is running inside a Capacitor shell with the plugin
  // registered. Requires the user to already be signed in; the
  // POST /api/devices/register endpoint requires session auth.
  //
  // Permission flow on iOS:
  //   requestPermissions() → system permission sheet (only first time)
  //   register()           → triggers the APNs registration handshake
  //   addListener('registration', ...) → fires once with the device token
  //
  // We POST the token to /api/devices/register every time the listener
  // fires. The endpoint is idempotent (UPSERT on the unique constraint),
  // so re-registering on every app launch is fine and is in fact how we
  // refresh last_seen_at.

  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) {
    return;
  }
  const PN = Cap.Plugins && Cap.Plugins.PushNotifications;
  if (!PN) return;

  const platform = Cap.getPlatform();
  if (platform !== 'ios' && platform !== 'android') return;

  let registered = false;

  PN.addListener('registration', async function (token) {
    if (registered) return;
    registered = true;
    try {
      const resp = await fetch('/api/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token.value, platform: platform }),
      });
      if (!resp.ok) {
        registered = false;
        console.error('push-bootstrap: register POST failed', resp.status);
      }
    } catch (e) {
      registered = false;
      console.error('push-bootstrap: register POST threw', e);
    }
  });

  PN.addListener('registrationError', function (err) {
    console.error('push-bootstrap: APNs/FCM registration error', err);
  });

  (async function go() {
    try {
      const perm = await PN.checkPermissions();
      let receive = perm && perm.receive;
      if (receive === 'prompt' || receive === 'prompt-with-rationale') {
        const req = await PN.requestPermissions();
        receive = req && req.receive;
      }
      if (receive !== 'granted') return;  // user denied — respect it
      await PN.register();
    } catch (e) {
      console.error('push-bootstrap failed', e);
    }
  })();
})();
