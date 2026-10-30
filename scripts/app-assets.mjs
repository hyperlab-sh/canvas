// Names, collects and checksums the desktop app bundles (the CI side of `desktop/`).
//   node scripts/app-assets.mjs collect <bundle dir> <os-cpu> <out dir>   copy the target's bundles to canvas-app-<v>-<os>-<cpu>.<ext>
//   node scripts/app-assets.mjs version                                   print the app version
//   node scripts/app-assets.mjs expected <version>                        print the full asset list, one name per line
//   node scripts/app-assets.mjs check <dir>                              fail unless <dir> holds exactly that list
//   node scripts/app-assets.mjs sums <dir> <SHA256SUMS>                   append the app assets in <dir> to SHA256SUMS
//   node scripts/app-assets.mjs config                                    print the Tauri config override with the canvas dependency
// The app version is the one in desktop/src-tauri/Cargo.toml; the dependency is on the CLI version in package.json.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What each target ships, in the spelling of the CLI archives (`darwin`, `linux`, `windows`; `x64`, `arm64`).
 * Keep in step with `bundles` in the matrix of .github/workflows/app.yml, which names the same bundles for Tauri.
 */
export const TARGETS = {
  'darwin-arm64': ['dmg'],
  'darwin-x64': ['dmg'],
  'windows-x64': ['msi', '-setup.exe'],
  'linux-x64': ['AppImage', 'deb', 'rpm'],
  'linux-arm64': ['AppImage', 'deb', 'rpm'],
};

/** C-6: canvas-app-<version>-<os>-<cpu>.<ext>, where ext is dmg, msi, -setup.exe, AppImage, deb or rpm. */
export function assetName(version, target, ext) {
  if (!TARGETS[target]?.includes(ext)) throw new Error(`no ${ext} bundle for ${target}`);
  return `canvas-app-${version}-${target}${ext.startsWith('-') ? '' : '.'}${ext}`;
}

export function expectedAssets(version) {
  return Object.entries(TARGETS).flatMap(([target, exts]) => exts.map((ext) => assetName(version, target, ext))).sort();
}

/** The bundle extension a file produced by the Tauri bundler has, or null for files that are not bundles. */
export function bundleExt(file) {
  if (file.endsWith('-setup.exe')) return '-setup.exe';
  const match = /\.(dmg|msi|AppImage|deb|rpm)$/.exec(file);
  return match ? match[1] : null;
}

/** The bundles in a `target/release/bundle`-shaped tree, as { file, ext } (updater files and `.app` directories are not bundles). */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith('.app')) yield* walk(file);
    } else if (bundleExt(entry.name)) yield file;
  }
}

/** Copies the target's bundles under their release names. Exactly one file per expected extension. */
export function collect(bundleDir, target, outDir, version) {
  if (!TARGETS[target]) throw new Error(`unknown target "${target}"; one of: ${Object.keys(TARGETS).join(', ')}`);
  const found = [...walk(bundleDir)];
  mkdirSync(outDir, { recursive: true });
  return TARGETS[target].map((ext) => {
    const files = found.filter((file) => bundleExt(file) === ext);
    if (files.length !== 1) throw new Error(`expected one ${ext} bundle for ${target} under ${bundleDir}, found ${files.length}`);
    const name = assetName(version, target, ext);
    copyFileSync(files[0], join(outDir, name));
    return name;
  });
}

/** Missing and unexpected names in a directory listing; both empty when it holds exactly the app assets of `version`. */
export function diffAssets(names, version) {
  const expected = expectedAssets(version);
  const apps = names.filter((name) => name.startsWith('canvas-app-'));
  return { missing: expected.filter((name) => !apps.includes(name)), unexpected: apps.filter((name) => !expected.includes(name)) };
}

/** SHA256SUMS lines (`<hex>  <name>`, as sha256sum prints them) for the app assets, replacing any earlier line for the same name. */
export function mergeSums(existing, dir, names) {
  const kept = existing.split('\n').filter((line) => line && !names.some((name) => line.endsWith(`  ${name}`)));
  const added = names.map((name) => `${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}  ${name}`);
  return `${[...kept, ...added].join('\n')}\n`;
}

/** Tauri `--config` override: the .deb depends on the CLI package of at least this version; the .rpm on the bare name, because Tauri passes an rpm requirement through as a capability name and a versioned one could never be satisfied. */
export function dependsConfig(cliVersion) {
  return { bundle: { linux: { deb: { depends: [`canvas (>= ${cliVersion})`] }, rpm: { depends: ['canvas'] } } } };
}

export function appVersion() {
  const cargo = readFileSync(join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8');
  const match = /^version = "([^"]+)"/m.exec(cargo);
  if (!match) throw new Error('no version in desktop/src-tauri/Cargo.toml');
  return match[1];
}

export function cliVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

function main([command, ...args]) {
  switch (command) {
    case 'collect': {
      const [bundleDir, target, outDir] = args;
      for (const name of collect(resolve(bundleDir), target, resolve(outDir), appVersion())) console.log(name);
      return;
    }
    case 'version':
      console.log(appVersion());
      return;
    case 'expected':
      if (!args[0]) throw new Error('usage: app-assets.mjs expected <version>');
      console.log(expectedAssets(args[0]).join('\n'));
      return;
    case 'check': {
      const { missing, unexpected } = diffAssets(readdirSync(resolve(args[0])), appVersion());
      if (missing.length || unexpected.length) throw new Error(`app assets differ: missing [${missing}] unexpected [${unexpected}]`);
      console.log('app assets complete');
      return;
    }
    case 'sums': {
      const [dir, file] = args;
      const names = readdirSync(resolve(dir)).filter((name) => name.startsWith('canvas-app-')).sort();
      writeFileSync(resolve(file), mergeSums(readFileSync(resolve(file), 'utf8'), resolve(dir), names));
      return;
    }
    case 'config':
      console.log(JSON.stringify(dependsConfig(cliVersion())));
      return;
    default:
      throw new Error('usage: app-assets.mjs collect|version|expected|check|sums|config');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
