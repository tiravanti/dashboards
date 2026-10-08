/* Portal sign-in (Google Identity Services).
 *
 * The page never decides who may see data: it only obtains a Google ID token and sends it with each
 * API call; the Apps Script verifies the token and the e-mail. Hiding the UI before sign-in is courtesy,
 * not security.
 */
(function () {
  var cfg = window.PORTAL_CONFIG || {};
  var KEY = 'portal.idtoken';
  var handlers = { signedIn: function () {}, signedOut: function () {} };
  var gisReady = false, waiters = [];

  function decode(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }
  function secondsLeft(t) { var p = decode(t); return p ? p.exp - Date.now() / 1000 : -1; }
  function stored() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function store(t) { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (e) {} }

  function currentToken() { var t = stored(); return t && secondsLeft(t) > 30 ? t : null; }

  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    store(resp.credential);
    var w = waiters; waiters = [];
    w.forEach(function (fn) { fn(resp.credential); });
    handlers.signedIn(resp.credential, decode(resp.credential));
  }

  function loadGis(cb) {
    if (window.google && google.accounts && google.accounts.id) return cb();
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = cb;
    s.onerror = function () { showMsg('Could not load Google sign-in. Check your connection or content blocker.'); };
    document.head.appendChild(s);
  }

  function showMsg(text) { var el = document.getElementById('gateMsg'); if (el) el.textContent = text || ''; }

  function initGis() {
    if (gisReady) return;
    if (!cfg.GOOGLE_CLIENT_ID || /PASTE_/.test(cfg.GOOGLE_CLIENT_ID)) { showMsg('Sign-in is not configured yet (config.js).'); return; }
    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID, callback: onCredential,
      auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true
    });
    gisReady = true;
  }

  function renderButton() {
    var slot = document.getElementById('gSignIn');
    if (!slot || !gisReady) return;
    slot.innerHTML = '';
    google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  }

  var Portal = {
    /** opts: { signedIn(token, payload), signedOut() } */
    init: function (opts) {
      handlers.signedIn = opts.signedIn || handlers.signedIn;
      handlers.signedOut = opts.signedOut || handlers.signedOut;
      var t = currentToken();
      if (t) handlers.signedIn(t, decode(t)); else handlers.signedOut();
      loadGis(function () {
        initGis();
        if (!currentToken()) { renderButton(); if (gisReady) google.accounts.id.prompt(); }
      });
      // Refresh quietly shortly before the 1-hour token lapses (auto_select makes this seamless when possible).
      setInterval(function () {
        var tk = stored();
        if (tk && secondsLeft(tk) < 300 && gisReady) google.accounts.id.prompt();
      }, 60000);
    },
    /** Resolves with a valid token, asking Google for a fresh one if needed; rejects after 15 s. */
    token: function () {
      var t = currentToken();
      if (t) return Promise.resolve(t);
      return new Promise(function (resolve, reject) {
        waiters.push(resolve);
        if (gisReady) google.accounts.id.prompt();
        setTimeout(function () { reject(new Error('signin_required')); }, 15000);
      });
    },
    signOut: function () {
      store(null);
      if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
      handlers.signedOut();
      renderButton();
    },
    /** Called when the API says the token was rejected. */
    rejected: function (message) {
      store(null);
      handlers.signedOut();
      showMsg(message || '');
      renderButton();
    },
    decode: decode
  };
  window.Portal = Portal;
})();
