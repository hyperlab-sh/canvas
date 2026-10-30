// Prints nix/release.json for a release from its SHA256SUMS: the version and the archive hashes in Nix (SRI) format.
//   node scripts/render-nix-release.mjs <version> <SHA256SUMS>
// flake.nix reads the output; the release workflow commits it to main once the GitHub release exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Nix system -> archive suffix of canvas-<version>-<suffix>.tar.gz
export const SYSTEMS = {
  'x86_64-linux': 'linux-x64',
  'aarch64-linux': 'linux-arm64',
  'x86_64-darwin': 'darwin-x64',
  'aarch64-darwin': 'darwin-arm64',
};

export function renderNixRelease(version, sumsText) {
  const sums = Object.fromEntries(sumsText.trim().split('\n').map((line) => { const [hash, name] = line.trim().split(/\s+/); return [name, hash]; }));
  const hashes = {};
  for (const [system, target] of Object.entries(SYSTEMS)) {
    const name = `canvas-${version}-${target}.tar.gz`;
    const hex = sums[name];
    if (!/^[0-9a-f]{64}$/.test(hex ?? '')) throw new Error(`${name} is not in SHA256SUMS`);
    hashes[system] = `sha256-${Buffer.from(hex, 'hex').toString('base64')}`;
  }
  return `${JSON.stringify({ version, hashes }, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, source] = process.argv.slice(2);
  if (!version || !source) throw new Error('usage: render-nix-release.mjs <version> <SHA256SUMS>');
  process.stdout.write(renderNixRelease(version, readFileSync(source, 'utf8')));
}
