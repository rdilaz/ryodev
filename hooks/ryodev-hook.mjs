#!/usr/bin/env node
// RyoDev laptop hook: tells the RyoDev hub what an AI coding session is doing.
//
// Zero dependencies, Node 18+. It must never get in the agent's way, so:
//   - it always exits 0 and never writes to stdout (Claude Code feeds hook
//     stdout back into the conversation for some events);
//   - everything is wrapped in try/catch, and a hard 3 second timer exits
//     no matter what (network down, server hanging, stdin never closing);
//   - diagnostics go to stderr only when RYODEV_DEBUG=1.
//
// Modes:
//   node ryodev-hook.mjs                 Claude Code hook (JSON on stdin)
//   node ryodev-hook.mjs --codex '<json>'  Codex `notify` program. If you
//       already had a notify program, the installer saved it in
//       ~/.ryodev/codex-chain.json and this hook starts it too, unchanged.
//   node ryodev-hook.mjs --state <s> [--project p] [--session id] [--tool t] [--detail text]
//
// What is sent (and nothing else): machine name, tool name, a 12-hex hash of
// the session id, the project folder's name, the state, an optional short
// detail (Claude Code notification text, e.g. "Needs permission: Bash"), and
// the current time. Prompts, transcripts, assistant replies, file paths and
// raw session ids never leave the laptop.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = ['claude-code', 'codex', 'opencode', 'kilo', 'other'];
export const STATES = ['running', 'needs_input', 'finished', 'error', 'ended'];
const MACHINE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const HARD_EXIT_MS = 3000;
const REQUEST_TIMEOUT_MS = 2500;
const MAX_STDIN_BYTES = 8 * 1024 * 1024; // PostToolUse payloads can carry tool output
const UNPRINTABLE_RUNS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2069\\ufeff]+', 'g');

const debugOn = process.env.RYODEV_DEBUG === '1';
const debug = message => { if (debugOn) process.stderr.write(`ryodev-hook: ${message}\n`); };

export const ryodevDir = () => path.join(os.homedir(), '.ryodev');

// --- Small, pure helpers (also used by install.mjs and the tests) -----------

// One printable line, cut to `max` UTF-16 units without splitting an emoji.
export function cleanText(value, max = 120) {
  let text = String(value ?? '').replace(UNPRINTABLE_RUNS, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) {
    text = text.slice(0, max - 1);
    if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  return text;
}

// Claude Code notification text -> short detail. Anything that looks like a
// filesystem path is replaced, so paths cannot leak through a message.
export function notificationDetail(message) {
  const text = cleanText(message, 400);
  const permission = /needs your permission to use (.+?)\.?$/i.exec(text);
  const detail = permission ? `Needs permission: ${permission[1]}` : text;
  return cleanText(detail.replace(/(^|[\s("'`=])(?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`)]*/g, '$1[path]')) || null;
}

// The raw session id never leaves the laptop: only a short hash of it.
export function hashSession(tool, rawSession) {
  return createHash('sha256').update(`${tool}:${rawSession}`).digest('hex').slice(0, 12);
}

// Name of the git top-level folder containing `cwd` (found by looking for a
// `.git` directory or file, no child processes), else the folder's own name.
// The home folder itself is skipped so a dotfiles repo never names a project.
// All filesystem calls are async so the hard exit timer can always fire.
export async function projectName(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const home = path.resolve(os.homedir());
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  let top = null;
  for (let dir = start, i = 0; i < 64; i++) {
    if (!same(dir, home) && (await access(path.join(dir, '.git')).then(() => true, () => false))) { top = dir; break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cleanText(path.basename(top || start).replace(/[\\/]/g, '-'), 48) || 'unknown';
}

// Environment variables win; ~/.ryodev/config.json fills the gaps.
export async function loadConfig(env = process.env) {
  let file = {};
  try { file = JSON.parse(await readFile(path.join(ryodevDir(), 'config.json'), 'utf8')) || {}; } catch { /* no file */ }
  const config = {
    url: env.RYODEV_URL || file.url,
    token: env.RYODEV_TOKEN || file.token,
    machine: env.RYODEV_MACHINE || file.machine,
  };
  if (!config.url || !config.token || !config.machine) return null;
  if (!MACHINE_RE.test(config.machine) || !safeOrigin(config.url)) return null;
  return config;
}

// The token must only travel over HTTPS (plain HTTP is allowed for localhost).
// The URL may include a mount path such as https://ryo.is/_/yourcode.
export function safeOrigin(url) {
  try {
    const u = new URL(url);
    if (u.search || u.hash || u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

// Joins the configured address (origin plus optional mount path) with an API route.
export const apiUrl = (base, route) => `${String(base).replace(/\/+$/, '')}/api/${route}`;

export function buildEvent({ machine, tool, rawSession, project, state, detail }, nowMs = Date.now()) {
  const event = {
    v: 1, machine, tool, session: hashSession(tool, rawSession), project, state,
    ts: new Date(nowMs).toISOString(),
  };
  const clean = detail ? cleanText(detail) : '';
  if (clean) event.detail = clean;
  return event;
}

export async function sendEvent(config, event, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetch(apiUrl(config.url, 'events'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs),
  });
  await response.body?.cancel().catch(() => {});
  return response.status;
}

// --- Translating each agent's hook payload into { state, detail, … } --------

// Claude Code hook JSON. Only session_id, cwd, hook_event_name, message and
// notification_type are ever read; `prompt`, transcripts and tool data are not.
export function fromClaude(input) {
  const base = { tool: 'claude-code', rawSession: String(input?.session_id ?? ''), cwd: input?.cwd };
  switch (input?.hook_event_name) {
    case 'UserPromptSubmit': return { ...base, state: 'running' };
    case 'Stop': return { ...base, state: 'finished' };
    case 'SessionEnd': return { ...base, state: 'ended' };
    case 'PostToolUse': return { ...base, state: 'running', onlyIfWaiting: true };
    case 'Notification': {
      // "Claude is waiting for your input" (idle_prompt) arrives ~60 s after a
      // turn already reported `finished`; auth_success is not a request either.
      const type = input.notification_type;
      if (type === 'idle_prompt' || type === 'auth_success') return null;
      if (!type && /waiting for your input/i.test(String(input.message ?? ''))) return null;
      return { ...base, state: 'needs_input', detail: notificationDetail(input.message) };
    }
    default: return null; // SessionStart, SubagentStop, PreToolUse, … are ignored
  }
}

// Codex `notify` JSON. Only type, thread-id and cwd are read; input-messages
// and last-assistant-message are never touched.
export async function fromCodex(payload) {
  if (payload?.type !== 'agent-turn-complete') return null;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  // Older Codex builds omit thread-id: fall back to one row per project.
  const thread = payload['thread-id'] ? String(payload['thread-id']) : `project:${await projectName(cwd)}`;
  return { tool: 'codex', rawSession: thread, cwd, state: 'finished' };
}

export async function fromArgs(args) {
  const get = flag => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  const state = get('--state');
  if (!STATES.includes(state)) return null;
  const tool = TOOLS.includes(get('--tool')) ? get('--tool') : 'other';
  const project = (get('--project') && cleanText(get('--project').replace(/[\\/]/g, '-'), 48)) || (await projectName(process.cwd()));
  return { tool, state, detail: get('--detail'), project, rawSession: get('--session') || `manual:${project}` };
}

// --- Claude Code permission-prompt marker ------------------------------------
// After a permission prompt (needs_input) is approved on the laptop, Claude
// keeps working without any new prompt, so the phone would keep saying
// "needs you". A tiny marker file per waiting session lets PostToolUse flip it
// back to running with one POST, and lets every other tool call exit without
// touching the network.

const markerPath = session => path.join(ryodevDir(), 'waiting', session);

async function markWaiting(session) {
  const dir = path.dirname(markerPath(session));
  await mkdir(dir, { recursive: true });
  await writeFile(markerPath(session), '');
  // Sessions killed while waiting leave markers behind; sweep week-old ones.
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    if (Date.now() - (await stat(file)).mtimeMs > 7 * 86_400_000) await unlink(file).catch(() => {});
  }
}

// Returns true only for the one process that actually removed the marker, so
// parallel tool calls send at most one "running".
const clearWaiting = session => unlink(markerPath(session)).then(() => true, () => false);

// --- Main --------------------------------------------------------------------

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let size = 0;
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) { process.stdin.destroy(); resolve(''); } else chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

// Codex allows one notify program. Start the one Ryo had before (argv saved by
// the installer) with the same JSON argument, detached so it outlives this
// hook and never waits on it. Runs even when RyoDev isn't configured.
export async function runChainedNotify(payloadArg, file = path.join(ryodevDir(), 'codex-chain.json')) {
  let argv;
  try { ({ argv } = JSON.parse(await readFile(file, 'utf8'))); } catch { return false; }
  if (!Array.isArray(argv) || !argv.length || !argv.every(part => typeof part === 'string' && part)) return false;
  if (argv.some(part => /ryodev-hook\.mjs/.test(part))) return false; // never chain to ourselves
  try {
    const child = spawn(argv[0], [...argv.slice(1), payloadArg], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', error => debug(`chained notify: ${error.message}`));
    child.unref();
    return true;
  } catch (error) {
    debug(`chained notify: ${error.message}`);
    return false;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--codex') && args.length > 1) await runChainedNotify(args[args.length - 1]);
  const config = await loadConfig();
  if (!config) return debug('not configured (RYODEV_URL/TOKEN/MACHINE or ~/.ryodev/config.json)');

  let action;
  if (args.includes('--codex')) {
    action = await fromCodex(JSON.parse(args[args.length - 1]));
  } else if (args.includes('--state')) {
    action = await fromArgs(args);
  } else {
    action = fromClaude(JSON.parse(await readStdin()));
  }
  if (!action) return debug('nothing to report for this event');

  const session = hashSession(action.tool, action.rawSession);
  if (action.tool === 'claude-code') {
    if (action.onlyIfWaiting) {
      if (!(await clearWaiting(session))) return; // the common case: no network at all
    } else if (action.state === 'needs_input') {
      await markWaiting(session).catch(error => debug(`marker: ${error.message}`));
    } else {
      await clearWaiting(session);
    }
  }

  const event = buildEvent({ ...action, machine: config.machine, project: action.project ?? (await projectName(action.cwd)) });
  const status = await sendEvent(config, event);
  debug(`POST /api/events -> ${status}`);
}

function isMainModule() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const quit = () => process.exit(0);
  setTimeout(quit, HARD_EXIT_MS);
  if (!debugOn) process.removeAllListeners('warning'); // e.g. Node 18's "fetch is experimental" notice
  process.on('uncaughtException', error => { debug(error?.message); quit(); });
  process.on('unhandledRejection', error => { debug(error?.message); quit(); });
  main().catch(error => debug(error?.message)).finally(quit);
}
