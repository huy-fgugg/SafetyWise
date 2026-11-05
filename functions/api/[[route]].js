// SafetyWise API — Cloudflare Pages Function (catch-all for /api/*).
// State is stored as a single JSON document in KV binding SAFETYWISE_KV.
// Sessions live in KV with a TTL.

const STATE_KEY = 'state:v1';

function defaults() {
  return {
    admins: [{ id: 'admin', username: 'admin', password: 'admin', name: 'Administrator', createdAt: Date.now(), isOwner: true }],
    teachers: [],
    students: [],
    classes: [],
    filters: [{ id: 'f_default_1', type: 'block', pattern: 'malware.example', category: 'Security', note: 'Sample blocked site' }],
    categories: { 'Gaming': false, 'Social Media': false, 'Streaming Video': false, 'Adult Content': true, 'Security Threats': true },
    alertKeywords: ['violence', 'self-harm', 'weapon'],
    filterMode: 'blacklist', // 'blacklist' = block listed sites; 'whitelist' = allow ONLY listed sites
    scenes: [],              // teacher-created named block/allow sets
    activeScene: null,       // id of the scene currently applied to all students
    activity: {},
    commands: {},
    alerts: [],
    enrollToken: 'safetywise-demo-enroll'
  };
}

function uid(p) { return p + '_' + crypto.randomUUID().slice(0, 12); }
function genCode() { return 'SW-' + crypto.randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase(); }

async function loadState(env) {
  let s = await env.SAFETYWISE_KV.get(STATE_KEY, 'json');
  if (!s) { s = defaults(); await saveState(env, s); }
  const d = defaults();
  for (const k of Object.keys(d)) if (!(k in s)) s[k] = d[k];
  return s;
}
async function saveState(env, s) { await env.SAFETYWISE_KV.put(STATE_KEY, JSON.stringify(s)); }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function getSession(env, req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  return await env.SAFETYWISE_KV.get('sess:' + t, 'json');
}

// The rules currently in force: an active scene overrides the base filters.
function effectiveRules(state) {
  if (state.activeScene) {
    const sc = (state.scenes || []).find(s => s.id === state.activeScene);
    if (sc) return { mode: sc.mode || 'blacklist', filters: [...(sc.block || []).map(p => ({ type: 'block', pattern: p })), ...(sc.allow || []).map(p => ({ type: 'allow', pattern: p }))] };
  }
  return { mode: state.filterMode || 'blacklist', filters: state.filters || [] };
}
function blockReason(state, url) {
  const u = (url || '').toLowerCase();
  const { mode, filters } = effectiveRules(state);
  if (filters.some(f => f.type === 'allow' && f.pattern && u.includes(f.pattern.toLowerCase()))) return null;
  if (mode === 'whitelist') return { pattern: '', note: 'Only school-approved sites are allowed', category: 'Whitelist' };
  const blk = filters.find(f => f.type === 'block' && f.pattern && u.includes(f.pattern.toLowerCase()));
  if (blk) return { pattern: blk.pattern, note: blk.note || 'Blocked by policy', category: blk.category || '' };
  return null;
}
function logAlert(state, studentId, kind, detail) {
  state.alerts.unshift({ id: uid('a'), studentId, kind, detail, at: Date.now(), seen: false });
  state.alerts = state.alerts.slice(0, 500);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  const state = await loadState(env);

  // ---- Auth ----
  if (p === '/api/login' && method === 'POST') {
    const admin = state.admins.find(a => a.username === body.username && a.password === body.password);
    const teacher = state.teachers.find(t => t.username === body.username && t.password === body.password);
    const acct = admin || teacher;
    if (!acct) return json({ error: 'Invalid credentials' }, 401);
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const role = admin ? 'admin' : 'teacher';
    await env.SAFETYWISE_KV.put('sess:' + token, JSON.stringify({ username: acct.username, role, id: acct.id }), { expirationTtl: 60 * 60 * 12 });
    return json({ token, role, name: acct.name, username: acct.username });
  }
  if (p === '/api/logout' && method === 'POST') {
    const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (t) await env.SAFETYWISE_KV.delete('sess:' + t);
    return json({ ok: true });
  }

  // ---- Agent (extension) ----
  if (p === '/api/agent/enroll' && method === 'POST') {
    let student = null;
    // Primary path: link to a student the admin created, by enrollment code.
    if (body.code) {
      student = state.students.find(s => s.code && s.code.toUpperCase() === String(body.code).trim().toUpperCase());
      if (!student) return json({ error: 'invalid enrollment code' }, 403); // bad code: never auto-create
    } else if (body.email) {
      student = state.students.find(s => s.email && body.email && s.email.toLowerCase() === body.email.toLowerCase());
    }
    if (!student) {
      // No code given. Only auto-create if the shared enroll token is present (legacy/testing).
      if (body.token !== state.enrollToken) return json({ error: 'invalid enrollment code' }, 403);
      student = { id: uid('s'), code: genCode(), name: body.name || body.email || 'Unknown device', email: body.email || '', classId: body.classId || '', createdAt: Date.now() };
      state.students.push(student);
    }
    if (!student.code) student.code = genCode();
    student.deviceId = body.deviceId || student.deviceId;
    student.lastSeen = Date.now();
    await saveState(env, state);
    return json({ studentId: student.id, name: student.name });
  }
  if (p === '/api/agent/report' && method === 'POST') {
    const sid = body.studentId;
    const student = state.students.find(s => s.id === sid);
    if (!student) return json({ error: 'unknown student' }, 404);
    student.lastSeen = Date.now();
    state.activity[sid] = { url: body.url || '', title: body.title || '', tabs: body.tabs || [], at: Date.now() };
    const hay = ((body.title || '') + ' ' + (body.url || '')).toLowerCase();
    for (const kw of state.alertKeywords) if (kw && hay.includes(kw.toLowerCase())) { logAlert(state, sid, 'keyword', { keyword: kw, url: body.url, title: body.title }); break; }
    const reason = blockReason(state, body.url);
    if (reason) logAlert(state, sid, 'block', { url: body.url, reason });
    const cmd = state.commands[sid] || {};
    const out = { block: reason, lock: !!cmd.lock, message: cmd.message || '', closeTab: !!cmd.closeTab, unlink: !!cmd.unlink, focusTab: cmd.focusTab || null, lockedTabs: cmd.lockedTabs || null };
    if (cmd.closeTab) cmd.closeTab = false;
    if (cmd.message) cmd.message = '';
    if (cmd.focusTab) cmd.focusTab = null;
    if (cmd.unlink) { cmd.unlink = false; student.deviceId = null; } // release the device
    state.commands[sid] = cmd;
    await saveState(env, state);
    return json(out);
  }

  // ---- Authenticated dashboard API ----
  if (p.startsWith('/api/')) {
    const user = await getSession(env, request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const isAdmin = user.role === 'admin';
    const requireAdmin = () => { if (!isAdmin) throw 'admin'; };
    try {
      if (p === '/api/state' && method === 'GET') {
        return json({
          me: { username: user.username, role: user.role },
          admins: state.admins.map(a => ({ id: a.id, username: a.username, name: a.name, isOwner: a.isOwner })),
          teachers: state.teachers.map(t => ({ id: t.id, username: t.username, name: t.name, classIds: t.classIds || [] })),
          students: state.students, classes: state.classes, filters: state.filters,
          categories: state.categories, alertKeywords: state.alertKeywords, filterMode: state.filterMode || 'blacklist',
          scenes: state.scenes || [], activeScene: state.activeScene || null,
          activity: state.activity, commands: state.commands, alerts: state.alerts.slice(0, 100),
          enrollToken: isAdmin ? state.enrollToken : undefined
        });
      }
      if (p === '/api/teachers' && method === 'POST') {
        requireAdmin();
        if (!body.username) return json({ error: 'username required' }, 400);
        if (state.teachers.find(x => x.username === body.username) || state.admins.find(x => x.username === body.username)) return json({ error: 'username taken' }, 409);
        const t = { id: uid('t'), username: body.username, password: body.password || 'teacher', name: body.name || body.username, classIds: body.classIds || [], createdAt: Date.now() };
        state.teachers.push(t); await saveState(env, state); return json({ id: t.id });
      }
      if (p.match(/^\/api\/teachers\/[^/]+$/) && method === 'DELETE') {
        requireAdmin(); const id = p.split('/').pop();
        state.teachers = state.teachers.filter(t => t.id !== id); await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/students' && method === 'POST') {
        requireAdmin();
        if (!body.name) return json({ error: 'name required' }, 400);
        const s = { id: uid('s'), code: genCode(), name: body.name, email: body.email || '', classId: body.classId || '', createdAt: Date.now() };
        state.students.push(s); await saveState(env, state); return json({ id: s.id, code: s.code });
      }
      if (p.match(/^\/api\/students\/[^/]+$/) && method === 'DELETE') {
        requireAdmin(); const id = p.split('/').pop();
        state.students = state.students.filter(s => s.id !== id); delete state.activity[id]; delete state.commands[id];
        await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/classes' && method === 'POST') {
        requireAdmin();
        if (!body.name) return json({ error: 'name required' }, 400);
        const c = { id: uid('c'), name: body.name, createdAt: Date.now() };
        state.classes.push(c); await saveState(env, state); return json({ id: c.id });
      }
      if (p.match(/^\/api\/classes\/[^/]+$/) && method === 'DELETE') {
        requireAdmin(); const id = p.split('/').pop();
        state.classes = state.classes.filter(c => c.id !== id); await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/filters' && method === 'POST') {
        requireAdmin();
        if (!(body.pattern || '').trim()) return json({ error: 'pattern required' }, 400);
        const f = { id: uid('f'), type: body.type === 'allow' ? 'allow' : 'block', pattern: body.pattern.trim(), category: body.category || '', note: body.note || '' };
        state.filters.push(f); await saveState(env, state); return json({ id: f.id });
      }
      if (p.match(/^\/api\/filters\/[^/]+$/) && method === 'DELETE') {
        requireAdmin(); const id = p.split('/').pop();
        state.filters = state.filters.filter(f => f.id !== id); await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/categories' && method === 'POST') {
        requireAdmin(); state.categories = Object.assign(state.categories, body.categories || {}); await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/keywords' && method === 'POST') {
        requireAdmin();
        if (Array.isArray(body.keywords)) state.alertKeywords = body.keywords.map(s => String(s).trim()).filter(Boolean);
        await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/filtermode' && method === 'POST') {
        requireAdmin();
        state.filterMode = body.mode === 'whitelist' ? 'whitelist' : 'blacklist';
        await saveState(env, state); return json({ ok: true, filterMode: state.filterMode });
      }

      // ----- Scenes (teachers allowed) -----
      if (p === '/api/scenes' && method === 'POST') {
        const sc = {
          id: uid('scene'), name: body.name || 'Untitled scene',
          mode: body.mode === 'whitelist' ? 'whitelist' : 'blacklist',
          block: (body.block || []).map(x => String(x).trim()).filter(Boolean),
          allow: (body.allow || []).map(x => String(x).trim()).filter(Boolean),
          focus: (body.focus || []).map(x => String(x).trim()).filter(Boolean),
          owner: user.username, createdAt: Date.now()
        };
        state.scenes = state.scenes || []; state.scenes.push(sc);
        await saveState(env, state); return json({ id: sc.id });
      }
      if (p.match(/^\/api\/scenes\/[^/]+$/) && method === 'DELETE') {
        const id = p.split('/').pop();
        state.scenes = (state.scenes || []).filter(s => s.id !== id);
        if (state.activeScene === id) state.activeScene = null;
        await saveState(env, state); return json({ ok: true });
      }
      if (p === '/api/scenes/activate' && method === 'POST') {
        const id = body.id || null;
        if (id && !(state.scenes || []).find(s => s.id === id)) return json({ error: 'no such scene' }, 404);
        state.activeScene = id; // null deactivates
        await saveState(env, state); return json({ ok: true, activeScene: state.activeScene });
      }
      if (p === '/api/command' && method === 'POST') {
        const sid = body.studentId;
        if (!state.students.find(s => s.id === sid)) return json({ error: 'unknown student' }, 404);
        const cmd = state.commands[sid] || {};
        if ('lock' in body) cmd.lock = !!body.lock;
        if ('message' in body) cmd.message = String(body.message || '');
        if ('closeTab' in body) cmd.closeTab = !!body.closeTab;
        if ('unlink' in body) cmd.unlink = !!body.unlink;
        if ('focusTab' in body) cmd.focusTab = body.focusTab || null;
        if ('lockedTabs' in body) cmd.lockedTabs = Array.isArray(body.lockedTabs) && body.lockedTabs.length ? body.lockedTabs.map(x => String(x).trim()).filter(Boolean) : null;
        state.commands[sid] = cmd; await saveState(env, state); return json({ ok: true, command: cmd });
      }
      if (p === '/api/admins' && method === 'POST') {
        requireAdmin();
        if (!body.username) return json({ error: 'username required' }, 400);
        if (state.admins.find(x => x.username === body.username) || state.teachers.find(x => x.username === body.username)) return json({ error: 'username taken' }, 409);
        const a = { id: uid('admin'), username: body.username, password: body.password || 'admin', name: body.name || body.username, createdAt: Date.now() };
        state.admins.push(a); await saveState(env, state); return json({ id: a.id });
      }
      if (p === '/api/alerts/seen' && method === 'POST') {
        state.alerts.forEach(a => { a.seen = true; }); await saveState(env, state); return json({ ok: true });
      }
      return json({ error: 'no such endpoint' }, 404);
    } catch (e) {
      if (e === 'admin') return json({ error: 'admin only' }, 403);
      return json({ error: 'server error', detail: String(e) }, 500);
    }
  }
  return json({ error: 'not found' }, 404);
}
