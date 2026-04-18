(function () {
  var STORAGE_KEY = 'akfi.theme';
  var root = document.documentElement;

  function systemPref() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
  }
  function stored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function resolve() {
    var s = stored();
    return (s === 'light' || s === 'dark') ? s : systemPref();
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"][data-dynamic]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f7fb' : '#060a0f');
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  apply(resolve());

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var handler = function () { if (!stored()) apply(resolve()); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  window.akfiTheme = {
    get: function () { return root.getAttribute('data-theme') || 'dark'; },
    set: function (theme) {
      if (theme !== 'light' && theme !== 'dark') return;
      try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
      apply(theme);
    },
    toggle: function () {
      this.set(this.get() === 'light' ? 'dark' : 'light');
    },
    clearOverride: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      apply(resolve());
    }
  };

  function wire() {
    document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(function (btn) {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = '1';
      btn.addEventListener('click', function () { window.akfiTheme.toggle(); });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
