// Builds the Canvas submodule (app + MCP server) and assembles server/ and app/ for publishing.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'editor');
const SERVER_SRC = resolve(SRC, 'mcp-server');

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd} (exit ${result.status})`);
}

if (!existsSync(resolve(SRC, 'package.json'))) throw new Error('The editor submodule is empty: run `git submodule update --init`.');

// The package installs the server's runtime dependencies itself, so they must match the submodule's.
const ours = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')).dependencies;
const theirs = JSON.parse(await readFile(resolve(SERVER_SRC, 'package.json'), 'utf8')).dependencies;
if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
  throw new Error(`dependencies drifted from editor/mcp-server.\nours:   ${JSON.stringify(ours)}\ntheirs: ${JSON.stringify(theirs)}`);
}

// mcp-server is an npm workspace of the app: one install at the root covers both.
run(SRC, 'npm', ['ci']);
run(SRC, 'npm', ['run', 'build']);
run(SERVER_SRC, 'npm', ['run', 'build']);

await rm(resolve(ROOT, 'server'), { recursive: true, force: true });
await rm(resolve(ROOT, 'app'), { recursive: true, force: true });
await mkdir(resolve(ROOT, 'server'), { recursive: true });
await cp(resolve(SERVER_SRC, 'dist'), resolve(ROOT, 'server', 'dist'), { recursive: true });
await cp(resolve(SERVER_SRC, 'data'), resolve(ROOT, 'server', 'data'), { recursive: true });
await cp(resolve(SRC, 'dist'), resolve(ROOT, 'app'), { recursive: true });
// The worker bundle is for the hosted endpoint, not this package.
await rm(resolve(ROOT, 'server', 'dist', 'worker.js'), { force: true });
await rm(resolve(ROOT, 'server', 'dist', 'worker.js.map'), { force: true });
console.log('[build] server/ and app/ ready');
