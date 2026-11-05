'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function defaults() {
  return {
    // The first registered admin credential. Demo default: admin / admin.
    admins: [{ id: 'admin', username: 'admin', password: 'admin', name: 'Administrator', createdAt: Date.now(), isOwner: true }],
    teachers: [],
    students: [],
    classes: [],
    // Web filter rules. type: 'block' | 'allow'. match is a hostname substring.
    filters: [
      { id: 'f_default_1', type: 'block', pattern: 'malware.example', category: 'Security', note: 'Sample blocked site' }
    ],
    // category toggles used for coarse filtering
    categories: {
      'Gaming': false,
      'Social Media': false,
      'Streaming Video': false,
      'Adult Content': true,
      'Security Threats': true
    },
    // keywords that raise an alert when seen in a page title/url
    alertKeywords: ['violence', 'self-harm', 'weapon'],
    // 'blacklist' = block listed sites; 'whitelist' = allow ONLY listed sites
    filterMode: 'blacklist',
    scenes: [],
    activeScene: null,
    // live activity reports from agents, keyed by studentId
    activity: {},
    // pending commands per studentId: { lock:bool, message:string, closeTab:bool }
    commands: {},
    // alert log
    alerts: [],
    // enrollment token the extension uses
    enrollToken: 'safetywise-demo-enroll'
  };
}

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    state = defaults();
    save();
  }
  // backfill any new keys
  const d = defaults();
  for (const k of Object.keys(d)) if (!(k in state)) state[k] = d[k];
  return state;
}

let saveTimer = null;
function save() {
  if (!state) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); }
    catch (e) { console.error('save failed', e); }
  }, 50);
}

function reset() {
  state = defaults();
  save();
  return state;
}

module.exports = { load, save, reset, DATA_FILE };
