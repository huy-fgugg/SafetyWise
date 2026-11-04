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

function render() {
  if (!STATE) return;
  const v = currentView;
  if (v === 'overview') return renderOverview();
  if (v === 'monitor') return renderMonitor();
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

function renderMonitor() {
  const s = STATE;
  main.innerHTML = head('Live classroom', '<span class="live"><span class="dot on"></span>auto-refresh 5s</span>') + `
    <div class="grid cards" id="monGrid">
    ${s.students.map(st => {
      const a = s.activity[st.id]; const cmd = s.commands[st.id] || {};
      return `<div class="card">
        <div class="row" style="justify-content:space-between">
          <strong>${esc(st.name)}</strong>
          <span class="dot ${online(st) ? 'on' : 'off'}"></span>
        </div>
        <div class="muted" style="font-size:12px;margin:2px 0 10px">${esc(className(st.classId))}${st.lastSeen ? ' · ' + timeAgo(st.lastSeen) : ''}</div>
        <div class="student-tab" title="${a ? esc(a.url) : ''}">${a ? esc(a.title || a.url || '—') : '<span class="muted">No activity reported</span>'}</div>
        ${a && a.tabs && a.tabs.length ? `<div class="muted" style="font-size:11px;margin-top:4px">${a.tabs.length} open tab(s)</div>` : ''}
        <div class="row" style="margin-top:12px;gap:6px">
          <button class="sm ${cmd.lock ? 'danger' : 'ghost'}" data-act="lock" data-id="${st.id}">${cmd.lock ? 'Unlock' : 'Lock'}</button>
          <button class="sm ghost" data-act="close" data-id="${st.id}">Close tab</button>
          <button class="sm ghost" data-act="msg" data-id="${st.id}">Message</button>
        </div>
      </div>`;
    }).join('') || '<p class="muted">No students enrolled yet. Add students or install the extension on a device.</p>'}
    </div>`;
  main.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => monitorAction(b.dataset.act, b.dataset.id));
}

async function monitorAction(act, id) {
  const cmd = STATE.commands[id] || {};
  if (act === 'lock') await api('/api/command', 'POST', { studentId: id, lock: !cmd.lock });
  if (act === 'close') await api('/api/command', 'POST', { studentId: id, closeTab: true });
  if (act === 'msg') { const m = prompt('Message to send to student:'); if (m == null) return; await api('/api/command', 'POST', { studentId: id, message: m }); }
  toast('Command sent'); await refresh();
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
    <div class="card"><table><thead><tr><th>Name</th><th>Email</th><th>Class</th><th>Status</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
    ${s.students.map(st => `<tr>
      <td>${esc(st.name)}</td><td class="muted">${esc(st.email || '—')}</td><td>${esc(className(st.classId))}</td>
      <td><span class="dot ${online(st) ? 'on' : 'off'}"></span> ${online(st) ? 'online' : 'offline'}</td>
      ${admin ? `<td><button class="sm danger" data-del="${st.id}">Remove</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${admin ? 5 : 4}" class="muted">No students.</td></tr>`}
    </tbody></table></div>`;
  if (admin) {
    document.getElementById('addSt').onclick = async () => {
      const name = stName.value.trim(); if (!name) return toast('Name required');
      await api('/api/students', 'POST', { name, email: stEmail.value.trim(), classId: stClass.value });
      toast('Student added'); await refresh();
    };
    main.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Remove student?')) return; await api('/api/students/' + b.dataset.del, 'DELETE'); toast('Removed'); await refresh(); });
  }
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
  main.innerHTML = head('Web filtering') + `
    <div class="card section"><h3>Add rule</h3><div class="form-inline">
      <div><label>Type</label><select id="fType"><option value="block">Block</option><option value="allow">Allow (override)</option></select></div>
      <div><label>URL contains</label><input id="fPat" placeholder="e.g. game-site.com"></div>
      <div><label>Category</label><input id="fCat" placeholder="optional"></div>
      <div><label>Note</label><input id="fNote" placeholder="optional"></div>
      <div><button id="addF">Add rule</button></div></div>
      <p class="muted" style="font-size:12px;margin-top:10px">Allow rules win over block rules. Matching is by substring of the URL.</p></div>
    <div class="card section"><table><thead><tr><th>Type</th><th>Pattern</th><th>Category</th><th>Note</th><th></th></tr></thead><tbody>
    ${s.filters.map(f => `<tr><td><span class="tag ${f.type}">${f.type}</span></td><td>${esc(f.pattern)}</td><td class="muted">${esc(f.category || '—')}</td><td class="muted">${esc(f.note || '—')}</td>
      <td><button class="sm danger" data-del="${f.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan=5 class="muted">No rules.</td></tr>'}
    </tbody></table></div>
    <div class="card section"><h3>Category filters</h3>
      ${Object.keys(s.categories).map(k => `<label class="row" style="margin:6px 0"><input type="checkbox" style="width:auto" data-cat="${esc(k)}" ${s.categories[k] ? 'checked' : ''}> <span>${esc(k)}</span></label>`).join('')}
    </div>
    <div class="card"><h3>Alert keywords</h3>
      <label>Comma-separated keywords that raise an alert when seen</label>
      <textarea id="kw" rows="2">${esc((s.alertKeywords || []).join(', '))}</textarea>
      <div class="row end" style="margin-top:10px"><button id="saveKw">Save keywords</button></div></div>`;
  document.getElementById('addF').onclick = async () => { const pattern = fPat.value.trim(); if (!pattern) return toast('Pattern required'); await api('/api/filters', 'POST', { type: fType.value, pattern, category: fCat.value.trim(), note: fNote.value.trim() }); toast('Rule added'); await refresh(); };
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
    <p class="muted">Install the SafetyWise Chrome extension on managed/school devices. On managed Chromebooks you would push it via the Google Admin console; for testing, load it unpacked. Configure it with the values below.</p>
    <label>Server URL</label><input readonly value="${esc(origin)}">
    <label>Enrollment token</label><input readonly value="${esc(s.enrollToken || '')}">
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
setInterval(() => { if (['overview', 'monitor', 'alerts'].includes(currentView)) refresh().catch(() => {}); }, 5000);
