# RyoDev live setup

Live mode shows real status on your phone: which laptop and project is waiting for you, what is running, what finished.

How it works: each laptop's Claude Code or Codex runs a tiny hook. The hook sends a short status line to your own Cloudflare Worker. Your phone reads it from there.

## 1. Deploy the hub (once, from one laptop)

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

Call the first one **INGEST** (for laptops) and the second one **VIEW** (for your phone). Never use the same token for both.

Deploy, then paste each token when asked:

```sh
npx wrangler deploy
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put VIEW_TOKEN
```

`wrangler deploy` prints your address, like `https://ryodev.YOU.workers.dev`. Open `https://ryodev.YOU.workers.dev/api/health` to check it. You should see `{"ok":true,"v":1,"service":"ryodev"}`.

## 2. Set up each laptop

Each laptop needs Node 18 or newer and a copy of this repo. Use the name `mac`, `dell`, `hp` or `aero`:

```sh
git clone https://github.com/rdilaz/ryodev
cd ryodev
node hooks/install.mjs --url https://ryodev.YOU.workers.dev --token INGEST --machine dell --claude --codex
```

Look for `✓ test event: HTTP 202` at the end. Your phone should now show a "ryodev-setup" row for that laptop.

- Add `--dry-run` to see what it would change without changing anything.
- The command works the same way in PowerShell on Windows.
- Restart open Claude Code and Codex sessions so they pick up the hook.
- It's safe to run again. It replaces its own entries and never duplicates them.
- It backs up `~/.claude/settings.json` and `~/.codex/config.toml` before editing them.
- If Codex already has a `notify` program, RyoDev takes over the `notify` line and starts your old program too, with the same data. The old setting is saved in `~/.ryodev/codex-chain.json` (and in the config backup).

For OpenCode, Kilo or your own scripts, call the hook directly:

```sh
node ~/.ryodev/ryodev-hook.mjs --state needs_input --tool opencode --detail "Waiting for review"
```

States: `running`, `needs_input`, `finished`, `error`, `ended`.

## 3. Set up the iPhone

1. Open `https://ryodev.YOU.workers.dev` in Safari.
2. Tap **Share**, then **Add to Home Screen**, and open RyoDev from the new icon. Do this first: a Home Screen app keeps its own storage, separate from Safari.
3. Scroll to **Make it real**, paste the **VIEW** token into **Viewer key**, and tap **Connect**.

## 4. Put it on ryo.is behind a secret code

This serves RyoDev at `https://ryo.is/_/YOURCODE/` instead of the workers.dev address. The rest of ryo.is is untouched. Any other address under `/_/` shows "Not found", and search engines are told not to index it.

The code only hides the app. Your data is still protected by the VIEW and INGEST tokens.

You need the ryo.is domain in the same Cloudflare account as the Worker (it should appear under **Websites** in the dashboard).

Make a code and save it with your tokens (PowerShell or any terminal):

```sh
node -e "console.log('/_/' + require('crypto').randomBytes(9).toString('base64url'))"
```

Store it as a secret, then deploy. `wrangler.toml` already routes `ryo.is/_/*` to the Worker, and the code itself never goes in the repo:

```sh
npx wrangler secret put BASE_PATH
npx wrangler deploy
```

Paste the whole line it printed, like `/_/k7Qm2xP9aLw3`, when asked. Check it: `https://ryo.is/_/k7Qm2xP9aLw3/api/health` should show `{"ok":true,...}`.

Then point everything at the new address:

- **Each laptop:** rerun the installer with the new URL, e.g. `node hooks/install.mjs --url https://ryo.is/_/k7Qm2xP9aLw3 --token INGEST --machine dell --claude`.
- **iPhone:** delete the old Home Screen icon, open `https://ryo.is/_/k7Qm2xP9aLw3/` in Safari, add it to the Home Screen, open it from the icon and connect with the VIEW token again. A new address means new storage.

Once `BASE_PATH` is set, the plain workers.dev address shows "Not found" too. To change the code, run the two commands again and repeat the laptop and iPhone steps. To go back to the root, run `npx wrangler secret delete BASE_PATH`.

If `wrangler deploy` says it can't find the ryo.is zone, the domain is on another account or provider. Remove the `routes` block from `wrangler.toml` and the workers.dev address keeps working.

## 5. Optional: put the hub behind Cloudflare Access

This adds a Cloudflare login in front of the phone app, on top of the VIEW token.

1. In the Cloudflare dashboard, open Workers, then **ryodev**, then **Settings**, then **Domains & Routes**. Turn on Cloudflare Access for the workers.dev address.
2. In Zero Trust, go to **Access**, then **Applications**. Add a second self-hosted application for the same hostname, with path `api/events` (or `_/YOURCODE/api/events` if you set up section 4), and give it a **Bypass** policy for Everyone.

Laptops need that bypass because the hook doesn't send Access service-token headers. The INGEST token still protects `/api/events`.

## 6. Rotate tokens or uninstall

**New INGEST token:** run `npx wrangler secret put INGEST_TOKEN`, then run the install command again on each laptop with the new token.

**New VIEW token:** run `npx wrangler secret put VIEW_TOKEN`, then tap Connect on the phone again.

**Remove from one laptop:**

- Delete the `~/.ryodev` folder.
- In `~/.claude/settings.json`, delete the entries that mention `ryodev-hook.mjs`, or restore the `.bak-` copy.
- In `~/.codex/config.toml`, delete the `notify` line that mentions `ryodev-hook.mjs`. If you had your own notify program before, put its line back from `~/.ryodev/codex-chain.json` or the `.bak-` copy.

**Clear a stuck row:** tap **Clear this row** in the app.

**Remove the hub completely:** run `npx wrangler delete`.

## 7. What leaves the laptop

Each status update is one small HTTPS request containing only these fields:

- `machine`: the name you chose, like `dell`
- `tool`: `claude-code`, `codex`, `opencode`, `kilo` or `other`
- `session`: a 12-character fingerprint (a hash) of the session id, never the id itself
- `project`: the name of the git repo's folder, like `ryodev`, without the rest of the path
- `state`: one of the five states above
- `detail` (optional): Claude Code's notification text, such as "Needs permission: Bash", with anything that looks like a file path replaced by `[path]`. Or the `--detail` text you pass yourself.
- `ts` and `v`: the current time and the format version

**What never leaves the laptop:**

- your prompts
- Claude's or Codex's replies
- transcripts
- commands, tool input and tool output
- file paths
- raw session ids
- environment variables

Cloudflare sees each laptop's IP address, as with any website.

**On the laptop itself:**

- `~/.ryodev/config.json` holds the INGEST token. It's readable only by you on macOS and Linux.
- `~/.ryodev/waiting/` holds empty marker files. They let a finished permission prompt switch back to "running".

**On the hub:** it keeps at most 100 sessions and the last 100 updates.

- Ended sessions disappear after an hour.
- Anything with no update for 7 days is removed.
