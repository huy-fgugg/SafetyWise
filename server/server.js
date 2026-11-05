'use strict';
/*
 * SafetyWise — classroom management server (zero dependencies).
 * Serves the admin/teacher dashboard and an API for the SafetyWise Chrome
 * extension that runs on managed/school devices.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const sessions = new Map(); // token -> { username, role, created }

function uid(p) { return p + '_' + crypto.randomBytes(6).toString('hex'); }
function genCode() { return 'SW-' + crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); }
function token() { return crypto.randomBytes(24).toString('hex'); }

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

function auth(req) {
  const h = req.headers['authorization'] || '';
  const t = h.replace(/^Bearer\s+/i, '');
  return sessions.get(t) || null;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/login.html' : urlPath;
  rel = rel.split('?')[0];
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-ish fallback to dashboard
      return fs.readFile(path.join(PUBLIC_DIR, 'login.html'), (e2, d2) =>
        e2 ? send(res, 404, { error: 'not found' }) : send(res, 200, d2, { 'Content-Type': 'text/html' }));
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

function logAlert(state, studentId, kind, detail) {
  state.alerts.unshift({ id: uid('a'), studentId, kind, detail, at: Date.now(), seen: false });
  state.alerts = state.alerts.slice(0, 500);
}

// Decide if a URL should be blocked for a given student, returns reason or null
function blockReason(state, url, title) {
  const u = (url || '').toLowerCase();
  const allowHit = state.filters.some(f => f.type === 'allow' && f.pattern && u.includes(f.pattern.toLowerCase()));
  if (allowHit) return null;
  if ((state.filterMode || 'blacklist') === 'whitelist') {
    return { pattern: '', note: 'Only school-approved sites are allowed', category: 'Whitelist' };
  }
  const blk = state.filters.find(f => f.type === 'block' && f.pattern && u.includes(f.pattern.toLowerCase()));
  if (blk) return { pattern: blk.pattern, note: blk.note || 'Blocked by policy', category: blk.category || '' };
  return null;
}

const server = http.createServer(async (req, res) => {
  const state = db.load();
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  // ---------- Auth ----------
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const admin = state.admins.find(a => a.username === b.username && a.password === b.password);
    const teacher = state.teachers.find(t => t.username === b.username && t.password === b.password);
    const acct = admin || teacher;
    if (!acct) return send(res, 401, { error: 'Invalid credentials' });
    const tk = token();
    const role = admin ? 'admin' : 'teacher';
    sessions.set(tk, { username: acct.username, role, id: acct.id, created: Date.now() });
    return send(res, 200, { token: tk, role, name: acct.name, username: acct.username });
  }

  if (p === '/api/logout' && method === 'POST') {
    const h = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    sessions.delete(h);
    return send(res, 200, { ok: true });
  }

  // ---------- Agent (extension) endpoints ----------
  if (p === '/api/agent/enroll' && method === 'POST') {
    const b = await readBody(req);
    let student = null;
    if (b.code) student = state.students.find(s => s.code && s.code.toUpperCase() === String(b.code).trim().toUpperCase());
    else if (b.email) student = state.students.find(s => s.email && b.email && s.email.toLowerCase() === b.email.toLowerCase());
    if (!student) {
      if (b.token !== state.enrollToken) return send(res, 403, { error: 'invalid enrollment code' });
      student = { id: uid('s'), code: genCode(), name: b.name || b.email || 'Unknown device', email: b.email || '', classId: b.classId || '', createdAt: Date.now() };
      state.students.push(student);
    }
    if (!student.code) student.code = genCode();
    student.deviceId = b.deviceId || student.deviceId;
    student.lastSeen = Date.now();
    db.save();
    return send(res, 200, { studentId: student.id, name: student.name });
  }

  if (p === '/api/agent/report' && method === 'POST') {
    const b = await readBody(req);
    const sid = b.studentId;
    const student = state.students.find(s => s.id === sid);
    if (!student) return send(res, 404, { error: 'unknown student' });
    student.lastSeen = Date.now();
    state.activity[sid] = {
      url: b.url || '', title: b.title || '', tabs: b.tabs || [],
      at: Date.now()
    };
    // keyword alerts
    const hay = ((b.title || '') + ' ' + (b.url || '')).toLowerCase();
    for (const kw of state.alertKeywords) {
      if (kw && hay.includes(kw.toLowerCase())) { logAlert(state, sid, 'keyword', { keyword: kw, url: b.url, title: b.title }); break; }
    }
    const reason = blockReason(state, b.url, b.title);
    if (reason) logAlert(state, sid, 'block', { url: b.url, reason });
    const cmd = state.commands[sid] || {};
    const capture = !!(state.watchUntil && Date.now() < state.watchUntil);
    // consume one-shot commands
    const out = { block: reason, lock: !!cmd.lock, message: cmd.message || '', closeTab: !!cmd.closeTab, capture };
    if (cmd.closeTab) { cmd.closeTab = false; }
    if (cmd.message) { cmd.message = ''; }
    state.commands[sid] = cmd;
    db.save();
    return send(res, 200, out);
  }

  if (p === '/api/agent/screenshot' && method === 'POST') {
    const b = await readBody(req);
    if (!b.studentId || !b.img) return send(res, 400, { error: 'bad snapshot' });
    state.shots = state.shots || {};
    state.shots[b.studentId] = { img: b.img, at: Date.now() };
    return send(res, 200, { ok: true, keep: !!(state.watchUntil && Date.now() < state.watchUntil) });
  }

  // ---------- Authenticated dashboard API ----------
  if (p.startsWith('/api/')) {
    const user = auth(req);
    if (!user) return send(res, 401, { error: 'unauthorized' });
    const isAdmin = user.role === 'admin';
    const b = method === 'GET' ? {} : await readBody(req);

    if (p === '/api/state' && method === 'GET') {
      return send(res, 200, {
        me: { username: user.username, role: user.role },
        admins: state.admins.map(a => ({ id: a.id, username: a.username, name: a.name, isOwner: a.isOwner })),
        teachers: state.teachers.map(t => ({ id: t.id, username: t.username, name: t.name, classIds: t.classIds || [] })),
        students: state.students,
        classes: state.classes,
        filters: state.filters,
        categories: state.categories,
        alertKeywords: state.alertKeywords,
        filterMode: state.filterMode || 'blacklist',
        activity: state.activity,
        commands: state.commands,
        alerts: state.alerts.slice(0, 100),
        enrollToken: isAdmin ? state.enrollToken : undefined
      });
    }

    // ----- Teachers (admin only) -----
    if (p === '/api/teachers' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const t = { id: uid('t'), username: b.username, password: b.password || 'teacher', name: b.name || b.username, classIds: b.classIds || [], createdAt: Date.now() };
      if (!t.username) return send(res, 400, { error: 'username required' });
      if (state.teachers.find(x => x.username === t.username) || state.admins.find(x => x.username === t.username))
        return send(res, 409, { error: 'username taken' });
      state.teachers.push(t); db.save();
      return send(res, 200, { id: t.id });
    }
    if (p.match(/^\/api\/teachers\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const id = p.split('/').pop();
      state.teachers = state.teachers.filter(t => t.id !== id); db.save();
      return send(res, 200, { ok: true });
    }

    // ----- Students (admin only to add/remove) -----
    if (p === '/api/students' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      if (!b.name) return send(res, 400, { error: 'name required' });
      const s = { id: uid('s'), code: genCode(), name: b.name, email: b.email || '', classId: b.classId || '', createdAt: Date.now() };
      state.students.push(s); db.save();
      return send(res, 200, { id: s.id, code: s.code });
    }
    if (p.match(/^\/api\/students\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const id = p.split('/').pop();
      state.students = state.students.filter(s => s.id !== id);
      delete state.activity[id]; delete state.commands[id]; db.save();
      return send(res, 200, { ok: true });
    }

    // ----- Classes -----
    if (p === '/api/classes' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const c = { id: uid('c'), name: b.name, createdAt: Date.now() };
      if (!c.name) return send(res, 400, { error: 'name required' });
      state.classes.push(c); db.save();
      return send(res, 200, { id: c.id });
    }
    if (p.match(/^\/api\/classes\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const id = p.split('/').pop();
      state.classes = state.classes.filter(c => c.id !== id); db.save();
      return send(res, 200, { ok: true });
    }

    // ----- Filters (admin only) -----
    if (p === '/api/filters' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const f = { id: uid('f'), type: b.type === 'allow' ? 'allow' : 'block', pattern: (b.pattern || '').trim(), category: b.category || '', note: b.note || '' };
      if (!f.pattern) return send(res, 400, { error: 'pattern required' });
      state.filters.push(f); db.save();
      return send(res, 200, { id: f.id });
    }
    if (p.match(/^\/api\/filters\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const id = p.split('/').pop();
      state.filters = state.filters.filter(f => f.id !== id); db.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/categories' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      state.categories = Object.assign(state.categories, b.categories || {}); db.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/keywords' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      if (Array.isArray(b.keywords)) state.alertKeywords = b.keywords.map(s => String(s).trim()).filter(Boolean);
      db.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/filtermode' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      state.filterMode = b.mode === 'whitelist' ? 'whitelist' : 'blacklist';
      db.save();
      return send(res, 200, { ok: true, filterMode: state.filterMode });
    }

    // ----- Teacher controls: send command to a student -----
    if (p === '/api/command' && method === 'POST') {
      const sid = b.studentId;
      if (!state.students.find(s => s.id === sid)) return send(res, 404, { error: 'unknown student' });
      const cmd = state.commands[sid] || {};
      if ('lock' in b) cmd.lock = !!b.lock;
      if ('message' in b) cmd.message = String(b.message || '');
      if ('closeTab' in b) cmd.closeTab = !!b.closeTab;
      state.commands[sid] = cmd; db.save();
      return send(res, 200, { ok: true, command: cmd });
    }

    // ----- Admin account management -----
    if (p === '/api/admins' && method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'admin only' });
      const a = { id: uid('admin'), username: b.username, password: b.password || 'admin', name: b.name || b.username, createdAt: Date.now() };
      if (!a.username) return send(res, 400, { error: 'username required' });
      if (state.admins.find(x => x.username === a.username) || state.teachers.find(x => x.username === a.username))
        return send(res, 409, { error: 'username taken' });
      state.admins.push(a); db.save();
      return send(res, 200, { id: a.id });
    }

    if (p === '/api/alerts/seen' && method === 'POST') {
      state.alerts.forEach(a => { a.seen = true; }); db.save();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/watch' && method === 'POST') {
      state.watchUntil = Date.now() + 20000;
      return send(res, 200, { ok: true });
    }
    if (p === '/api/shots' && method === 'POST') {
      const ids = Array.isArray(b.ids) ? b.ids.slice(0, 60) : [];
      const shots = {};
      state.shots = state.shots || {};
      for (const id of ids) if (state.shots[id]) shots[id] = state.shots[id];
      return send(res, 200, { shots });
    }

    return send(res, 404, { error: 'no such endpoint' });
  }

  // ---------- Static ----------
  if (method === 'GET') return serveStatic(req, res, p);
  send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => {
  console.log(`SafetyWise server running at http://localhost:${PORT}`);
  console.log(`Login: admin / admin`);
});
