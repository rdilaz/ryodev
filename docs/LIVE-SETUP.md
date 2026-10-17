# RyoDev live setup

Live mode shows hook-reported status in a phone or desktop browser: which
machine and project is waiting, what is running, and what finished.

How it works: each machine's Claude Code or Codex runs a tiny hook. The hook
sends a short status line to your own Cloudflare Worker. Your browser reads it
from there. Claude Code maps supported lifecycle events; Codex currently emits
only a finished event for `agent-turn-complete`.

## 1. Deploy the hub (once, from one machine)

You need Node 22 and a free Cloudflare account.

```sh
git clone https://github.com/rdilaz/ryodev
cd ryodev
npm ci
npm run build
npx wrangler login
```

Make two tokens. Run this twice and save both results in your password manager:

```sh
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

Call the first one **INGEST** (for hooks) and the second one **VIEW** (for the
viewer). Never use the same token for both.

Deploy, then paste each token when asked:

```sh
npx wrangler deploy
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put VIEW_TOKEN
```

`wrangler deploy` prints your address, like `https://ryodev.YOU.workers.dev`. Open `https://ryodev.YOU.workers.dev/api/health` to check it. You should see `{"ok":true,"v":1,"service":"ryodev"}`.

## 2. Set up each machine

Each machine needs Node 18 or newer and a copy of this repo. Choose a short,
non-sensitive label, such as `workstation-1`:

```sh
git clone https://github.com/rdilaz/ryodev
cd ryodev
node hooks/install.mjs --url https://ryodev.YOU.workers.dev --token INGEST --machine workstation-1 --claude --codex
```

Look for `✓ test event: HTTP 202` at the end. The viewer should now show a
`setup-check` row for that machine.

- Add `--dry-run` to see what it would change without changing anything.
- The command works the same way in PowerShell on Windows.
- Restart open Claude Code and Codex sessions so they pick up the hook.
- It's safe to run again. It replaces its own entries and never duplicates them.
- It backs up `~/.claude/settings.json` and `~/.codex/config.toml` before editing them.
- If Codex has a parseable existing `notify` program, RyoDev replaces that line and starts the old program too, with the same data. Its command is saved in `~/.ryodev/codex-chain.json` (and in the config backup). If the installer cannot safely parse the existing setting, it prints a manual instruction instead.

For OpenCode, Kilo or your own scripts, call the hook directly:

```sh
node ~/.ryodev/ryodev-hook.mjs --state needs_input --tool opencode --detail "Waiting for review"
```

States: `running`, `needs_input`, `finished`, `error`, `ended`.

## 3. Open the viewer

1. Open `https://ryodev.YOU.workers.dev` in a phone or desktop browser.
2. On iOS, optionally tap Safari **Share**, then **Add to Home Screen**. A
   Home Screen app keeps its own storage, separate from Safari.
3. Scroll to **Make it real**, paste the **VIEW** token into **Viewer key**,
   and tap **Connect**.

## 4. Optional custom domain or mount path

The checked-in `wrangler.toml` intentionally contains no custom-domain route.
If you use one, configure it in Cloudflare or add an uncommitted local route
for a domain you control, for example:

```toml
routes = [
  { pattern = "status.example/_/*", zone_name = "status.example" },
]
```

To mount the Worker below a path, store that path as the `BASE_PATH` secret and
deploy:

```sh
npx wrangler secret put BASE_PATH
npx wrangler deploy
```

For example, use `/_/private-path` as the `BASE_PATH` value and configure a
matching `status.example/_/*` route. Check
`https://status.example/_/private-path/api/health` for the JSON health response.

Then point everything at the new address:

- **Each machine:** rerun the installer with the new URL, e.g. `node hooks/install.mjs --url https://status.example/_/private-path --token INGEST --machine workstation-1 --claude`.
- **Viewer:** open the new URL and connect with the VIEW token again. A new
  origin means separate browser or Home Screen storage.

Once `BASE_PATH` is set, the plain workers.dev address shows "Not found" too.
To return to the root, run `npx wrangler secret delete BASE_PATH` and deploy.
A mount path limits casual discovery but is not access control; the INGEST and
VIEW tokens protect the API. Do not commit a private hostname or path to a
public fork.

## 5. Optional: put the hub behind Cloudflare Access

This adds a Cloudflare login in front of the phone app, on top of the VIEW token.

1. In the Cloudflare dashboard, open Workers, then **ryodev**, then **Settings**, then **Domains & Routes**. Turn on Cloudflare Access for the workers.dev address.
2. In Zero Trust, go to **Access**, then **Applications**. Add a second
   self-hosted application for the same hostname, with path `api/events` (or
   your configured mount path followed by `/api/events`), and give it a
   **Bypass** policy for Everyone.

Machines need that bypass because the hook doesn't send Access service-token headers. The INGEST token still protects `/api/events`.

## 6. Rotate tokens or uninstall

**New INGEST token:** run `npx wrangler secret put INGEST_TOKEN`, then run the install command again on each machine with the new token.

**New VIEW token:** run `npx wrangler secret put VIEW_TOKEN`, then reconnect each viewer.

**Remove from one machine:**

- In `~/.codex/config.toml`, delete the `notify` line that mentions `ryodev-hook.mjs`. If you had a previous notify program, restore it from `~/.ryodev/codex-chain.json` or the `.bak-` copy before deleting `~/.ryodev`.
- In `~/.claude/settings.json`, delete the entries that mention `ryodev-hook.mjs`, or restore the `.bak-` copy.
- Then delete the `~/.ryodev` folder.

**Clear a stuck row:** tap **Clear this row** in the app.

**Remove the hub completely:** run `npx wrangler delete`.

## 7. What leaves the machine

Each status update is one small HTTPS request containing only these fields:

- `machine`: the name you chose, like `workstation-1`
- `tool`: `claude-code`, `codex`, `opencode`, `kilo` or `other`
- `session`: a 12-character fingerprint (a hash) of the session id, never the id itself
- `project`: the manual `--project` label, or the git-repository folder name (falling back to the current folder), without its parent path
- `state`: one of the five states above
- `detail` (optional): Claude Code's notification text or the `--detail` text you pass yourself. It is compacted; recognizable absolute, home-relative, drive, and UNC paths are replaced by `[path]`. Do not put sensitive text in manual detail.
- `ts` and `v`: the current time and the format version

**Automatic Claude Code and Codex hook inputs never send:**

- your prompts
- Claude's or Codex's replies
- transcripts
- commands, tool input and tool output
- raw session ids
- environment variables

Cloudflare sees each machine's IP address, as with any website.

**On the machine itself:**

- `~/.ryodev/config.json` holds the INGEST token. It's readable only by you on macOS and Linux.
- `~/.ryodev/waiting/` holds empty marker files. They let a finished permission prompt switch back to "running".

**On the hub:** it keeps at most 100 sessions and the last 100 updates.

- Ended sessions disappear after an hour.
- Sessions and updates with no activity for 7 days are removed; machine-presence rows expire after 30 days.
