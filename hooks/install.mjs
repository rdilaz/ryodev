#!/usr/bin/env node
// Installs the RyoDev hook on this laptop (Windows, macOS or Linux).
//
//   node hooks/install.mjs --url https://ryodev.<you>.workers.dev --token <INGEST_TOKEN> \
//        --machine dell [--claude] [--codex] [--dry-run]
//
// 1. Copies ryodev-hook.mjs to ~/.ryodev/ and writes ~/.ryodev/config.json (0600).
// 2. --claude: adds hook entries to ~/.claude/settings.json (backed up first).
//    Re-running replaces our entries instead of duplicating them; every other
//    setting and hook is left exactly as it was.
// 3. --codex: adds `notify = [...]` to ~/.codex/config.toml when it has no
//    notify line yet (backed up first); otherwise prints what to add.
// 4. Sends one test event and prints ✓ or ✗ with the HTTP status.

import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvent, safeOrigin, sendEvent } from './ryodev-hook.mjs';

// Claude Code events we listen to. PostToolUse only makes a network call when
// a permission prompt was pending (see ryodev-hook.mjs); otherwise it is a
// quick local file check.
export const CLAUDE_EVENTS = ['UserPromptSubmit', 'Notification', 'PostToolUse', 'Stop', 'SessionEnd'];
const HOOK_FILE = 'ryodev-hook.mjs';
const MACHINE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const mask = token => `${token.slice(0, 4)}…(${token.length} chars)`;

function parseArgs(argv) {
  const options = { claude: false, codex: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--claude') options.claude = true;
    else if (arg === '--codex') options.codex = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (['--url', '--token', '--machine'].includes(arg)) options[arg.slice(2)] = argv[++i];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.url || !safeOrigin(options.url)) throw new Error('--url must be your RyoDev address over HTTPS, e.g. https://ryo.is/_/yourcode or https://ryodev.you.workers.dev');
  if (!options.token || /\s/.test(options.token)) throw new Error('--token must be the INGEST_TOKEN (no spaces)');
  if (!options.machine || !MACHINE_RE.test(options.machine)) throw new Error('--machine must be lowercase letters, digits or dashes, e.g. dell');
  const parsed = new URL(options.url);
  options.url = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  return options;
}

// On Windows, forward slashes work for node and need no escaping in JSON,
// TOML, cmd, PowerShell or Git Bash. The path is later wrapped in double
// quotes, so characters that stay special inside them are refused.
function hookCommandPath(home) {
  let file = path.join(home, '.ryodev', HOOK_FILE);
  if (process.platform === 'win32') file = file.replaceAll('\\', '/');
  if (/["$`\\%]/.test(file)) throw new Error(`Home folder path has a character that can't be quoted safely: ${file}`);
  return file;
}

// Pure: returns a copy of Claude Code settings with our hooks (re)installed.
export function mergeClaudeSettings(settings, command) {
  const next = structuredClone(settings ?? {});
  if (typeof next.hooks !== 'object' || next.hooks === null || Array.isArray(next.hooks)) next.hooks = {};
  const ours = hook => typeof hook?.command === 'string' && hook.command.includes(HOOK_FILE);
  // Drop earlier RyoDev entries everywhere (maybe with an old path or for an
  // event we no longer use). Groups and events we emptied go too; nothing
  // else is touched.
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map(group => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter(h => !ours(h)) } : group))
      .filter(group => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (kept.length) next.hooks[event] = kept;
    else if (groups.length) delete next.hooks[event];
  }
  for (const event of CLAUDE_EVENTS) {
    next.hooks[event] = [...(next.hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout: 5 }] }];
  }
  return next;
}

// Pure: returns the new config.toml text, or null when it must not be edited.
// `notify` is a top-level key, so it goes before the first [table] header.
// Reads a single-line TOML `notify = [...]` of plain strings. Returns the argv,
// or null for anything more complex (multi-line arrays, inline tables...).
export function parseCodexNotify(toml) {
  const match = /^[ \t]*notify[ \t]*=[ \t]*\[(.*)\][ \t]*(?:#.*)?$/m.exec(toml);
  if (!match) return null;
  const argv = [];
  const item = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:,|$)/y;
  let rest = match[1].trim();
  if (rest.endsWith(',')) rest = rest.slice(0, -1);
  item.lastIndex = 0;
  while (item.lastIndex < rest.length) {
    const start = item.lastIndex;
    const found = item.exec(rest);
    if (!found || found.index !== start) return null;
    if (found[1] !== undefined) {
      try { argv.push(JSON.parse(`"${found[1]}"`)); } catch { return null; }
    } else argv.push(found[2]);
  }
  return argv.length ? argv : null;
}

// Swaps an existing single-line notify for ours, in place.
export function replaceCodexNotify(toml, line) {
  return toml.replace(/^[ \t]*notify[ \t]*=[ \t]*\[.*\][ \t]*(?:#.*)?$/m, line);
}

export function addCodexNotify(toml, line) {
  if (/^\s*notify\s*=/m.test(toml)) return null;
  const lines = toml.split(/\r?\n/);
  const firstTable = lines.findIndex(l => /^\s*\[/.test(l));
  if (firstTable === -1) return `${toml.replace(/\s*$/, '')}${toml.trim() ? '\n' : ''}${line}\n`;
  lines.splice(firstTable, 0, line, '');
  return lines.join('\n');
}

async function writePrivate(file, text) {
  await writeFile(file, text, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {}); // mode is ignored when the file already existed
}

export async function install(argv, log = console.log) {
  const options = parseArgs(argv);
  const home = os.homedir();
  const dir = path.join(home, '.ryodev');
  const hookPath = path.join(dir, HOOK_FILE);
  const commandPath = hookCommandPath(home);
  const would = options.dryRun ? '[dry-run] would ' : '';
  let ok = true;

  // 1. Hook script + config.
  const config = { url: options.url, token: options.token, machine: options.machine };
  log(`${would}copy ${HOOK_FILE} to ${hookPath}`);
  log(`${would}write ${path.join(dir, 'config.json')} (url ${config.url}, machine ${config.machine}, token ${mask(config.token)})`);
  if (!options.dryRun) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await copyFile(fileURLToPath(new URL(`./${HOOK_FILE}`, import.meta.url)), hookPath);
    await writePrivate(path.join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  // 2. Claude Code.
  if (options.claude) {
    const file = path.join(home, '.claude', 'settings.json');
    let settings = {};
    let original = null;
    if (existsSync(file)) {
      original = await readFile(file, 'utf8');
      try {
        settings = original.trim() ? JSON.parse(original) : {};
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('not an object');
      } catch {
        log(`✗ ${file} is not a valid JSON object; left untouched. Fix it and re-run.`);
        settings = null;
        ok = false;
      }
    }
    if (settings) {
      const merged = mergeClaudeSettings(settings, `node "${commandPath}"`);
      const unchanged = JSON.stringify(merged) === JSON.stringify(settings);
      log(unchanged
        ? `Claude Code hooks already installed in ${file}.`
        : `${would}add RyoDev hooks (${CLAUDE_EVENTS.join(', ')}) to ${file}`);
      if (!options.dryRun && !unchanged) {
        await mkdir(path.dirname(file), { recursive: true });
        if (original !== null) {
          const backup = `${file}.bak-${stamp()}`;
          await writeFile(backup, original);
          log(`  backup: ${backup}`);
        }
        await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
      }
    }
  }

  // 3. Codex.
  if (options.codex) {
    const file = path.join(home, '.codex', 'config.toml');
    const line = `notify = ${JSON.stringify(['node', commandPath, '--codex'])}`.replaceAll('","', '", "');
    const current = existsSync(file) ? await readFile(file, 'utf8') : null;
    let updated = current === null ? null : addCodexNotify(current, line);
    const existing = current === null || updated !== null ? null : parseCodexNotify(current);
    if (current !== null && /^\s*notify\s*=.*ryodev-hook\.mjs/m.test(current)) {
      log(`Codex already notifies RyoDev (${file}).`);
    } else if (existing) {
      // Codex allows one notify program: RyoDev takes the slot and runs the old one too.
      updated = replaceCodexNotify(current, line);
      const chain = path.join(dir, 'codex-chain.json');
      log(`${would}keep your existing Codex notify (${existing.join(' ')}) running: saved to ${chain}`);
      log(`${would}replace the notify line in ${file}: ${line}`);
      if (!options.dryRun) {
        const backup = `${file}.bak-${stamp()}`;
        await writeFile(backup, current);
        await writeFile(chain, `${JSON.stringify({ argv: existing }, null, 2)}\n`);
        await writeFile(file, updated);
        log(`  backup: ${backup}`);
      }
    } else if (updated !== null) {
      log(`${would}add to ${file}: ${line}`);
      if (!options.dryRun) {
        const backup = `${file}.bak-${stamp()}`;
        await writeFile(backup, current);
        await writeFile(file, updated);
        log(`  backup: ${backup}`);
      }
    } else {
      const why = current === null ? `${file} does not exist yet` : `${file} has a notify setting this installer can't safely rewrite`;
      log(`Codex: ${why}. Add this line near the top (before any [section]), or combine it with your existing notify:`);
      log(`  ${line}`);
    }
  }

  // 4. Test event.
  const event = buildEvent({
    machine: options.machine, tool: 'other', rawSession: `setup:${options.machine}`,
    project: 'ryodev-setup', state: 'finished', detail: `Hook installed on ${options.machine}`,
  });
  if (options.dryRun) {
    log(`[dry-run] would send a test event to ${options.url}/api/events`);
    return ok;
  }
  try {
    const status = await sendEvent(options, event, 10_000);
    const sent = status === 202;
    log(`${sent ? '✓' : '✗'} test event: HTTP ${status}${status === 401 ? ' (wrong INGEST_TOKEN?)' : ''}`);
    return ok && sent;
  } catch (error) {
    log(`✗ test event failed: ${error.cause?.code || error.name || error.message}`);
    return false;
  }
}

const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (isMain()) {
  install(process.argv.slice(2)).then(
    ok => { process.exitCode = ok ? 0 : 1; },
    error => { console.error(`✗ ${error.message}`); process.exitCode = 1; },
  );
}
