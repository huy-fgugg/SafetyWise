const fields = ['serverUrl', 'studentCode', 'enrollToken', 'studentEmail', 'studentName'];
const body = document.getElementById('form');

chrome.runtime.sendMessage({ type: 'sw-get-config' }, cfg => {
  if (!cfg) return;
  if (cfg.studentId) { showLocked(); return; }
  fields.forEach(f => { if (cfg[f]) { const el = document.getElementById(f); if (el) el.value = cfg[f]; } });
});

function setStatus(t, ok) { const s = document.getElementById('status'); s.textContent = t; s.className = 'status' + (ok ? ' ok' : ''); }

function showLocked() {
  document.getElementById('setup').style.display = 'none';
  document.getElementById('locked').style.display = 'block';
}

document.getElementById('save').onclick = () => {
  const config = {};
  fields.forEach(f => { const el = document.getElementById(f); if (el) config[f] = el.value.trim(); });
  if (!config.studentCode && !config.enrollToken) { setStatus('Enter the enrollment code from your dashboard'); return; }
  setStatus('Enrolling…');
  chrome.runtime.sendMessage({ type: 'sw-save-config', config }, res => {
    if (res && res.ok) { setStatus('Enrolled ✓', true); setTimeout(showLocked, 700); }
    else if (res && res.locked) showLocked();
    else setStatus('Could not enroll — check the server URL and code');
  });
};
