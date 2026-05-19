(function () {
  // Sets data-platform on <html> before paint, and adds X-Client to same-origin
  // fetch + XHR so the backend can tell native iOS/Android apart from the web.
  // Include this BEFORE other scripts so the platform attribute is set early.
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

  if (isNative && clientHeader) {
    // Monkey-patch fetch for same-origin requests so /api routes see X-Client.
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var isSameOrigin = !url || url.charAt(0) === '/' || url.indexOf(location.origin) === 0;
          if (isSameOrigin) {
            init = init || {};
            var headers = new Headers((init && init.headers) || (typeof input !== 'string' && input ? input.headers : null) || undefined);
            if (!headers.has('X-Client')) headers.set('X-Client', clientHeader);
            init.headers = headers;
          }
        } catch (e) { /* swallow — never break a request */ }
        return origFetch(input, init);
      };
    }

    // XHR fallback for any code path not using fetch.
    var XHR = window.XMLHttpRequest;
    if (XHR) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__akfi_url = url;
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        try {
          var u = this.__akfi_url || '';
          var sameOrigin = !u || u.charAt(0) === '/' || u.indexOf(location.origin) === 0;
          if (sameOrigin) this.setRequestHeader('X-Client', clientHeader);
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  }

  window.akfiPlatform = {
    isNative: isNative,
    platform: platform,
    clientHeader: clientHeader
  };
})();
