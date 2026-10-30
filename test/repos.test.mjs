import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KEEP_VERSIONS, compareVersions, listPool, parsePackage, problems, stale } from '../packaging/repos/retention.mjs';

const path = (p) => new URL(`../${p}`, import.meta.url).pathname;
const read = (p) => readFileSync(path(p), 'utf8');
const hasGpg = spawnSync('gpg', ['--version']).status === 0;

/** The `key: value` lines of one job (two-space indent under `jobs:`), at the job's own level. */
function job(workflow, name) {
  const lines = read(`.github/workflows/${workflow}`).split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `${workflow} has no job ${name}`);
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(l)) break;
    body.push(l);
  }
  const field = (key, indent = 4) => body.map((l) => new RegExp(`^ {${indent}}${key}: (.*)$`).exec(l)?.[1]).find((v) => v !== undefined);
  return { field, text: body.join('\n') };
}

test('the yum/dnf/zypper repo definition verifies packages and metadata', () => {
  const text = read('packaging/repos/canvas.repo.in');
  assert.match(text, /^gpgcheck=1$/m);
  assert.match(text, /^repo_gpgcheck=1$/m);
  assert.match(text, /^gpgkey=@BASE_URL@\/canvas\.asc$/m);
  assert.match(text, /^baseurl=@BASE_URL@\/rpm\/\$basearch$/m);
});

test('the rpm setup adds the definition the site publishes, not a copy of it', () => {
  const text = read('packaging/repos/setup-rpm.sh');
  assert.match(text, /curl -fsSL "\$base\/canvas\.repo" -o "\$dir\/canvas\.repo"/);
  assert.doesNotMatch(text, /^gpgcheck=/m);
});

test('the apt source is pinned to the repository keyring', () => {
  assert.match(read('packaging/repos/setup-apt.sh'), /\[signed-by=\/etc\/apt\/keyrings\/canvas-archive-keyring\.gpg\] .*\/apt stable main/);
});

test('C-7: nothing under packaging/repos or the repos workflow turns verification off', () => {
  const files = readdirSync(path('packaging/repos')).map((f) => `packaging/repos/${f}`);
  for (const file of [...files, '.github/workflows/repos.yml']) {
    const text = read(file).replace(/grep -rnE '[^']*'/g, '');
    assert.doesNotMatch(text, /trusted=yes|gpgcheck=0|--no-gpg-checks|--nogpgcheck|allow-insecure/, file);
  }
});

function build(env, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'repos-test-'));
  try {
    const clean = { PATH: process.env.PATH, HOME: dir, REPO_BASE_URL: 'http://127.0.0.1:1', ...env };
    mkdirSync(join(dir, 'pkgs'));
    return spawnSync('bash', [path('packaging/repos/build.sh'), join(dir, 'site'), join(dir, 'pkgs'), ...extra], { env: clean, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('build.sh refuses to run without a signing key', () => {
  const r = build({});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /set REPO_GPG_PRIVATE_KEY, or REPO_EPHEMERAL_KEY=1/);
});

test('build.sh refuses to run without the site URL', () => {
  const r = build({ REPO_BASE_URL: '', REPO_EPHEMERAL_KEY: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /REPO_BASE_URL/);
});

test('build.sh refuses a key with another fingerprint', { skip: !hasGpg && 'gpg is not installed' }, () => {
  const zeros = '0'.repeat(40);
  const r = build({ REPO_EPHEMERAL_KEY: '1', REPO_EXPECT_FPR: zeros });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`expected ${zeros}`));
});

test('build.sh refuses an unparsable private key', { skip: !hasGpg && 'gpg is not installed' }, () => {
  const r = build({ REPO_GPG_PRIVATE_KEY: 'not a key' });
  assert.notEqual(r.status, 0);
});

test('the release workflow signs and publishes only for a real tag, and the publish waits for the checked trees', () => {
  const tag = "startsWith(github.ref, 'refs/tags/') && !inputs.dry_run";
  const repos = job('release.yml', 'repos');
  assert.equal(repos.field('uses'), './.github/workflows/repos.yml');
  assert.equal(repos.field('needs'), '[packages, app]');
  assert.equal(repos.field('release', 6), `\${{ ${tag} }}`);
  const publish = job('release.yml', 'repos-publish');
  assert.equal(publish.field('needs'), '[repos, github-release]');
  assert.equal(publish.field('if'), tag);
  assert.match(publish.text, /needs\.repos\.outputs\.base_sha/);
  // One parentless commit, forced only over the commit the trees were built on.
  assert.match(publish.text, /git checkout --orphan/);
  assert.match(publish.text, /git push --force-with-lease="gh-pages:\$base" origin HEAD:gh-pages/);
  assert.doesNotMatch(publish.text, /git push origin/);
  assert.equal(job('ci.yml', 'repos').field('needs'), '[packages, app]');
  assert.equal(job('ci.yml', 'repos').field('uses'), './.github/workflows/repos.yml');
  assert.equal(job('ci.yml', 'repos').field('release', 6), undefined);
});

test('the release run is pinned to the signing key of the rulings', () => {
  assert.match(read('.github/workflows/repos.yml'), /REPO_EXPECT_FPR: .*CBE706A42B7AED6141667D695239F12AF24A7030/);
});

const deb = (name, v, arch = 'amd64') => `apt/pool/main/${name[0]}/${name}/${name}_${v}_${arch}.deb`;
const rpm = (name, v, arch = 'x86_64') => `rpm/${arch}/${name}-${v}-1.${arch}.rpm`;

test('pool file names are parsed, including hyphenated package names', () => {
  assert.deepEqual(parsePackage(deb('canvas-app', '0.4.0')), { name: 'canvas-app', version: '0.4.0', arch: 'amd64', kind: 'deb' });
  assert.deepEqual(parsePackage(rpm('canvas-app', '0.4.0')), { name: 'canvas-app', version: '0.4.0-1', arch: 'x86_64', kind: 'rpm' });
  assert.equal(parsePackage('apt/dists/stable/Release'), null);
});

test('versions compare numerically and a pre-release sorts before its release', () => {
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('0.4.0-1', '0.4.0-1') === 0);
  assert.ok(compareVersions('0.4.0-rc.1', '0.4.0') < 0);
  assert.ok(compareVersions('0.4.0~beta1', '0.4.0') < 0);
  assert.ok(compareVersions('0.4.1', '0.4.0-rc.1') > 0);
});

test('only the newest versions of each package and architecture are kept', () => {
  const versions = ['0.1.0', '0.2.0', '0.10.0', '0.9.0', '0.3.0'];
  const files = [
    ...versions.map((v) => deb('canvas', v)),
    ...versions.map((v) => deb('canvas', v, 'arm64')),
    ...versions.map((v) => rpm('canvas-app', v)),
    deb('canvas-app', '0.1.0'),
  ];
  const gone = stale(files).sort();
  assert.equal(KEEP_VERSIONS, 3);
  assert.deepEqual(gone, [
    deb('canvas', '0.1.0'), deb('canvas', '0.1.0', 'arm64'), deb('canvas', '0.2.0'), deb('canvas', '0.2.0', 'arm64'),
    rpm('canvas-app', '0.1.0'), rpm('canvas-app', '0.2.0'),
  ].sort());
});

test('the check passes when only older versions went, and names a file that went for no reason', () => {
  const before = ['0.1.0', '0.2.0', '0.3.0'].map((v) => deb('canvas', v));
  assert.deepEqual(problems(before, [...before, deb('canvas', '0.4.0')].filter((f) => !f.includes('0.1.0'))), []);
  assert.deepEqual(problems(before, [...before, deb('canvas', '0.4.0')]), [`more than 3 versions kept: ${deb('canvas', '0.1.0')}`]);
  assert.deepEqual(problems(before, before.slice(1)), [`${deb('canvas', '0.1.0')} disappeared`]);
  // A newer file replaced an older one of another package: not an excuse.
  assert.deepEqual(problems(before, [...before.slice(1), deb('canvas-app', '0.4.0')]), [`${deb('canvas', '0.1.0')} disappeared`]);
});

test('the check names an earlier file whose name is not a package name', () => {
  assert.deepEqual(problems(['apt/pool/main/x/odd/odd.deb'], [deb('canvas', '0.1.0')]), ['apt/pool/main/x/odd/odd.deb disappeared']);
});

test('listPool and the CLI prune work on a real tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repos-pool-'));
  try {
    const files = ['0.1.0', '0.2.0', '0.3.0', '0.4.0'].flatMap((v) => [deb('canvas', v), rpm('canvas', v)]);
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), '');
    }
    assert.deepEqual(listPool(dir), [...files].sort());
    const r = spawnSync('node', [path('packaging/repos/retention.mjs'), 'prune', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(listPool(dir), files.filter((f) => !f.includes('0.1.0')).sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
