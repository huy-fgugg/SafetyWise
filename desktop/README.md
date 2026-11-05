# SafetyWise Desktop

A native desktop app (Windows / macOS / Linux) that runs the SafetyWise console as its own program instead of a browser tab. Built with Electron.

It loads your hosted console (default **https://safetywise.pages.dev**), remembers its window size, opens outside links in your browser, and has Home / Reload / Back menu items.

## Run it (development)

```bash
cd desktop
npm install
npm start
```

The app window opens and loads the console. Sign in with your admin or teacher account.

To point it at a different console (e.g. a self-hosted one), set `SAFETYWISE_URL`:

```bash
SAFETYWISE_URL=https://my-console.example.com npm start
```

## Build installers

This produces a double-click installer for the current OS in `desktop/dist/`.

```bash
cd desktop
npm install
npm run dist          # current platform
# or target one explicitly:
npm run dist:win      # Windows  -> .exe (NSIS installer)
npm run dist:mac      # macOS    -> .dmg
npm run dist:linux    # Linux    -> .AppImage
```

Notes:
- Build each platform's installer **on that platform** (Windows builds on Windows, etc.) unless you set up cross-compilation.
- The installers are **unsigned**. Windows SmartScreen and macOS Gatekeeper will warn on first launch; for distribution to staff you'd sign them with a code-signing certificate (yours to obtain).
- The app icon is `build/icon.png` — replace it with your own 512×512 (or larger) PNG to rebrand.

## What it is (and isn't)
- It's a **shell around the web console** for teachers/admins — same features as the website, in a window.
- It is **not** the student monitoring agent. Student devices still run the **Chrome extension** (`/extension`). This desktop app is just a convenient way to open the teacher/admin console.
