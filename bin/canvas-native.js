// Entry of the standalone binary (`bun build --compile`, see scripts/package-native.mjs). The binary is bun itself plus this
// launcher; the CLI is a bundled script beside it in <prefix>/share/canvas, which the binary runs by starting itself as bun.
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCli } from '../lib/launch.js';
import { runOpen } from '../lib/open.js';
import { runService, stableExecutable } from '../lib/service.js';

const args = process.argv.slice(2);
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
