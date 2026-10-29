#!/usr/bin/env node
// The canvas CLI: `canvas serve`, `canvas mcp`, `canvas service ...` and the rest of the OpenFlowKit CLI, pointed at
// the app build shipped in this package. cli.js runs only when node starts it directly (isMain), so it is spawned.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runService, SERVICE_USAGE } from '../lib/service.js';

const args = process.argv.slice(2);
const self = realpathSync(fileURLToPath(import.meta.url));

if (args[0] === 'service') {
  process.exit(await runService(args.slice(1), { script: self }));
}

const cli = fileURLToPath(new URL('../server/dist/cli.js', import.meta.url));
const appDir = process.env.OPENFLOWKIT_APP_DIR ?? fileURLToPath(new URL('../app', import.meta.url));
const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env: { ...process.env, OPENFLOWKIT_APP_DIR: appDir, OPENFLOWKIT_CLI_NAME: process.env.OPENFLOWKIT_CLI_NAME ?? 'canvas' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  // The top-level help lists the CLI's own commands; `service` is this package's, so it is added after them.
  if (code === 0 && (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])))) console.log(`\n${SERVICE_USAGE}`);
  process.exit(code ?? (signal ? 128 : 1));
});
