import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSession, cleanText, notificationDetail, safeOrigin, fromClaude, apiUrl } from '../hooks/ryodev-hook.mjs';
import { CLAUDE_EVENTS, mergeClaudeSettings, addCodexNotify, parseCodexNotify, replaceCodexNotify } from '../hooks/install.mjs';

const HOOK = fileURLToPath(new URL('../hooks/ryodev-hook.mjs', import.meta.url));
const INSTALL = fileURLToPath(new URL('../hooks/install.mjs', import.meta.url));
const TOKEN = 'ingest-token-for-tests-0123456789';
const SID = 'c0ffee00-1111-2222-3333-444455556666';
const PROMPT = 'TOP SECRET PROMPT about /Users/ryo/private';

// --- Harness -------------------------------------------------------------------

// Local HTTP hub stand-in. `mode` is a status code, or 'hang' to never answer.
async function startServer(mode = 202) {
  const requests = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, raw: body, body: JSON.parse(body) });
      if (mode === 'hang') return;
      res.writeHead(mode, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(resolve)); };
  return { url, requests, close };
}

async function tempHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ryodev-home-'));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

function baseEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith('RYODEV_') && !(key in extra)) delete env[key];
  return env;
}

function run(file, args, { stdin, env, cwd } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [file, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.on('error', () => {});
    if (stdin !== undefined) child.stdin.end(typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
    child.on('close', code => resolve({ code, stdout, stderr, ms: Date.now() - started }));
  });
}

// A fake repo: <root>/myproj/.git plus a nested working directory.
async function fakeRepo(root) {
  const repo = path.join(root, 'work', 'myproj');
  const deep = path.join(repo, 'src', 'deep');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(deep, { recursive: true });
  return { repo, deep };
}

function assertEvent(request, expected, url = '/api/events') {
  assert.equal(request.method, 'POST');
  assert.equal(request.url, url);
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(request.headers['content-type'], /^application\/json/);
  const { ts, ...rest } = request.body;
  assert.ok(Math.abs(Date.parse(ts) - Date.now()) < 15_000, 'ts is now');
  assert.equal(new Date(ts).toISOString(), ts);
  assert.deepEqual(rest, { v: 1, machine: 'dell', ...expected });
  assert.ok(request.raw.length <= 2048);
}

// --- Claude Code, Codex and manual modes -----------------------------------------

test('Claude Code events map to states without leaking prompts, paths or raw ids', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const { deep } = await fakeRepo(home);
  const env = baseEnv(home, { RYODEV_URL: server.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  const session = hashSession('claude-code', SID);
  const common = { session_id: SID, cwd: deep, transcript_path: path.join(home, '.claude', 'projects', 'x.jsonl') };
  const hook = async input => {
    const result = await run(HOOK, [], { stdin: { ...common, ...input }, env });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    return result;
  };
  const expect = extra => ({ tool: 'claude-code', session, project: 'myproj', ...extra });

  await hook({ hook_event_name: 'UserPromptSubmit', prompt: PROMPT });
  assertEvent(server.requests.at(-1), expect({ state: 'running' }));

  await hook({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
  assertEvent(server.requests.at(-1), expect({ state: 'needs_input', detail: 'Needs permission: Bash' }));

  // Approving on the laptop: the next tool completion flips it back to running, once.
  await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cat ~/.ssh/id_rsa' }, tool_response: { stdout: 'SECRET OUTPUT' } });
  assertEvent(server.requests.at(-1), expect({ state: 'running' }));
  const afterFlip = server.requests.length;
  await hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'x'.repeat(200_000) });
  assert.equal(server.requests.length, afterFlip, 'ordinary tool calls do not touch the network');

  // Older builds send no notification_type; the idle reminder is still ignored.
  await hook({ hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' });
  await hook({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' });
  await hook({ hook_event_name: 'Notification', message: 'Auth ok', notification_type: 'auth_success' });
  await hook({ hook_event_name: 'SubagentStop', stop_hook_active: false });
  await hook({ hook_event_name: 'SessionStart', source: 'startup' });
  await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  await hook({ hook_event_name: 'SomethingNew' });
  assert.equal(server.requests.length, afterFlip, 'ignored events send nothing');

  await hook({ hook_event_name: 'Stop', stop_hook_active: false });
  assertEvent(server.requests.at(-1), expect({ state: 'finished' }));
  await hook({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  assertEvent(server.requests.at(-1), expect({ state: 'ended' }));

  for (const request of server.requests) {
    for (const secret of ['SECRET', SID, home, deep, 'transcript', 'ssh', 'Bash(']) assert.ok(!request.raw.includes(secret), `leaked ${secret}`);
  }
});

test('parallel tool completions after a permission prompt send one running event', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const env = baseEnv(home, { RYODEV_URL: server.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  const input = name => ({ session_id: SID, cwd: home, hook_event_name: name, message: 'Claude needs your permission to use Edit' });
  await run(HOOK, [], { stdin: input('Notification'), env });
  await Promise.all([1, 2, 3].map(() => run(HOOK, [], { stdin: input('PostToolUse'), env })));
  assert.deepEqual(server.requests.map(r => r.body.state), ['needs_input', 'running']);
});

test('Codex notify sends only the finished state, never messages', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const { deep } = await fakeRepo(home);
  const env = baseEnv(home, { RYODEV_URL: server.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  const payload = {
    type: 'agent-turn-complete', 'thread-id': 'thread-42', 'turn-id': 'turn-7', cwd: deep,
    'input-messages': [PROMPT], 'last-assistant-message': 'ASSISTANT SECRET reply',
  };
  let result = await run(HOOK, ['--codex', JSON.stringify(payload)], { env });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assertEvent(server.requests.at(-1), { tool: 'codex', session: hashSession('codex', 'thread-42'), project: 'myproj', state: 'finished' });
  assert.ok(!/SECRET|thread-42|turn-7|Users/.test(server.requests.at(-1).raw));

  // Older payloads without thread-id or cwd: one row per project, from the process cwd.
  const { 'thread-id': _, cwd: __, ...old } = payload;
  await run(HOOK, ['--codex', JSON.stringify(old)], { env, cwd: deep });
  assertEvent(server.requests.at(-1), { tool: 'codex', session: hashSession('codex', 'project:myproj'), project: 'myproj', state: 'finished' });

  const before = server.requests.length;
  for (const args of [['--codex', JSON.stringify({ type: 'approval-requested' })], ['--codex', 'not json'], ['--codex']]) {
    result = await run(HOOK, args, { env });
    assert.deepEqual([result.code, result.stdout], [0, '']);
  }
  assert.equal(server.requests.length, before);
});

test('manual mode for OpenCode, Kilo and scripts', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const { deep } = await fakeRepo(home);
  const env = baseEnv(home, { RYODEV_URL: server.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  await run(HOOK, ['--state', 'needs_input', '--project', 'My/App', '--session', 'abc', '--tool', 'opencode', '--detail', 'Waiting\non review'], { env });
  assertEvent(server.requests.at(-1), { tool: 'opencode', session: hashSession('opencode', 'abc'), project: 'My-App', state: 'needs_input', detail: 'Waiting on review' });
  await run(HOOK, ['--state', 'error', '--tool', 'nonsense'], { env, cwd: deep });
  assertEvent(server.requests.at(-1), { tool: 'other', session: hashSession('other', 'manual:myproj'), project: 'myproj', state: 'error' });
  const before = server.requests.length;
  const result = await run(HOOK, ['--state', 'done'], { env });
  assert.deepEqual([result.code, result.stdout, server.requests.length], [0, '', before]);
});

test('project is the git top-level name; a dotfiles repo at home is skipped', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const env = baseEnv(home, { RYODEV_URL: server.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  await mkdir(path.join(home, '.git'));
  const plain = path.join(home, 'notes', 'today');
  await mkdir(plain, { recursive: true });
  const worktree = path.join(home, 'code', 'ryodev-wt');
  await mkdir(path.join(worktree, 'lib'), { recursive: true });
  await writeFile(path.join(worktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/ryodev-wt\n');
  for (const [cwd, project] of [[plain, 'today'], [path.join(worktree, 'lib'), 'ryodev-wt']]) {
    await run(HOOK, [], { stdin: { session_id: SID, cwd, hook_event_name: 'Stop' }, env });
    assert.equal(server.requests.at(-1).body.project, project);
  }
});

test('config can come from ~/.ryodev/config.json; missing or unsafe config sends nothing', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const stdin = { session_id: SID, cwd: home, hook_event_name: 'Stop' };

  let result = await run(HOOK, [], { stdin, env: baseEnv(home) });
  assert.deepEqual([result.code, result.stdout, result.stderr, server.requests.length], [0, '', '', 0]);

  await mkdir(path.join(home, '.ryodev'));
  await writeFile(path.join(home, '.ryodev', 'config.json'), JSON.stringify({ url: 'http://example.com', token: TOKEN, machine: 'dell' }));
  result = await run(HOOK, [], { stdin, env: baseEnv(home, { RYODEV_DEBUG: '1' }) });
  assert.deepEqual([result.code, result.stdout, server.requests.length], [0, '', 0]);
  assert.match(result.stderr, /not configured/);

  await writeFile(path.join(home, '.ryodev', 'config.json'), JSON.stringify({ url: server.url, token: TOKEN, machine: 'dell' }));
  result = await run(HOOK, [], { stdin, env: baseEnv(home, { RYODEV_DEBUG: '1' }) });
  assert.equal(server.requests.length, 1);
  assert.match(result.stderr, /-> 202/);
  assert.ok(!result.stderr.includes(TOKEN), 'debug output never includes the token');

  for (const bad of ['not json', '', '[]', 'null']) {
    result = await run(HOOK, [], { stdin: bad, env: baseEnv(home) });
    assert.deepEqual([result.code, result.stdout], [0, '']);
  }
  assert.equal(server.requests.length, 1);
});

test('a down or hanging hub never blocks the agent', async t => {
  const { home, cleanup } = await tempHome();
  const hanging = await startServer('hang');
  const down = await startServer();
  await down.close();
  t.after(async () => { await hanging.close(); await cleanup(); });
  const stdin = { session_id: SID, cwd: home, hook_event_name: 'UserPromptSubmit', prompt: PROMPT };
  for (const url of [down.url, hanging.url]) {
    const result = await run(HOOK, [], { stdin, env: baseEnv(home, { RYODEV_URL: url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' }) });
    assert.deepEqual([result.code, result.stdout], [0, '']);
    assert.ok(result.ms < 3500, `exited in ${result.ms} ms`);
  }
  assert.equal(hanging.requests.length, 1);
  // stdin that never closes is cut off by the hard timer too.
  const child = spawn(process.execPath, [HOOK], { env: baseEnv(home, { RYODEV_URL: hanging.url, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' }) });
  const started = Date.now();
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 3500);
});

test('hook helpers: text cleaning, path redaction, hashing, origins', () => {
  assert.equal(cleanText('a\u0000b\u202Ec\n\td'), 'a b c d');
  assert.equal(cleanText('x'.repeat(200)).length, 120);
  assert.equal(notificationDetail('Claude needs your permission to use mcp__github__create_issue'), 'Needs permission: mcp__github__create_issue');
  assert.equal(notificationDetail('Allow edit of /Users/ryo/a.txt, C:\\Users\\ryo\\b or ~/c and "D:/x y"?'), 'Allow edit of [path] [path] or [path] and "[path] y"?');
  assert.equal(notificationDetail(undefined), null);
  assert.match(hashSession('claude-code', SID), /^[0-9a-f]{12}$/);
  assert.notEqual(hashSession('claude-code', SID), hashSession('codex', SID));
  assert.deepEqual(['https://x.workers.dev', 'http://localhost:8787', 'http://127.0.0.1:1', 'http://[::1]:2'].map(safeOrigin), [true, true, true, true]);
  assert.deepEqual(['http://example.com', 'ftp://x', 'nope', ''].map(safeOrigin), [false, false, false, false]);
  assert.equal(fromClaude({ hook_event_name: 'UserPromptSubmit', prompt: PROMPT, session_id: 's' }).prompt, undefined);
});

// --- Installer -----------------------------------------------------------------

test('install --dry-run changes nothing and sends nothing', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const result = await run(INSTALL, ['--url', server.url, '--token', TOKEN, '--machine', 'dell', '--claude', '--codex', '--dry-run'], { env: baseEnv(home) });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] would copy/);
  assert.match(result.stdout, /\[dry-run\] would add RyoDev hooks/);
  assert.match(result.stdout, /\[dry-run\] would send a test event/);
  assert.ok(!result.stdout.includes(TOKEN), 'token is masked');
  assert.deepEqual(await readdir(home), []);
  assert.equal(server.requests.length, 0);
});

test('install merges Claude and Codex config idempotently and sends a test event', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const claudeFile = path.join(home, '.claude', 'settings.json');
  const codexFile = path.join(home, '.codex', 'config.toml');
  const originalSettings = {
    model: 'opus',
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
    },
  };
  const originalToml = 'model = "o4"\n\n[mcp_servers.docs]\ncommand = "docs"\n';
  await mkdir(path.dirname(claudeFile), { recursive: true });
  await mkdir(path.dirname(codexFile), { recursive: true });
  await writeFile(claudeFile, JSON.stringify(originalSettings));
  await writeFile(codexFile, originalToml);

  const args = ['--url', `${server.url}/some/path`, '--token', TOKEN, '--machine', 'dell', '--claude', '--codex'];
  const first = await run(INSTALL, args, { env: baseEnv(home) });
  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /✓ test event: HTTP 202/);
  const second = await run(INSTALL, args, { env: baseEnv(home) });
  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /already installed/);
  assert.match(second.stdout, /already notifies RyoDev/);

  const hookCopy = path.join(home, '.ryodev', 'ryodev-hook.mjs');
  assert.equal(await readFile(hookCopy, 'utf8'), await readFile(HOOK, 'utf8'));
  const configFile = path.join(home, '.ryodev', 'config.json');
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')), { url: `${server.url}/some/path`, token: TOKEN, machine: 'dell' }, 'A mount path is part of the address');
  assert.equal(server.requests.at(-1).url, '/some/path/api/events');
  if (process.platform !== 'win32') assert.equal((await stat(configFile)).mode & 0o777, 0o600);

  const command = `node "${hookCopy.replaceAll('\\', '/')}"`;
  const settings = JSON.parse(await readFile(claudeFile, 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.permissions, originalSettings.permissions);
  assert.deepEqual(settings.hooks.PreToolUse, originalSettings.hooks.PreToolUse);
  assert.deepEqual(settings.hooks.Stop[0], originalSettings.hooks.Stop[0]);
  for (const event of CLAUDE_EVENTS) {
    const ours = settings.hooks[event].flatMap(g => g.hooks).filter(h => h.command.includes('ryodev-hook.mjs'));
    assert.deepEqual(ours, [{ type: 'command', command, timeout: 5 }], event);
  }
  const claudeBackups = (await readdir(path.dirname(claudeFile))).filter(f => f.startsWith('settings.json.bak-'));
  assert.equal(claudeBackups.length, 1, 'backup only when something changed');
  assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(claudeFile), claudeBackups[0]), 'utf8')), originalSettings);

  const toml = await readFile(codexFile, 'utf8');
  const lines = toml.split('\n');
  const notifyAt = lines.findIndex(l => l.startsWith('notify = '));
  assert.equal(lines.filter(l => l.startsWith('notify')).length, 1);
  assert.ok(notifyAt > -1 && notifyAt < lines.indexOf('[mcp_servers.docs]'), 'notify stays a top-level key');
  assert.equal(lines[notifyAt], `notify = ["node", "${hookCopy.replaceAll('\\', '/')}", "--codex"]`);
  const codexBackups = (await readdir(path.dirname(codexFile))).filter(f => f.startsWith('config.toml.bak-'));
  assert.equal(codexBackups.length, 1);

  assert.equal(server.requests.length, 2);
  assertEvent(server.requests[0], {
    tool: 'other', session: hashSession('other', 'setup:dell'), project: 'ryodev-setup', state: 'finished', detail: 'Hook installed on dell',
  }, '/some/path/api/events');

  // The installed copy works from its config file alone (no RYODEV_* variables).
  const result = await run(hookCopy, [], { stdin: { session_id: SID, cwd: home, hook_event_name: 'Stop' }, env: baseEnv(home) });
  assert.deepEqual([result.code, result.stdout], [0, '']);
  assert.equal(server.requests.at(-1).body.state, 'finished');
});

test('install reports failures instead of clobbering config', async t => {
  const server = await startServer(401);
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const claudeFile = path.join(home, '.claude', 'settings.json');
  const codexFile = path.join(home, '.codex', 'config.toml');
  await mkdir(path.dirname(claudeFile), { recursive: true });
  await mkdir(path.dirname(codexFile), { recursive: true });
  await writeFile(claudeFile, '{ "model": "opus", }');
  const multiLine = 'notify = [\n  "terminal-notifier",\n]\n';
  await writeFile(codexFile, multiLine);
  const result = await run(INSTALL, ['--url', server.url, '--token', TOKEN, '--machine', 'dell', '--claude', '--codex'], { env: baseEnv(home) });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /not a valid JSON object; left untouched/);
  assert.match(result.stdout, /can't safely rewrite/);
  assert.match(result.stdout, /✗ test event: HTTP 401 \(wrong INGEST_TOKEN\?\)/);
  assert.equal(await readFile(claudeFile, 'utf8'), '{ "model": "opus", }');
  assert.equal(await readFile(codexFile, 'utf8'), multiLine);

  for (const args of [['--url', 'http://example.com', '--token', 't', '--machine', 'dell'], ['--url', server.url, '--token', 't', '--machine', 'Dell PC'], ['--bogus']]) {
    const bad = await run(INSTALL, args, { env: baseEnv(home) });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /✗/);
  }
});

test('merge helpers keep foreign hooks that share a group with ours', () => {
  const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/old/ryodev-hook.mjs"' }, { type: 'command', command: 'say hi' }] }] } };
  const merged = mergeClaudeSettings(settings, 'node "/new/ryodev-hook.mjs"');
  assert.deepEqual(merged.hooks.Stop, [
    { hooks: [{ type: 'command', command: 'say hi' }] },
    { hooks: [{ type: 'command', command: 'node "/new/ryodev-hook.mjs"', timeout: 5 }] },
  ]);
  assert.deepEqual(mergeClaudeSettings(merged, 'node "/new/ryodev-hook.mjs"'), merged);
  // Entries left under events we no longer use are removed; untouched empty events stay.
  const stale = mergeClaudeSettings({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "/old/ryodev-hook.mjs"' }] }], Empty: [] } }, 'node "/x/ryodev-hook.mjs"');
  assert.equal('SessionStart' in stale.hooks, false);
  assert.deepEqual(stale.hooks.Empty, []);
  assert.deepEqual(Object.keys(stale.hooks).sort(), ['Empty', ...CLAUDE_EVENTS].sort());
  assert.equal(addCodexNotify('', 'notify = []'), 'notify = []\n');
  assert.equal(addCodexNotify('model = "x"\n', 'notify = []'), 'model = "x"\nnotify = []\n');
  assert.equal(addCodexNotify('  notify = ["a"]', 'notify = []'), null);
});

test('a mounted address such as https://ryo.is/_/code keeps its path', async t => {
  assert.equal(apiUrl('https://ryo.is/_/k7Qm2x', 'events'), 'https://ryo.is/_/k7Qm2x/api/events');
  assert.equal(apiUrl('https://ryo.is/_/k7Qm2x/', 'events'), 'https://ryo.is/_/k7Qm2x/api/events');
  assert.equal(apiUrl('https://ryodev.you.workers.dev', 'events'), 'https://ryodev.you.workers.dev/api/events');
  for (const bad of ['https://ryo.is/_/x?k=1', 'https://ryo.is/_/x#k', 'https://user:pw@ryo.is/_/x', 'http://ryo.is/_/x']) assert.equal(safeOrigin(bad), false, bad);
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  const env = baseEnv(home, { RYODEV_URL: `${server.url}/_/k7Qm2x/`, RYODEV_TOKEN: TOKEN, RYODEV_MACHINE: 'dell' });
  const result = await run(HOOK, ['--state', 'running', '--project', 'mounted'], { env });
  assert.equal(result.code, 0);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, '/_/k7Qm2x/api/events');
  const installed = await run(INSTALL, ['--url', `${server.url}/_/k7Qm2x/`, '--token', TOKEN, '--machine', 'dell'], { env: baseEnv(home) });
  assert.equal(installed.code, 0, installed.stderr);
  const config = JSON.parse(await readFile(path.join(home, '.ryodev', 'config.json'), 'utf8'));
  assert.equal(config.url, `${server.url}/_/k7Qm2x`, 'Installer keeps the mount path, minus the trailing slash');
  assert.equal(server.requests.at(-1).url, '/_/k7Qm2x/api/events', 'Installer test event uses the mount');
});

test('an existing Codex notify program keeps running alongside RyoDev', async t => {
  const server = await startServer();
  const { home, cleanup } = await tempHome();
  t.after(async () => { await server.close(); await cleanup(); });
  assert.deepEqual(parseCodexNotify('notify = ["python3", "C:\\\\n.py", \'-x\'] # mine'), ['python3', 'C:\\n.py', '-x']);
  for (const bad of ['notify = []', 'notify = [\n"a"\n]', 'notify = ["a", { b = 1 }]', 'model = "x"']) assert.equal(parseCodexNotify(bad), null, bad);
  assert.equal(replaceCodexNotify('a = 1\nnotify = ["x"] # c\n[t]\n', 'notify = ["y"]'), 'a = 1\nnotify = ["y"]\n[t]\n');

  // The "previous" notifier: records the arguments Codex would have given it.
  const recorder = path.join(home, 'recorder.mjs');
  const out = path.join(home, 'chained.json');
  await writeFile(recorder, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
  const codexFile = path.join(home, '.codex', 'config.toml');
  await mkdir(path.dirname(codexFile), { recursive: true });
  const original = `model = "gpt"\nnotify = ${JSON.stringify([process.execPath, recorder, '--flag'])}\n\n[tui]\nx = 1\n`;
  await writeFile(codexFile, original);

  const installed = await run(INSTALL, ['--url', server.url, '--token', TOKEN, '--machine', 'dell', '--codex'], { env: baseEnv(home) });
  assert.equal(installed.code, 0, installed.stdout + installed.stderr);
  assert.match(installed.stdout, /keep your existing Codex notify/);
  const hookCopy = path.join(home, '.ryodev', 'ryodev-hook.mjs');
  const toml = await readFile(codexFile, 'utf8');
  assert.equal(toml, original.replace(/^notify = .*$/m, `notify = ["node", "${hookCopy.replaceAll('\\', '/')}", "--codex"]`), 'Only the notify line changes, in place');
  const chain = JSON.parse(await readFile(path.join(home, '.ryodev', 'codex-chain.json'), 'utf8'));
  assert.deepEqual(chain.argv, [process.execPath, recorder, '--flag']);
  assert.equal((await readdir(path.dirname(codexFile))).filter(f => f.startsWith('config.toml.bak-')).length, 1);
  const again = await run(INSTALL, ['--url', server.url, '--token', TOKEN, '--machine', 'dell', '--codex'], { env: baseEnv(home) });
  assert.match(again.stdout, /already notifies RyoDev/);
  assert.deepEqual(JSON.parse(await readFile(path.join(home, '.ryodev', 'codex-chain.json'), 'utf8')).argv, chain.argv, 'Re-running keeps the saved notifier');

  const waitFor = async file => {
    for (let i = 0; i < 60; i++) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { await new Promise(r => setTimeout(r, 50)); } }
    throw new Error(`${file} never written`);
  };
  const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 't1', cwd: home });
  const hooked = await run(hookCopy, ['--codex', payload], { env: baseEnv(home) });
  assert.deepEqual([hooked.code, hooked.stdout], [0, '']);
  assert.deepEqual(await waitFor(out), ['--flag', payload], 'The old notifier gets exactly what Codex would have sent');
  assert.equal(server.requests.at(-1).body.tool, 'codex', 'RyoDev still reports the turn');

  // Even with RyoDev unconfigured (config removed), the old notifier still runs.
  await rm(out);
  await rm(path.join(home, '.ryodev', 'config.json'));
  const before = server.requests.length;
  await run(hookCopy, ['--codex', payload], { env: baseEnv(home) });
  assert.deepEqual(await waitFor(out), ['--flag', payload]);
  assert.equal(server.requests.length, before);
});
