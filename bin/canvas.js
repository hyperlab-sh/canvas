#!/usr/bin/env node
// The canvas CLI: `canvas serve`, `canvas mcp`, `canvas service ...` and the rest of the OpenFlowKit CLI, pointed at
// the app build shipped in this package. Runs on whatever runtime started it (node, or bun when invoked as `bun canvas`).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli } from '../lib/launch.js';
import { runOpen } from '../lib/open.js';
import { runService } from '../lib/service.js';

const args = process.argv.slice(2);
const self = realpathSync(fileURLToPath(import.meta.url));

if (args[0] === 'service') {
  process.exit(await runService(args.slice(1), { script: self }));
}

if (args[0] === 'open') {
  process.exit(await runOpen(args.slice(1), { program: [process.execPath, self] }));
}

const command = process.versions.bun ? [process.execPath, '--preload', fileURLToPath(new URL('../lib/hide-self.js', import.meta.url))] : [process.execPath];
runCli({
  args,
  command,
  cli: fileURLToPath(new URL('../server/dist/cli.js', import.meta.url)),
  appDir: process.env.OPENFLOWKIT_APP_DIR ?? fileURLToPath(new URL('../app', import.meta.url)),
});
