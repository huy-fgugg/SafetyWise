// SafetyWise desktop app (Electron). Wraps the hosted console in a native window.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// The console URL the app opens. Override with SAFETYWISE_URL env var if self-hosting.
const CONSOLE_URL = process.env.SAFETYWISE_URL || 'https://safetywise.pages.dev';

const stateFile = path.join(app.getPath('userData'), 'window.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { width: 1200, height: 800 }; } }
function saveBounds(b) { try { fs.writeFileSync(stateFile, JSON.stringify(b)); } catch {} }

let win;

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width || 1200,
    height: b.height || 800,
    x: b.x, y: b.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#eef1f7',
    title: 'SafetyWise',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });

  win.loadFile(path.join(__dirname, 'loading.html'));
  win.loadURL(CONSOLE_URL).catch(showOffline);

  win.webContents.on('did-fail-load', (e, code, desc, url) => { if (url === CONSOLE_URL) showOffline(); });

  // Open external links (anything not on the console host) in the system browser.
  const host = new URL(CONSOLE_URL).host;
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).host !== host) { shell.openExternal(url); return { action: 'deny' }; } } catch {}
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (new URL(url).host !== host) { e.preventDefault(); shell.openExternal(url); } } catch {}
  });

  const persist = () => { if (win && !win.isDestroyed()) saveBounds(win.getBounds()); };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('closed', () => { win = null; });
}

function showOffline() {
  if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'loading.html'), { query: { offline: '1' } });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'SafetyWise',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => win && win.loadURL(CONSOLE_URL).catch(showOffline) },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { label: 'Back', accelerator: 'Alt+Left', click: () => win && win.webContents.canGoBack() && win.webContents.goBack() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'help',
      submenu: [
        { label: 'Open console in browser', click: () => shell.openExternal(CONSOLE_URL) },
        { label: 'About', click: () => dialog.showMessageBox(win, { title: 'SafetyWise', message: 'SafetyWise desktop', detail: 'Console: ' + CONSOLE_URL }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
