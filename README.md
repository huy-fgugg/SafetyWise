# SafetyWise

A classroom safety & management console (admin **and** teacher views) plus a Chrome extension agent for **school-managed, consented devices** — comparable in capability to classroom-management suites: live view of each student's active tab, lock screen, close tab, send a message, web filtering, keyword alerts, and reports.

> ⚠️ **Intended use.** SafetyWise is for school-owned / managed devices where students and guardians have been informed, consistent with school policy and applicable law. It is not covert monitoring software. The extension shows a lock/message overlay to the student and a block page when a site is filtered.

## What's in here

| Path | What it is |
|------|-----------|
| `public/` | The web console (login, admin + teacher dashboard) — static files |
| `functions/api/[[route]].js` | The API, as a Cloudflare Pages Function backed by **KV** |
| `server/` | A zero-dependency Node server that runs the *same* API locally with a JSON file (for development without Cloudflare) |
| `extension/` | The SafetyWise Chrome extension (Manifest V3) |

**Demo login:** `admin` / `admin` (the first/owner admin). Teachers are created from the admin console.

---

## Run locally (no Cloudflare needed)

```bash
npm run dev
```

Open http://localhost:3000 and sign in with `admin` / `admin`. State is saved to `server/data.json`.

---

## Deploy to Cloudflare Pages

Cloudflare's serverless runtime can't run the Node server, so deployment uses the **Pages Function** (`functions/api/[[route]].js`) + **KV** for storage. The `public/` folder is the static site.

1. **Install wrangler and log in** (one time):
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. **Create the KV namespace** and copy the returned `id` into `wrangler.toml` (the `SAFETYWISE_KV` binding):
   ```bash
   wrangler kv namespace create SAFETYWISE_KV
   ```
3. **Deploy:**
   ```bash
   wrangler pages deploy public
   ```
   Wrangler prints your live URL, e.g. `https://safetywise.pages.dev`.

> If you create the Pages project through the Cloudflare dashboard instead, set the build output directory to `public`, leave the build command empty, and add a **KV binding** named `SAFETYWISE_KV` in *Settings → Functions → KV namespace bindings*.

The first time you open the deployed site, the default admin (`admin`/`admin`) is seeded automatically. **Change this password** from *Extension setup → Add another admin* before real use.

---

## Install the Chrome extension

1. Edit `extension/config.js` (or set values from the extension popup) so `serverUrl` points at your console (local `http://localhost:3000` or your `*.pages.dev` URL) and `enrollToken` matches the token shown in the console under **Extension setup**.
2. Visit `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.
3. On a school-managed fleet you'd instead push the extension and its config via the Google Admin console (managed storage policy). The extension enrolls the device and begins reporting.

### What the extension does
- Reports the active tab title/URL and open-tab count to the console every few seconds.
- Enforces web-filter rules (redirects blocked pages to a SafetyWise block page).
- Applies teacher commands: **lock screen**, **send message**, **close tab**.
- Raises **keyword alerts** server-side.

---

## Features

**Admin:** manage teachers, students, classes; set web-filter rules (block/allow by URL substring + category toggles); set alert keywords; add admins; view everything.

**Teacher:** live classroom grid, lock/unlock, close tab, message a student, see alerts and recent activity.

## Security notes
- Demo credentials (`admin`/`admin`) and a demo enroll token are for first-run convenience — change both before any real deployment.
- Sessions are bearer tokens (in KV with a 12h TTL on Cloudflare; in memory locally).
