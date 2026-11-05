// SafetyWise background service worker (MV3).
importScripts('config.js');

let studentId = null;
let lockOverlayTabs = new Set();

async function getConfig() {
  const stored = await chrome.storage.local.get(['serverUrl', 'studentCode', 'enrollToken', 'studentEmail', 'studentName', 'studentId']);
  return {
    serverUrl: (stored.serverUrl || SW_DEFAULTS.serverUrl).replace(/\/$/, ''),
    studentCode: stored.studentCode || SW_DEFAULTS.studentCode,
    enrollToken: stored.enrollToken || SW_DEFAULTS.enrollToken,
    studentEmail: stored.studentEmail || SW_DEFAULTS.studentEmail,
    studentName: stored.studentName || SW_DEFAULTS.studentName,
    studentId: stored.studentId || null
  };
}

async function enroll() {
  const c = await getConfig();
  if (c.studentId) { studentId = c.studentId; return studentId; }
  // Not set up yet: wait until an enrollment code (or email/name) is entered in the popup.
  if (!c.studentCode && !c.studentEmail && !c.studentName) return null;
  try {
    const r = await fetch(c.serverUrl + '/api/agent/enroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c.studentCode, token: c.enrollToken, email: c.studentEmail, name: c.studentName, deviceId: await deviceId() })
    });
    if (!r.ok) return null;
    const d = await r.json();
    studentId = d.studentId;
    await chrome.storage.local.set({ studentId });
    return studentId;
  } catch (e) { return null; }
}

async function deviceId() {
  const s = await chrome.storage.local.get('deviceId');
  if (s.deviceId) return s.deviceId;
  const id = 'dev_' + Math.random().toString(36).slice(2, 10);
  await chrome.storage.local.set({ deviceId: id });
  return id;
}

async function activeTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const all = await chrome.tabs.query({});
  return { url: tab?.url || '', title: tab?.title || '', tabId: tab?.id, tabs: all.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) };
}

async function report() {
  const c = await getConfig();
  if (!studentId) { if (!(await enroll())) return; }
  const info = await activeTabInfo();
  try {
    const r = await fetch(c.serverUrl + '/api/agent/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, url: info.url, title: info.title, tabs: info.tabs })
    });
    if (!r.ok) return;
    const cmd = await r.json();
    await applyCommands(cmd, info.tabId, info.url);
  } catch (e) { /* offline; try again next tick */ }
}

// Release this device: clear stored enrollment so the popup returns to setup.
async function doUnlink() {
  studentId = null;
  try { await chrome.storage.local.clear(); } catch (e) {}
  // notify student overlay to clear
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) { if (t.id && /^https?:/.test(t.url || '')) { try { await chrome.tabs.sendMessage(t.id, { type: 'sw-state', lock: false, message: '' }); } catch {} } }
}

async function applyCommands(cmd, tabId, url) {
  // Unlink: admin released this device — clear everything and return to setup.
  if (cmd.unlink) { await doUnlink(); return; }
  // Block current page
  if (cmd.block && tabId != null && url && !url.startsWith(chrome.runtime.getURL(''))) {
    const dest = chrome.runtime.getURL('blocked.html') + '?u=' + encodeURIComponent(url) + '&r=' + encodeURIComponent(cmd.block.note || 'Blocked');
    try { await chrome.tabs.update(tabId, { url: dest }); } catch {}
    return;
  }
  // Focus a specific tab on the student's device (teacher clicked "Open" in the tab list)
  if (cmd.focusTab) {
    try {
      let target = null;
      if (cmd.focusTab.id != null) { try { target = await chrome.tabs.get(cmd.focusTab.id); } catch {} }
      if (!target && cmd.focusTab.url) { const all = await chrome.tabs.query({}); target = all.find(t => t.url === cmd.focusTab.url); }
      if (target && target.id != null) { await chrome.tabs.update(target.id, { active: true }); if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true }); }
    } catch {}
  }
  // Close tab command (one-shot)
  if (cmd.closeTab && tabId != null) { try { await chrome.tabs.remove(tabId); } catch {} }
  // Lock: show overlay via content script on all tabs
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !/^https?:/.test(t.url || '')) continue;
    try { await chrome.tabs.sendMessage(t.id, { type: 'sw-state', lock: !!cmd.lock, message: cmd.message || '' }); } catch {}
  }
}

chrome.runtime.onInstalled.addListener(() => { enroll(); chrome.alarms.create('report', { periodInMinutes: 0.1 }); });
chrome.runtime.onStartup.addListener(() => { enroll(); chrome.alarms.create('report', { periodInMinutes: 0.1 }); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'report') report(); });
chrome.tabs.onActivated.addListener(() => report());
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) report(); });

// allow popup/content to query state
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'sw-get-config') { getConfig().then(sendResponse); return true; }
  if (msg.type === 'sw-save-config') {
    // Enrollment is permanent: once a device is enrolled it cannot be re-pointed or cleared from here.
    chrome.storage.local.get('studentId').then(({ studentId: existing }) => {
      if (existing) { sendResponse({ ok: false, locked: true }); return; }
      chrome.storage.local.set(msg.config).then(() => enroll().then(id => sendResponse({ ok: !!id, locked: false })));
    });
    return true;
  }
  if (msg.type === 'sw-report-now') { report().then(() => sendResponse({ ok: true })); return true; }
});
