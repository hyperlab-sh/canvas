// Builds standalone canvas archives (no node or bun needed to run them) from the output of `npm run build`.
//   bun scripts/package-native.mjs [--out release] [target ...]      targets: darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64
// With no target it builds the machine's own. Needs bun (build time only); bun cross-compiles, so one host builds them all.
//
// Archive layout, extracted into a prefix:   bin/canvas   share/canvas/server/{dist/cli.js,data,...}   share/canvas/app/
// The binary is bun plus bin/canvas-native.js; it runs the bundled CLI by starting itself as bun (BUN_BE_BUN=1).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'];

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = resolve(ROOT, outIndex >= 0 ? argv[outIndex + 1] : 'release');
const requested = argv.filter((arg, i) => !arg.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));
const host = `${platform() === 'win32' ? 'windows' : platform()}-${arch() === 'x64' ? 'x64' : arch()}`;
const targets = requested.length ? requested : [host];
for (const target of targets) if (!TARGETS.includes(target)) throw new Error(`unknown target "${target}"; one of: ${TARGETS.join(', ')}`);

for (const dir of ['server/dist/cli.js', 'server/data', 'app/index.html']) {
  if (!existsSync(join(ROOT, dir))) throw new Error(`${dir} is missing: run \`npm run build\` first.`);
}
const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
}

/** Every file under server/dist that is not code: the viewer page and the like, read from disk at run time. */
async function* assets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* assets(file);
    else if (!/\.(js|map|d\.ts)$/.test(entry.name)) yield file;
  }
}

// One bundle for every target: the CLI with its dependencies inlined, so nothing has to be installed beside it.
// bun defines `self`, which makes elkjs mistake the process for a web worker; deleting it first keeps layout working.
const work = join(ROOT, 'native-build');
await rm(work, { recursive: true, force: true });
const share = join(work, 'share', 'canvas');
run('bun', ['build', 'server/dist/cli.js', '--target=bun', '--banner=delete globalThis.self;', `--outfile=${join(share, 'server', 'dist', 'cli.js')}`]);
for await (const file of assets(join(ROOT, 'server', 'dist'))) {
  const to = join(share, 'server', 'dist', relative(join(ROOT, 'server', 'dist'), file));
  await mkdir(dirname(to), { recursive: true });
  await cp(file, to);
}
await cp(join(ROOT, 'server', 'data'), join(share, 'server', 'data'), { recursive: true });
await cp(join(ROOT, 'app'), join(share, 'app'), { recursive: true });

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const sums = [];
for (const target of targets) {
  const windows = target.startsWith('windows');
  const stage = join(work, target);
  await mkdir(join(stage, 'bin'), { recursive: true });
  await cp(join(work, 'share'), join(stage, 'share'), { recursive: true });
  for (const doc of ['LICENSE', 'NOTICE', 'README.md']) await cp(join(ROOT, doc), join(stage, doc));
  run('bun', ['build', '--compile', `--target=bun-${target}`, 'bin/canvas-native.js', `--outfile=${join(stage, 'bin', windows ? 'canvas.exe' : 'canvas')}`]);

  const archive = `canvas-${version}-${target}.${windows ? 'zip' : 'tar.gz'}`;
  const entries = ['bin', 'share', 'LICENSE', 'NOTICE', 'README.md'];
  // bsdtar (macOS, Windows) and GNU tar differ; zip is only for Windows, where the installer expands it with PowerShell.
  if (windows) run('zip', ['-qr', join(outDir, archive), ...entries], stage);
  else run('tar', ['-czf', join(outDir, archive), ...entries], stage);
  const digest = createHash('sha256').update(await readFile(join(outDir, archive))).digest('hex');
  sums.push(`${digest}  ${archive}`);
  console.log(`[native] ${archive}  ${((await stat(join(outDir, archive))).size / 1e6).toFixed(1)} MB`);
}
await writeFile(join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
await rm(work, { recursive: true, force: true });
