// What the repository pools keep: the newest KEEP_VERSIONS versions of each package for each architecture.
//   node retention.mjs list  <site>                 print the .deb/.rpm paths in the pools, relative to <site>
//   node retention.mjs prune <site>                 delete the older versions
//   node retention.mjs check <site> <listing file>  fail unless every file in the listing (made by `list` before the build) is
//                                                   still there or was pruned for newer ones, and no package exceeds the limit
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KEEP_VERSIONS = 3;

const DEB = /^(?<name>[^_]+)_(?<version>[^_]+)_(?<arch>[^_.]+)\.deb$/;
const RPM = /^(?<name>.+)-(?<version>[^-]+-[^-]+)\.(?<arch>[^.]+)\.rpm$/;

/** { name, version, arch, kind } of a pool file name, or null. */
export function parsePackage(file) {
  const base = file.split('/').pop();
  const match = DEB.exec(base) ?? RPM.exec(base);
  return match ? { ...match.groups, kind: base.endsWith('.deb') ? 'deb' : 'rpm' } : null;
}

// Digit runs compare as numbers, other runs as text. A tail that starts a pre-release ("-rc.1", "~beta") sorts before the release.
const PRE = /^(~|-?[A-Za-z])/;
export function compareVersions(a, b) {
  const chunks = (v) => v.match(/\d+|\D+/g) ?? [];
  const [x, y] = [chunks(a), chunks(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return PRE.test(y[i]) ? 1 : -1;
    if (y[i] === undefined) return PRE.test(x[i]) ? -1 : 1;
    const numeric = /^\d/.test(x[i]) && /^\d/.test(y[i]);
    const d = numeric ? Number(x[i]) - Number(y[i]) : x[i] < y[i] ? -1 : x[i] > y[i] ? 1 : 0;
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The pool files, relative to the site: apt/pool/main/<letter>/<name>/*.deb and rpm/<arch>/*.rpm. */
export function listPool(site) {
  const out = [];
  const entries = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []);
  for (const letter of entries(join(site, 'apt/pool/main')))
    for (const pkg of entries(join(site, 'apt/pool/main', letter.name)))
      for (const f of entries(join(site, 'apt/pool/main', letter.name, pkg.name))) if (f.name.endsWith('.deb')) out.push(`apt/pool/main/${letter.name}/${pkg.name}/${f.name}`);
  for (const arch of entries(join(site, 'rpm')))
    for (const f of entries(join(site, 'rpm', arch.name))) if (f.name.endsWith('.rpm')) out.push(`rpm/${arch.name}/${f.name}`);
  return out.sort();
}

/** The files to delete: all but the newest `keep` of each kind/name/arch. */
export function stale(files, keep = KEEP_VERSIONS) {
  const groups = new Map();
  for (const file of files) {
    const p = parsePackage(file);
    if (!p) continue;
    const key = `${p.kind}/${p.name}/${p.arch}`;
    groups.set(key, [...(groups.get(key) ?? []), { file, version: p.version }]);
  }
  return [...groups.values()].flatMap((g) => g.sort((a, b) => compareVersions(b.version, a.version)).slice(keep).map((x) => x.file));
}

/** Problems with the tree after a build: a package over the limit, or an earlier file gone without being pruned. */
export function problems(before, after, keep = KEEP_VERSIONS) {
  const found = [];
  if (stale(after, keep).length) found.push(`more than ${keep} versions kept: ${stale(after, keep).join(', ')}`);
  const present = new Set(after);
  for (const file of before) {
    if (present.has(file)) continue;
    // Allowed only when the package is at its limit and every kept version is newer.
    const p = parsePackage(file);
    const kept = after.map((f) => ({ f, p: parsePackage(f) })).filter((x) => x.p && x.p.kind === p.kind && x.p.name === p.name && x.p.arch === p.arch);
    if (kept.length !== keep || kept.some((x) => compareVersions(x.p.version, p.version) <= 0)) found.push(`${file} disappeared`);
  }
  return found;
}

function main([command, site, listing]) {
  if (!site) throw new Error('usage: retention.mjs list|prune|check <site> [listing]');
  if (command === 'list') console.log(listPool(site).join('\n'));
  else if (command === 'prune') {
    for (const file of stale(listPool(site))) {
      console.log(`pruned ${file}`);
      rmSync(join(site, file));
    }
  } else if (command === 'check') {
    const before = readFileSync(listing, 'utf8').split('\n').filter(Boolean);
    const found = problems(before, listPool(site));
    if (found.length) throw new Error(found.join('\n'));
    console.log(`${before.length} earlier files kept or pruned for newer versions; at most ${KEEP_VERSIONS} versions per package`);
  } else throw new Error(`unknown command "${command}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
