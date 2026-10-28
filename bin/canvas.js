#!/usr/bin/env node
// The service CLI (`canvas serve`, `canvas create`, ...), pointed at the app build shipped in this package.
// cli.js runs only when node starts it directly (isMain), so it is spawned, not imported.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../server/dist/cli.js', import.meta.url));
const appDir = process.env.OPENFLOWKIT_APP_DIR ?? fileURLToPath(new URL('../app', import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENFLOWKIT_APP_DIR: appDir },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
