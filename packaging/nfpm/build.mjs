// Builds the canvas .deb and .rpm for linux-x64 and linux-arm64 from the release archives.
//   node packaging/nfpm/build.mjs [--release release] [--out release]
// Reads canvas-<version>-linux-<x64|arm64>.tar.gz from --release, writes canvas_<v>_<amd64|arm64>.deb and
// canvas-<v>-1.<x86_64|aarch64>.rpm to --out. Needs `nfpm` on PATH and GNU or bsd tar.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

export const RPM_RELEASE = '1';
const ARCHES = [
  { archive: 'x64', deb: 'amd64', rpm: 'x86_64' },
  { archive: 'arm64', deb: 'arm64', rpm: 'aarch64' },
];

/** The release archive and the two package file names for one architecture. */
export function packageNames(version, arch) {
  const a = ARCHES.find((x) => x.archive === arch || x.deb === arch);
  if (!a) throw new Error(`unknown architecture "${arch}"`);
  return {
    archive: `canvas-${version}-linux-${a.archive}.tar.gz`,
    deb: `canvas_${version}_${a.deb}.deb`,
    rpm: `canvas-${version}-${RPM_RELEASE}.${a.rpm}.rpm`,
    nfpmArch: a.deb,
  };
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
}

function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const releaseDir = resolve(ROOT, option('--release', 'release'));
  const outDir = resolve(ROOT, option('--out', 'release'));
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  mkdirSync(outDir, { recursive: true });

  const work = mkdtempSync(join(tmpdir(), 'canvas-nfpm-'));
  try {
    for (const { archive: cpu } of ARCHES) {
      const names = packageNames(version, cpu);
      const stage = join(work, cpu);
      mkdirSync(stage);
      run('tar', ['-xzf', join(releaseDir, names.archive), '-C', stage]);
      const env = { CANVAS_VERSION: version, CANVAS_ARCH: names.nfpmArch, CANVAS_STAGE: stage };
      run('nfpm', ['package', '--config', join(HERE, 'canvas.yaml'), '--packager', 'deb', '--target', join(outDir, names.deb)], { ...env, CANVAS_RELEASE: '' });
      run('nfpm', ['package', '--config', join(HERE, 'canvas.yaml'), '--packager', 'rpm', '--target', join(outDir, names.rpm)], { ...env, CANVAS_RELEASE: RPM_RELEASE });
      console.log(`[nfpm] ${names.deb} ${names.rpm}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
