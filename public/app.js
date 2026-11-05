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
function clearMonTimers() { monTimers.forEach(t => clearInterval(t)); monTimers = []; }

function render() {
  if (!STATE) return;
  clearMonTimers();
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
  main.innerHTML = head('Live classroom', '<span class="live"><span class="dot on"></span>live screens</span>') + `
    <div class="grid cards monitor" id="monGrid">
    ${s.students.map(st => {
      const a = s.activity[st.id]; const cmd = s.commands[st.id] || {};
      return `<div class="card screencard">
        <div class="screen" data-screen="${st.id}" title="Click to enlarge">
          <img id="shot_${st.id}" alt="">
          <div class="screen-ph" id="ph_${st.id}">${online(st) ? 'Waiting for screen…' : 'Offline'}</div>
          <span class="screen-dot dot ${online(st) ? 'on' : 'off'}"></span>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:10px">
          <strong>${esc(st.name)}</strong>
          <span class="muted" style="font-size:11px" id="time_${st.id}">${st.lastSeen ? timeAgo(st.lastSeen) : '—'}</span>
        </div>
        <div class="student-tab" id="tab_${st.id}" title="${a ? esc(a.url) : ''}">${a ? esc(a.title || a.url || '—') : '<span class="muted">No activity reported</span>'}</div>
        <div class="row" style="margin-top:10px;gap:6px">
          <button class="sm ${cmd.lock ? 'danger' : 'ghost'}" data-act="lock" data-id="${st.id}">${cmd.lock ? 'Unlock' : 'Lock'}</button>
          <button class="sm ghost" data-act="close" data-id="${st.id}">Close tab</button>
          <button class="sm ghost" data-act="msg" data-id="${st.id}">Message</button>
        </div>
      </div>`;
    }).join('') || '<p class="muted">No students enrolled yet. Add students or install the extension on a device.</p>'}
    </div>
    <div id="screenModal" class="modal hidden"><div class="modal-inner"><button class="modal-x" id="modalX">✕</button><img id="modalImg" alt=""><div class="modal-cap" id="modalCap"></div></div></div>`;
  main.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => monitorAction(b.dataset.act, b.dataset.id));

  // click a screen to enlarge
  const modal = document.getElementById('screenModal');
  let modalId = null;
  main.querySelectorAll('[data-screen]').forEach(el => el.onclick = () => {
    modalId = el.dataset.screen; const st = s.students.find(x => x.id === modalId);
    const img = document.getElementById('shot_' + modalId);
    if (img && img.src) { document.getElementById('modalImg').src = img.src; }
    document.getElementById('modalCap').textContent = st ? st.name : '';
    modal.classList.remove('hidden');
  });
  document.getElementById('modalX').onclick = () => { modal.classList.add('hidden'); modalId = null; };
  modal.onclick = e => { if (e.target === modal) { modal.classList.add('hidden'); modalId = null; } };

  if (!s.students.length) return;
  const ids = s.students.map(x => x.id);

  async function heartbeat() { try { await api('/api/watch', 'POST'); } catch {} }
  async function pollShots() {
    try {
      const d = await api('/api/shots', 'POST', { ids });
      const now = Date.now();
      for (const id of ids) {
        const shot = d.shots[id];
        const img = document.getElementById('shot_' + id);
        const ph = document.getElementById('ph_' + id);
        if (shot && img && now - shot.at < 30000) {
          img.src = shot.img; img.style.display = 'block'; if (ph) ph.style.display = 'none';
          if (modalId === id) document.getElementById('modalImg').src = shot.img;
        }
      }
    } catch {}
  }
  async function softUpdate() {
    try {
      STATE = await api('/api/state');
      for (const st of STATE.students) {
        const a = STATE.activity[st.id];
        const tab = document.getElementById('tab_' + st.id);
        const time = document.getElementById('time_' + st.id);
        const ph = document.getElementById('ph_' + st.id);
        if (tab) tab.textContent = a ? (a.title || a.url || '—') : 'No activity reported';
        if (time) time.textContent = st.lastSeen ? timeAgo(st.lastSeen) : '—';
        if (ph && ph.style.display !== 'none') ph.textContent = online(st) ? 'Waiting for screen…' : 'Offline';
      }
    } catch {}
  }
  heartbeat(); pollShots();
  monTimers.push(setInterval(heartbeat, 8000));
  monTimers.push(setInterval(pollShots, 2000));
  monTimers.push(setInterval(softUpdate, 6000));
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
