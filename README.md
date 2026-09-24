# RyoDev

**What needs me, where, and how fresh is that claim?**

RyoDev is a phone command center for AI coding sessions running across four
laptops (Mac, Dell, HP, Gigabyte Aero). Open it on your iPhone and see which
project is waiting for you, what's running, what finished, and what has gone
quiet — without opening a terminal.

- **Demo:** https://rdilaz.github.io/ryodev/ (invented data, always labelled)
- **Live:** your own Cloudflare Worker, fed by Claude Code and Codex hooks on
  each laptop, optionally tucked behind a secret path on ryo.is. Setup takes
  about ten minutes: [docs/LIVE-SETUP.md](docs/LIVE-SETUP.md).

## How live mode works

```
laptop agent hook ──POST /api/events──▶ Cloudflare Worker + Durable Object ◀──GET /api/state── iPhone
 (Claude Code, Codex)   ingest token        (latest state per session)          viewer key   (this app)
```

- `hooks/ryodev-hook.mjs` runs on each laptop when a turn starts, needs input,
  finishes or the session ends. It sends only machine, project folder name,
  a hashed session id, state and time. Never prompts, code, paths or replies.
  It never blocks the agent: 3 second timeout, always exits cleanly.
- `worker/` is one small Worker that validates events, keeps the latest
  state per session and serves this app from `dist/`.
- The app polls every 20 seconds while open and says exactly how old its data
  is. A session with no event for 20 minutes shows as **Quiet**, never offline
  or done, because hooks report events, not heartbeats.
- "Mark reviewed" lives on your phone only. "Clear this row" removes a stuck
  session from the Worker.

## Honest by design

The demo ships 30 invented scenarios that exercise the rules the live view
also follows: stale is not offline, idle is not done, seen is not approved,
missing values are null (never zero), and four laptops sharing one account
never multiply its allowance.

## Run it

```sh
npm ci
npm start            # http://127.0.0.1:4173 (demo, static preview)
npm run check        # model, live, worker, hook, browser and deployment tests
npm run build        # stages the public files into dist/
```

Browser tests use installed Microsoft Edge by default (that's what CI runs).
Anywhere else, point them at Chromium:
`RYODEV_BROWSER_PATH=/path/to/chrome npm run check`.

To run live mode: `npm run build && npx wrangler deploy` — see the setup guide.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `src/app.js`, `src/styles.css` | The phone app (plain HTML/CSS/ES modules, no build step) |
| `src/model.js`, `src/fixtures.js` | Demo rules and the 30 invented scenarios |
| `src/live.js` | Turns Worker state into the live view |
| `worker/` | Cloudflare Worker + Durable Object (`wrangler.toml`) |
| `hooks/` | Laptop hook and installer |
| `scripts/` | Static preview, build and publication verifier |
| `tests/` | `node:test` suites plus real-browser checks |
| `android/` | Earlier WebView wrapper for the demo |
| `docs/history/` | The original V0 plan and review notes, kept for reference |

## Privacy

No analytics, cookies, service worker or third-party requests, and no web
fonts: it uses the same system font stack as the AI Visualizer. The page's CSP only
allows same-origin requests, so live mode can only talk to the Worker that
served it. GitHub Pages hosts the invented demo only; your real status lives
in your own Worker.
