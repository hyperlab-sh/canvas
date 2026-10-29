// Entry of the standalone binary (`bun build --compile`, see scripts/package-native.mjs). The binary is bun itself plus this
// launcher; the CLI is a bundled script beside it in <prefix>/share/canvas, which the binary runs by starting itself as bun.
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCli, versionOutput } from '../lib/launch.js';
import { runOpen } from '../lib/open.js';
import { runService, stableExecutable } from '../lib/service.js';

// Replaced with the package.json version by `bun build --define` in scripts/package-native.mjs.
const PACKAGE_VERSION = typeof __CANVAS_VERSION__ === 'undefined' ? undefined : __CANVAS_VERSION__;

const args = process.argv.slice(2);
const version = versionOutput(args, PACKAGE_VERSION);
if (version) {
  console.log(version);
  process.exit(0);
}
const exe = realpathSync(process.execPath);
const share = join(dirname(exe), '..', 'share', 'canvas');

if (args[0] === 'service') {
  process.exit(await runService(args.slice(1), { program: [stableExecutable(exe)] }));
}

if (args[0] === 'open') {
  process.exit(await runOpen(args.slice(1), { program: [exe] }));
}

runCli({
  args,
  command: [exe],
  cli: join(share, 'server', 'dist', 'cli.js'),
  appDir: join(share, 'app'),
  env: { BUN_BE_BUN: '1' },
});
