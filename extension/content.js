// SafetyWise content script: renders a lock screen / teacher message overlay.
(function () {
  let host = null;
  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = '__safetywise_overlay__';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .wrap{position:fixed;inset:0;background:rgba(10,14,22,.97);display:grid;place-items:center;font-family:system-ui,sans-serif;color:#e8edf6;text-align:center;padding:24px}
        .logo{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#22d3ee);display:grid;place-items:center;color:#04121f;font-weight:900;font-size:28px;margin:0 auto 18px}
        h1{font-size:26px;margin:0 0 8px}
        p{color:#8b97ad;max-width:420px;margin:0 auto;font-size:15px;line-height:1.5}
        .msg{margin-top:20px;padding:16px 20px;background:#171e2e;border:1px solid #2a3348;border-radius:12px;max-width:460px;font-size:16px}
      </style>
      <div class="wrap">
        <div>
          <div class="logo">S</div>
          <h1 id="title">Screen paused</h1>
          <p id="sub">Your teacher has paused your screen. Please look up front.</p>
          <div class="msg" id="msg" style="display:none"></div>
        </div>
      </div>`;
    (document.documentElement || document.body).appendChild(host);
    return host;
  }

  function show(lock, message) {
    const h = ensureHost();
    const shadow = h.shadowRoot;
    const msgEl = shadow.getElementById('msg');
    if (lock) {
      h.style.display = 'block';
      shadow.getElementById('title').textContent = 'Screen paused';
      shadow.getElementById('sub').style.display = 'block';
      if (message) { msgEl.style.display = 'block'; msgEl.textContent = message; } else { msgEl.style.display = 'none'; }
    } else if (message) {
      // message-only: brief banner using the overlay but non-blocking-ish (still overlay, dismiss after delay)
      h.style.display = 'block';
      shadow.getElementById('title').textContent = 'Message from your teacher';
      shadow.getElementById('sub').style.display = 'none';
      msgEl.style.display = 'block'; msgEl.textContent = message;
      setTimeout(() => { h.style.display = 'none'; }, 8000);
    } else {
      h.style.display = 'none';
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'sw-state') show(msg.lock, msg.message);
  });
})();
