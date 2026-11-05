const fields = ['serverUrl', 'studentCode', 'enrollToken', 'studentEmail', 'studentName'];
chrome.runtime.sendMessage({ type: 'sw-get-config' }, cfg => {
  if (!cfg) return;
  fields.forEach(f => { if (cfg[f]) document.getElementById(f).value = cfg[f]; });
  if (cfg.studentId) setStatus('Enrolled ✓', true);
});
function setStatus(t, ok) { const s = document.getElementById('status'); s.textContent = t; s.className = 'status' + (ok ? ' ok' : ''); }
document.getElementById('save').onclick = () => {
  const config = {};
  fields.forEach(f => config[f] = document.getElementById(f).value.trim());
  setStatus('Saving…');
  chrome.runtime.sendMessage({ type: 'sw-save-config', config }, res => {
    if (res && res.ok) setStatus('Saved & enrolled ✓', true); else setStatus('Saved, enrollment pending — check server URL/token');
  });
};
