'use strict';
const token = localStorage.getItem('sw_token');
const role = localStorage.getItem('sw_role');
const myName = localStorage.getItem('sw_name');
if (!token) location.href = '/login.html';

const main = document.getElementById('main');
document.getElementById('who').innerHTML = `${esc(myName)}<br><span class="pill ${role === 'admin' ? 'admin' : ''}">${role}</span>`;
document.getElementById('logout').onclick = async () => {
  await api('/api/logout', 'POST').catch(() => {});
  localStorage.clear(); location.href = '/login.html';
};

// hide admin-only nav for teachers
if (role !== 'admin') document.querySelectorAll('[data-admin]').forEach(n => n.classList.add('hidden'));

let STATE = null;
let currentView = 'overview';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) { const t = document.getElementById('toast'); t.innerHTML = `<div class="toast">${esc(msg)}</div>`; setTimeout(() => t.innerHTML = '', 2200); }

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { localStorage.clear(); location.href = '/login.html'; return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

async function refresh() {
  STATE = await api('/api/state');
  render();
}

// nav
document.getElementById('nav').addEventListener('click', e => {
  const a = e.target.closest('a[data-view]'); if (!a) return;
  document.querySelectorAll('#nav a').forEach(x => x.classList.remove('active'));
  a.classList.add('active'); currentView = a.dataset.view; render();
});

function className(id) { const c = (STATE.classes || []).find(c => c.id === id); return c ? c.name : '—'; }
function online(s) { return s.lastSeen && (Date.now() - s.lastSeen < 90000); }

let monTimers = [];
let monClass = '';
function clearMonTimers() { monTimers.forEach(t => clearInterval(t)); monTimers = []; }
async function bulkCommand(ids, payload) { for (const id of ids) { try { await api('/api/command', 'POST', Object.assign({ studentId: id }, payload)); } catch {} } }

function render() {
  if (!STATE) return;
  clearMonTimers();
  const v = currentView;
  if (v === 'overview') return renderOverview();
  if (v === 'monitor') return renderMonitor();
  if (v === 'scenes') return renderScenes();
  if (v === 'students') return renderStudents();
  if (v === 'classes') return renderClasses();
  if (v === 'teachers') return renderTeachers();
  if (v === 'filtering') return renderFiltering();
  if (v === 'alerts') return renderAlerts();
  if (v === 'setup') return renderSetup();
}

function head(title, right = '') { return `<div class="topbar"><h2>${title}</h2><div>${right}</div></div>`; }

function renderOverview() {
  const s = STATE;
  const onlineCount = s.students.filter(online).length;
  const unseen = s.alerts.filter(a => !a.seen).length;
  main.innerHTML = head('Overview') + `
    <div class="grid cards section">
      <div class="card"><div class="stat">${s.students.length}<span class="lbl">Students</span></div></div>
      <div class="card"><div class="stat">${onlineCount}<span class="lbl">Online now</span></div></div>
      <div class="card"><div class="stat">${s.classes.length}<span class="lbl">Classes</span></div></div>
      <div class="card"><div class="stat">${s.teachers.length}<span class="lbl">Teachers</span></div></div>
      <div class="card"><div class="stat">${s.filters.length}<span class="lbl">Filter rules</span></div></div>
      <div class="card"><div class="stat" style="color:${unseen ? 'var(--warn)' : 'inherit'}">${unseen}<span class="lbl">New alerts</span></div></div>
    </div>
    <div class="card section">
      <h3>Recent activity</h3>
      <table><thead><tr><th>Student</th><th>Current page</th><th>Status</th><th>Seen</th></tr></thead><tbody>
      ${s.students.slice(0, 10).map(st => { const a = s.activity[st.id]; return `<tr>
        <td>${esc(st.name)}</td>
        <td class="student-tab">${a ? esc(a.title || a.url || '—') : '<span class="muted">no data</span>'}</td>
        <td><span class="dot ${online(st) ? 'on' : 'off'}"></span> ${online(st) ? 'online' : 'offline'}</td>
        <td class="muted">${st.lastSeen ? timeAgo(st.lastSeen) : '—'}</td></tr>`; }).join('') || '<tr><td colspan=4 class="muted">No students yet.</td></tr>'}
      </tbody></table>
    </div>`;
}

function timeAgo(t) { const s = Math.floor((Date.now() - t) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; return Math.floor(s / 3600) + 'h ago'; }

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function favicon(url) { const h = hostOf(url); return h ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=32` : ''; }

function renderMonitor() {
  const s = STATE;
  const active = s.activeScene ? (s.scenes || []).find(x => x.id === s.activeScene) : null;
  const students = monClass ? s.students.filter(x => x.classId === monClass) : s.students;
  main.innerHTML = head('Classroom', '<span class="live"><span class="dot on"></span>live</span>') + `
    <div class="scenebar ${active ? 'on' : ''}" id="sceneBar">
      ${active ? `<span>🎬 Scene active: <strong>${esc(active.name)}</strong> (${active.mode})</span><button class="sm" id="sceneOff">Stop scene</button>`
        : `<span class="muted">No scene running — base web-filter rules apply.</span><button class="sm ghost" data-goto="scenes">Manage scenes</button>`}
    </div>
    <div class="classbar">
      <select id="monClassSel">
        <option value="">All classes (${s.students.length})</option>
        ${s.classes.map(c => `<option value="${c.id}" ${monClass === c.id ? 'selected' : ''}>${esc(c.name)} (${s.students.filter(x => x.classId === c.id).length})</option>`).join('')}
      </select>
      <div class="row" style="gap:6px">
        <span class="muted" style="font-size:12px">${students.length} student${students.length === 1 ? '' : 's'} →</span>
        <button class="sm warn" data-bulk="lock">🔒 Lock all</button>
        <button class="sm ghost" data-bulk="unlock">🔓 Unlock all</button>
        <button class="sm ghost" data-bulk="focus">🎯 Focus all…</button>
        <button class="sm ghost" data-bulk="focusoff">Stop focus</button>
        <button class="sm ghost" data-bulk="msg">💬 Message all</button>
      </div>
    </div>
    <div class="classgrid" id="monGrid">
    ${students.map(st => renderStudentCard(st)).join('') || '<p class="muted">No students here yet. Add students, then enroll a device with its code.</p>'}
    </div>
    <div id="detailModal" class="modal hidden"><div class="modal-card"><button class="modal-x" id="detailX">✕</button><div id="detailBody"></div></div></div>`;
  bindMonitor();
  if (document.getElementById('sceneOff')) document.getElementById('sceneOff').onclick = async () => { await api('/api/scenes/activate', 'POST', { id: null }); toast('Scene stopped'); await refresh(); };
  main.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { currentView = b.dataset.goto; document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('active', x.dataset.view === currentView)); render(); });
  document.getElementById('monClassSel').onchange = e => { monClass = e.target.value; render(); };
  main.querySelectorAll('button[data-bulk]').forEach(b => b.onclick = () => bulkAction(b.dataset.bulk, students.map(x => x.id)));
  monTimers.push(setInterval(softUpdateMonitor, 4000));
}

function renderStudentCard(st) {
  const s = STATE;
  const a = s.activity[st.id]; const cmd = s.commands[st.id] || {};
  const tabs = (a && a.tabs) ? a.tabs.filter(t => /^https?:/.test(t.url || '')) : [];
  const cur = a ? { title: a.title, url: a.url } : null;
  const badge = cmd.lock ? '<span class="tag block">locked</span>' : (cmd.lockedTabs ? '<span class="tag">focus</span>' : '');
  return `<div class="card studentcard" id="card_${st.id}">
    <div class="sc-head" data-detail="${st.id}" title="Open details">
      <div class="row" style="gap:8px">
        <span class="dot ${online(st) ? 'on' : 'off'}"></span>
        <strong>${esc(st.name)}</strong> ${badge}
      </div>
      <span class="muted" style="font-size:11px" id="time_${st.id}">${st.lastSeen ? timeAgo(st.lastSeen) : '—'}</span>
    </div>
    <div class="curtab" id="cur_${st.id}">
      ${cur && cur.url ? `<img class="fav" src="${favicon(cur.url)}" onerror="this.style.visibility='hidden'">
        <div class="curtab-txt"><div class="curtab-title">${esc(cur.title || cur.url)}</div><div class="curtab-host">${esc(hostOf(cur.url) || cur.url)}</div></div>`
        : '<span class="muted">No activity reported</span>'}
    </div>
    <div class="tabs-wrap">
      <div class="tabs-head">Open tabs <span class="muted">(${tabs.length})</span></div>
      <div class="tablist" id="tabs_${st.id}">
        ${tabs.map(t => tabRow(st.id, t)).join('') || '<div class="muted" style="font-size:12px;padding:6px">No open tabs reported.</div>'}
      </div>
    </div>
    <div class="row sc-actions">
      <button class="sm ${cmd.lock ? 'warn' : 'ghost'}" data-act="lock" data-id="${st.id}">${cmd.lock ? '🔓 Unlock' : '🔒 Lock'}</button>
      <button class="sm ghost" data-act="msg" data-id="${st.id}">💬 Message</button>
      <button class="sm ghost" data-act="close" data-id="${st.id}">✕ Close tab</button>
    </div>
  </div>`;
}

function tabRow(sid, t) {
  const h = hostOf(t.url);
  const blocked = isBlockedNow(t.url);
  return `<div class="tabrow ${t.active ? 'active' : ''}">
    <img class="fav" src="${favicon(t.url)}" onerror="this.style.visibility='hidden'">
    <div class="tabrow-txt" title="${esc(t.url)}"><div class="tabrow-title">${esc(t.title || h || t.url)}</div><div class="tabrow-host">${esc(h)}</div></div>
    <div class="tabrow-actions">
      <button class="icon" title="Open on student screen" data-open="${sid}" data-tabid="${t.id != null ? t.id : ''}" data-url="${esc(t.url)}">↗</button>
      ${blocked
        ? `<button class="icon allow" title="Unblock ${esc(h)}" data-allow="${esc(h)}">✓</button>`
        : `<button class="icon block" title="Block ${esc(h)}" data-block="${esc(h)}">⊘</button>`}
    </div>
  </div>`;
}

// Is this URL blocked by the rules currently in force (scene or base)?
function isBlockedNow(url) {
  const s = STATE; const u = (url || '').toLowerCase();
  let mode = s.filterMode || 'blacklist'; let filters = s.filters || [];
  if (s.activeScene) { const sc = (s.scenes || []).find(x => x.id === s.activeScene); if (sc) { mode = sc.mode || 'blacklist'; filters = [...(sc.block || []).map(p => ({ type: 'block', pattern: p })), ...(sc.allow || []).map(p => ({ type: 'allow', pattern: p }))]; } }
  if (filters.some(f => f.type === 'allow' && f.pattern && u.includes(f.pattern.toLowerCase()))) return false;
  if (mode === 'whitelist') return true;
  return filters.some(f => f.type === 'block' && f.pattern && u.includes(f.pattern.toLowerCase()));
}

function bindMonitor() {
  main.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => openDetail(el.dataset.detail));
  main.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => monitorAction(b.dataset.act, b.dataset.id));
  main.querySelectorAll('button[data-open]').forEach(b => b.onclick = async () => {
    const id = b.dataset.open, tabid = b.dataset.tabid, url = b.dataset.url;
    await api('/api/command', 'POST', { studentId: id, focusTab: { id: tabid ? Number(tabid) : null, url } });
    toast('Opening tab on student device');
  });
  main.querySelectorAll('button[data-block]').forEach(b => b.onclick = async () => { await api('/api/filters', 'POST', { type: 'block', pattern: b.dataset.block }); toast('Blocked ' + b.dataset.block); await refresh(); });
  main.querySelectorAll('button[data-allow]').forEach(b => b.onclick = async () => {
    // remove any block rule for this host, and add an allow rule
    const host = b.dataset.allow;
    const toDel = (STATE.filters || []).filter(f => f.type === 'block' && f.pattern && host.includes(f.pattern) || (f.pattern && f.pattern.includes(host)));
    for (const f of toDel) { try { await api('/api/filters/' + f.id, 'DELETE'); } catch {} }
    await api('/api/filters', 'POST', { type: 'allow', pattern: host });
    toast('Unblocked ' + host); await refresh();
  });
}

async function softUpdateMonitor() {
  try {
    STATE = await api('/api/state');
    for (const st of STATE.students) {
      const card = document.getElementById('card_' + st.id);
      if (!card) continue;
      const cur = document.getElementById('cur_' + st.id);
      const tabsEl = document.getElementById('tabs_' + st.id);
      const time = document.getElementById('time_' + st.id);
      const a = STATE.activity[st.id];
      const tabs = (a && a.tabs) ? a.tabs.filter(t => /^https?:/.test(t.url || '')) : [];
      if (time) time.textContent = st.lastSeen ? timeAgo(st.lastSeen) : '—';
      if (cur) cur.innerHTML = (a && a.url) ? `<img class="fav" src="${favicon(a.url)}" onerror="this.style.visibility='hidden'"><div class="curtab-txt"><div class="curtab-title">${esc(a.title || a.url)}</div><div class="curtab-host">${esc(hostOf(a.url) || a.url)}</div></div>` : '<span class="muted">No activity reported</span>';
      if (tabsEl) tabsEl.innerHTML = tabs.map(t => tabRow(st.id, t)).join('') || '<div class="muted" style="font-size:12px;padding:6px">No open tabs reported.</div>';
    }
    bindMonitor();
  } catch {}
}

function openDetail(id) {
  const modal = document.getElementById('detailModal');
  const bodyEl = document.getElementById('detailBody');
  if (!modal || !bodyEl) return;
  function build() {
    const st = STATE.students.find(x => x.id === id); if (!st) { modal.classList.add('hidden'); return; }
    const a = STATE.activity[id]; const cmd = STATE.commands[id] || {};
    const tabs = (a && a.tabs) ? a.tabs.filter(t => /^https?:/.test(t.url || '')) : [];
    const locked = Array.isArray(cmd.lockedTabs) ? cmd.lockedTabs : [];
    bodyEl.innerHTML = `
      <div class="row" style="gap:8px;align-items:center"><span class="dot ${online(st) ? 'on' : 'off'}"></span><h3 style="margin:0">${esc(st.name)}</h3>
        ${cmd.lock ? '<span class="tag block">locked</span>' : cmd.lockedTabs ? '<span class="tag">focus mode</span>' : ''}</div>
      <div class="muted" style="font-size:12px;margin:4px 0 14px">${esc(className(st.classId))} · ${st.lastSeen ? timeAgo(st.lastSeen) : 'never seen'} · code ${esc(st.code || '—')}</div>

      <div class="row" style="gap:6px;margin-bottom:16px">
        <button class="${cmd.lock ? 'warn' : ''}" data-d="lock">${cmd.lock ? '🔓 Unlock device' : '🔒 Lock device (fullscreen)'}</button>
        <button class="ghost" data-d="msg">💬 Message</button>
        <button class="ghost" data-d="close">✕ Close current tab</button>
      </div>

      <h4 style="margin:0 0 6px">Open tabs <span class="muted">(${tabs.length})</span></h4>
      <div class="tablist" style="max-height:220px">${tabs.map(t => tabRow(id, t)).join('') || '<div class="muted" style="padding:8px;font-size:13px">No open tabs reported.</div>'}</div>

      <h4 style="margin:16px 0 4px">🎯 Focus mode — allow only these tabs</h4>
      <p class="muted" style="font-size:12px;margin:0 0 8px">The device opens only these sites and closes the rest; the student can't close them. One URL per line. Leave empty and click Apply to turn focus off.</p>
      <textarea id="dFocus" rows="4" placeholder="classroom.google.com&#10;docs.google.com">${esc(locked.join('\n'))}</textarea>
      <div class="row end" style="margin-top:8px;gap:6px">
        ${cmd.lockedTabs ? '<button class="ghost" data-d="focusoff">Turn off focus</button>' : ''}
        <button data-d="focus">Apply focus</button>
      </div>`;
    bodyEl.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { await api('/api/command', 'POST', { studentId: id, focusTab: { id: b.dataset.tabid ? Number(b.dataset.tabid) : null, url: b.dataset.url } }); toast('Opening tab on device'); });
    bodyEl.querySelectorAll('[data-block]').forEach(b => b.onclick = async () => { await api('/api/filters', 'POST', { type: 'block', pattern: b.dataset.block }); toast('Blocked ' + b.dataset.block); await refresh(); build(); });
    bodyEl.querySelectorAll('[data-allow]').forEach(b => b.onclick = async () => { await api('/api/filters', 'POST', { type: 'allow', pattern: b.dataset.allow }); toast('Unblocked ' + b.dataset.allow); await refresh(); build(); });
    bodyEl.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
      const act = b.dataset.d;
      if (act === 'lock') await api('/api/command', 'POST', { studentId: id, lock: !cmd.lock });
      if (act === 'close') await api('/api/command', 'POST', { studentId: id, closeTab: true });
      if (act === 'msg') { const m = prompt('Message to send to student:'); if (m == null) return; await api('/api/command', 'POST', { studentId: id, message: m }); toast('Message sent'); return; }
      if (act === 'focus') { const urls = document.getElementById('dFocus').value.split('\n').map(s => s.trim()).filter(Boolean); await api('/api/command', 'POST', { studentId: id, lockedTabs: urls }); toast(urls.length ? 'Focus mode applied' : 'Focus mode off'); }
      if (act === 'focusoff') await api('/api/command', 'POST', { studentId: id, lockedTabs: [] });
      await refresh(); build();
    });
  }
  build();
  modal.classList.remove('hidden');
  document.getElementById('detailX').onclick = () => modal.classList.add('hidden');
  modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
}

async function bulkAction(act, ids) {
  if (!ids.length) return toast('No students in this view');
  if (act === 'lock') { if (!confirm(`Lock ${ids.length} device(s) to a fullscreen screen?`)) return; await bulkCommand(ids, { lock: true }); toast('Locked all'); }
  if (act === 'unlock') { await bulkCommand(ids, { lock: false }); toast('Unlocked all'); }
  if (act === 'focus') { const v = prompt('Focus the class to these sites (comma-separated). Only these stay open on every device:'); if (v == null) return; const urls = v.split(',').map(s => s.trim()).filter(Boolean); await bulkCommand(ids, { lockedTabs: urls }); toast(urls.length ? 'Focus applied to class' : 'Focus off'); }
  if (act === 'focusoff') { await bulkCommand(ids, { lockedTabs: [] }); toast('Focus stopped'); }
  if (act === 'msg') { const m = prompt('Message to send to the whole class:'); if (m == null) return; await bulkCommand(ids, { message: m }); toast('Message sent to class'); }
  await refresh();
}

async function monitorAction(act, id) {
  const cmd = STATE.commands[id] || {};
  if (act === 'lock') await api('/api/command', 'POST', { studentId: id, lock: !cmd.lock });
  if (act === 'close') await api('/api/command', 'POST', { studentId: id, closeTab: true });
  if (act === 'msg') { const m = prompt('Message to send to student:'); if (m == null) return; await api('/api/command', 'POST', { studentId: id, message: m }); }
  toast('Command sent'); await refresh();
}

function renderScenes() {
  const s = STATE;
  main.innerHTML = head('Scenes') + `
    <div class="card section"><h3>Create a scene</h3>
      <p class="muted" style="font-size:13px;margin-top:0">A scene is a saved set of blocked/allowed sites a teacher can turn on for the class in one click — e.g. "Quiz mode" that allows only the quiz site.</p>
      <div class="form-inline">
        <div><label>Scene name</label><input id="scName" placeholder="e.g. Reading time"></div>
        <div><label>Mode</label><select id="scMode"><option value="blacklist">Blacklist (block listed)</option><option value="whitelist">Whitelist (allow only listed)</option></select></div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
        <div><label>⛔ Blocked sites (one per line)</label><textarea id="scBlock" rows="4" placeholder="game-site.com&#10;youtube.com"></textarea></div>
        <div><label>✅ Allowed sites (one per line)</label><textarea id="scAllow" rows="4" placeholder="wikipedia.org&#10;classroom.google.com"></textarea></div>
      </div>
      <label style="margin-top:10px">🎯 Focus tabs (optional) — one per line</label>
      <p class="muted" style="font-size:12px;margin:0 0 6px">If set, running this scene puts every device into focus mode: it opens only these sites and closes the rest (students can't close them).</p>
      <textarea id="scFocus" rows="3" placeholder="quiz.example.com&#10;classroom.google.com"></textarea>
      <div class="row end" style="margin-top:10px"><button id="scAdd">Create scene</button></div>
    </div>
    <div class="grid cards">
    ${(s.scenes || []).map(sc => `<div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>🎬 ${esc(sc.name)}</strong>
        ${s.activeScene === sc.id ? '<span class="tag allow">running</span>' : ''}
      </div>
      <div class="muted" style="font-size:12px;margin:6px 0">${sc.mode} · ${(sc.block || []).length} blocked · ${(sc.allow || []).length} allowed${(sc.focus || []).length ? ` · 🎯 ${(sc.focus || []).length} focus` : ''}</div>
      <div class="row" style="gap:6px;margin-top:8px">
        ${s.activeScene === sc.id
          ? `<button class="sm warn" data-stop="1">Stop</button>`
          : `<button class="sm ok" data-run="${sc.id}">▶ Run for class</button>`}
        <button class="sm danger" data-delscene="${sc.id}">Delete</button>
      </div>
    </div>`).join('') || '<p class="muted">No scenes yet. Create one above.</p>'}
    </div>`;
  document.getElementById('scAdd').onclick = async () => {
    const name = scName.value.trim(); if (!name) return toast('Name required');
    await api('/api/scenes', 'POST', { name, mode: scMode.value, block: scBlock.value.split('\n'), allow: scAllow.value.split('\n'), focus: scFocus.value.split('\n') });
    toast('Scene created'); await refresh();
  };
  main.querySelectorAll('button[data-run]').forEach(b => b.onclick = async () => {
    const sc = (STATE.scenes || []).find(x => x.id === b.dataset.run);
    await api('/api/scenes/activate', 'POST', { id: b.dataset.run });
    if (sc && (sc.focus || []).length) await bulkCommand(STATE.students.map(x => x.id), { lockedTabs: sc.focus });
    toast('Scene running' + (sc && sc.focus && sc.focus.length ? ' + focus applied' : '')); await refresh();
  });
  main.querySelectorAll('button[data-stop]').forEach(b => b.onclick = async () => {
    await api('/api/scenes/activate', 'POST', { id: null });
    await bulkCommand(STATE.students.map(x => x.id), { lockedTabs: [] });
    toast('Scene stopped'); await refresh();
  });
  main.querySelectorAll('button[data-delscene]').forEach(b => b.onclick = async () => { if (!confirm('Delete scene?')) return; await api('/api/scenes/' + b.dataset.delscene, 'DELETE'); await refresh(); });
}

function renderStudents() {
  const s = STATE; const admin = role === 'admin';
  main.innerHTML = head('Students') + `
    ${admin ? `<div class="card section"><h3>Add student</h3>
      <div class="form-inline">
        <div><label>Name</label><input id="stName"></div>
        <div><label>Email (optional)</label><input id="stEmail"></div>
        <div><label>Class</label><select id="stClass"><option value="">—</option>${s.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><button id="addSt">Add</button></div>
      </div></div>` : ''}
    <div class="card"><table><thead><tr><th>Name</th><th>Enrollment code</th><th>Class</th><th>Status</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
    ${s.students.map(st => `<tr>
      <td>${esc(st.name)}</td>
      <td><code style="font-size:13px">${esc(st.code || '—')}</code> ${st.code ? `<button class="sm ghost" data-copy="${esc(st.code)}">Copy</button>` : ''}</td>
      <td>${esc(className(st.classId))}</td>
      <td><span class="dot ${online(st) ? 'on' : 'off'}"></span> ${online(st) ? 'online' : 'offline'}${st.deviceId ? ' · <span style="color:var(--ok)">device linked</span>' : ''}</td>
      ${admin ? `<td class="row" style="gap:6px;justify-content:flex-end">${st.deviceId ? `<button class="sm ghost" data-unlink="${st.id}">Unlink</button>` : ''}<button class="sm danger" data-del="${st.id}">Remove</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${admin ? 5 : 4}" class="muted">No students.</td></tr>`}
    </tbody></table>
    <p class="muted" style="font-size:12px;margin-top:10px">Give each student's <strong>enrollment code</strong> to the SafetyWise extension on their device (extension popup → Enrollment code). The device then links to that student and appears in Live classroom.</p></div>`;
  if (admin) {
    document.getElementById('addSt').onclick = async () => {
      const name = stName.value.trim(); if (!name) return toast('Name required');
      await api('/api/students', 'POST', { name, email: stEmail.value.trim(), classId: stClass.value });
      toast('Student added'); await refresh();
    };
    main.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Remove student?')) return; await api('/api/students/' + b.dataset.del, 'DELETE'); toast('Removed'); await refresh(); });
    main.querySelectorAll('button[data-unlink]').forEach(b => b.onclick = async () => { if (!confirm('Unlink this device? The extension will reset and can be set up again with a code.')) return; await api('/api/command', 'POST', { studentId: b.dataset.unlink, unlink: true }); toast('Device will unlink on next check-in'); await refresh(); });
  }
  main.querySelectorAll('button[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Code copied: ' + b.dataset.copy); } catch { toast(b.dataset.copy); } });
}

function renderClasses() {
  const s = STATE;
  main.innerHTML = head('Classes') + `
    <div class="card section"><h3>Create class</h3><div class="form-inline">
      <div><label>Class name</label><input id="clName" placeholder="e.g. Period 3 — Science"></div>
      <div><button id="addCl">Create</button></div></div></div>
    <div class="card"><table><thead><tr><th>Class</th><th>Students</th><th></th></tr></thead><tbody>
    ${s.classes.map(c => `<tr><td>${esc(c.name)}</td><td class="muted">${s.students.filter(x => x.classId === c.id).length}</td>
      <td><button class="sm danger" data-del="${c.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan=3 class="muted">No classes.</td></tr>'}
    </tbody></table></div>`;
  document.getElementById('addCl').onclick = async () => { const name = clName.value.trim(); if (!name) return; await api('/api/classes', 'POST', { name }); toast('Class created'); await refresh(); };
  main.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Delete class?')) return; await api('/api/classes/' + b.dataset.del, 'DELETE'); await refresh(); });
}

function renderTeachers() {
  const s = STATE;
  main.innerHTML = head('Teachers') + `
    <div class="card section"><h3>Add teacher</h3><div class="form-inline">
      <div><label>Full name</label><input id="tName"></div>
      <div><label>Username</label><input id="tUser"></div>
      <div><label>Password</label><input id="tPass" placeholder="teacher"></div>
      <div><button id="addT">Add</button></div></div></div>
    <div class="card"><table><thead><tr><th>Name</th><th>Username</th><th></th></tr></thead><tbody>
    ${s.teachers.map(t => `<tr><td>${esc(t.name)}</td><td class="muted">${esc(t.username)}</td>
      <td><button class="sm danger" data-del="${t.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan=3 class="muted">No teachers.</td></tr>'}
    </tbody></table></div>`;
  document.getElementById('addT').onclick = async () => {
    const username = tUser.value.trim(); if (!username) return toast('Username required');
    try { await api('/api/teachers', 'POST', { name: tName.value.trim(), username, password: tPass.value.trim() }); toast('Teacher added'); await refresh(); }
    catch (e) { toast(e.message); }
  };
  main.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Remove teacher?')) return; await api('/api/teachers/' + b.dataset.del, 'DELETE'); await refresh(); });
}

function renderFiltering() {
  const s = STATE;
  const mode = s.filterMode || 'blacklist';
  const blocks = s.filters.filter(f => f.type === 'block');
  const allows = s.filters.filter(f => f.type === 'allow');
  main.innerHTML = head('Web filtering') + `
    <div class="card section">
      <h3>Filtering mode</h3>
      <div class="modeswitch">
        <button class="mode ${mode === 'blacklist' ? 'on' : ''}" data-mode="blacklist">
          <strong>Blacklist</strong><span>Block the listed sites. Everything else is allowed.</span></button>
        <button class="mode ${mode === 'whitelist' ? 'on' : ''}" data-mode="whitelist">
          <strong>Whitelist</strong><span>Allow ONLY the listed sites. Everything else is blocked.</span></button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">${mode === 'whitelist'
        ? 'Whitelist is active — students can reach only the allowed sites below.'
        : 'Blacklist is active — students can reach any site except the blocked ones below.'}</p>
      ${mode === 'whitelist' && allows.length === 0 ? '<div class="warnbar">⚠️ Whitelist is on but no sites are allowed — <strong>every site is currently blocked</strong> for students. Add allowed sites below, or switch to Blacklist.</div>' : ''}
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px" class="section">
      <div class="card">
        <h3>⛔ Blacklist — blocked sites</h3>
        <div class="row" style="gap:6px;margin:8px 0">
          <input id="bPat" placeholder="e.g. game-site.com" style="flex:1">
          <button id="addBlock">Add</button>
        </div>
        <table><tbody>
        ${blocks.map(f => `<tr><td>${esc(f.pattern)}${f.note ? `<span class="muted" style="font-size:11px"> · ${esc(f.note)}</span>` : ''}</td><td style="text-align:right"><button class="sm danger" data-del="${f.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted">No blocked sites.</td></tr>'}
        </tbody></table>
      </div>
      <div class="card">
        <h3>✅ Whitelist — allowed sites</h3>
        <div class="row" style="gap:6px;margin:8px 0">
          <input id="aPat" placeholder="e.g. wikipedia.org" style="flex:1">
          <button id="addAllow" class="ok">Add</button>
        </div>
        <table><tbody>
        ${allows.map(f => `<tr><td>${esc(f.pattern)}${f.note ? `<span class="muted" style="font-size:11px"> · ${esc(f.note)}</span>` : ''}</td><td style="text-align:right"><button class="sm danger" data-del="${f.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted">No allowed sites.</td></tr>'}
        </tbody></table>
      </div>
    </div>

    <div class="card section"><h3>Category filters</h3>
      <div class="catgrid">
      ${Object.keys(s.categories).map(k => `<label class="catchip"><input type="checkbox" data-cat="${esc(k)}" ${s.categories[k] ? 'checked' : ''}> <span>${esc(k)}</span></label>`).join('')}
      </div>
    </div>
    <div class="card"><h3>Alert keywords</h3>
      <label>Comma-separated keywords that raise an alert when seen</label>
      <textarea id="kw" rows="2">${esc((s.alertKeywords || []).join(', '))}</textarea>
      <div class="row end" style="margin-top:10px"><button id="saveKw">Save keywords</button></div></div>`;

  main.querySelectorAll('button[data-mode]').forEach(b => b.onclick = async () => { await api('/api/filtermode', 'POST', { mode: b.dataset.mode }); toast('Mode: ' + b.dataset.mode); await refresh(); });
  document.getElementById('addBlock').onclick = async () => { const pattern = bPat.value.trim(); if (!pattern) return toast('Enter a site'); await api('/api/filters', 'POST', { type: 'block', pattern }); toast('Blocked'); await refresh(); };
  document.getElementById('addAllow').onclick = async () => { const pattern = aPat.value.trim(); if (!pattern) return toast('Enter a site'); await api('/api/filters', 'POST', { type: 'allow', pattern }); toast('Allowed'); await refresh(); };
  main.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => { await api('/api/filters/' + b.dataset.del, 'DELETE'); await refresh(); });
  main.querySelectorAll('input[data-cat]').forEach(c => c.onchange = async () => { await api('/api/categories', 'POST', { categories: { [c.dataset.cat]: c.checked } }); toast('Saved'); });
  document.getElementById('saveKw').onclick = async () => { await api('/api/keywords', 'POST', { keywords: kw.value.split(',') }); toast('Keywords saved'); await refresh(); };
}

function renderAlerts() {
  const s = STATE;
  main.innerHTML = head('Alerts', '<button class="ghost sm" id="markSeen">Mark all seen</button>') + `
    <div class="card"><table><thead><tr><th>When</th><th>Student</th><th>Type</th><th>Detail</th></tr></thead><tbody>
    ${s.alerts.map(a => { const st = s.students.find(x => x.id === a.studentId); const d = a.detail || {};
      const detail = a.kind === 'keyword' ? `“${esc(d.keyword)}” on ${esc(d.title || d.url || '')}` : a.kind === 'block' ? `Blocked ${esc(d.url || '')}` : esc(JSON.stringify(d));
      return `<tr><td class="muted">${timeAgo(a.at)}</td><td>${esc(st ? st.name : a.studentId)}</td><td><span class="tag ${a.kind === 'keyword' ? 'block' : ''}">${esc(a.kind)}</span></td><td class="student-tab">${detail}</td></tr>`; }).join('') || '<tr><td colspan=4 class="muted">No alerts.</td></tr>'}
    </tbody></table></div>`;
  document.getElementById('markSeen').onclick = async () => { await api('/api/alerts/seen', 'POST'); toast('Marked seen'); await refresh(); };
}

function renderSetup() {
  const s = STATE;
  const origin = location.origin;
  main.innerHTML = head('Extension setup') + `
    <div class="card section"><h3>Enroll devices with the SafetyWise extension</h3>
    <p class="muted">1. In <strong>Students</strong>, add a student — each one gets an <strong>enrollment code</strong> (e.g. SW-AB12CD).<br>
    2. Install the SafetyWise extension on that student's device (load unpacked for testing, or push via Google Admin console on managed Chromebooks).<br>
    3. Open the extension popup, enter the <strong>Server URL</strong> and the student's <strong>enrollment code</strong>, and click Save &amp; enroll. The device links to that student and appears in Live classroom.</p>
    <label>Server URL</label><input readonly value="${esc(origin)}">
    <label>Shared enroll token (optional fallback — only needed to auto-create a device without a code)</label><input readonly value="${esc(s.enrollToken || '')}">
    <p class="muted" style="font-size:12px;margin-top:12px">The extension reports the active tab and open-tab count to this console and enforces the web-filter rules and lock/message commands you set. It is intended for school-owned, consented devices only.</p>
    </div>
    <div class="card"><h3>Add another admin</h3><div class="form-inline">
      <div><label>Name</label><input id="aName"></div>
      <div><label>Username</label><input id="aUser"></div>
      <div><label>Password</label><input id="aPass"></div>
      <div><button id="addA">Add admin</button></div></div></div>`;
  document.getElementById('addA').onclick = async () => { const username = aUser.value.trim(); if (!username) return toast('Username required'); try { await api('/api/admins', 'POST', { name: aName.value.trim(), username, password: aPass.value.trim() }); toast('Admin added'); await refresh(); } catch (e) { toast(e.message); } };
}

// initial + polling
refresh();
setInterval(() => { if (['overview', 'alerts'].includes(currentView)) refresh().catch(() => {}); }, 5000);
