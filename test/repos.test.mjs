import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the yum/dnf/zypper repo definition verifies packages and metadata', () => {
  for (const text of [read('packaging/repos/canvas.repo.in'), read('packaging/repos/setup-rpm.sh')]) {
    assert.match(text, /^gpgcheck=1$/m);
    assert.match(text, /^repo_gpgcheck=1$/m);
    assert.match(text, /^gpgkey=.*\/canvas\.asc$/m);
    assert.match(text, /^baseurl=.*\/rpm\/\\?\$basearch$/m);
  }
});

test('the apt source is pinned to the repository keyring', () => {
  const text = read('packaging/repos/setup-apt.sh');
  assert.match(text, /\[signed-by=\/etc\/apt\/keyrings\/canvas-archive-keyring\.gpg\] .*\/apt stable main/);
});

test('C-7: nothing under packaging/repos or the repos workflow turns verification off', () => {
  const files = readdirSync(new URL('../packaging/repos/', import.meta.url)).map((f) => `packaging/repos/${f}`);
  for (const file of [...files, '.github/workflows/repos.yml']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/grep -rnE '[^']*'/g, ''), /trusted=yes|gpgcheck=0|--no-gpg-checks|--nogpgcheck|allow-insecure/, file);
  }
});

test('the build script refuses to run without a signing key and signs the metadata', () => {
  const text = read('packaging/repos/build.sh');
  assert.match(text, /set REPO_GPG_PRIVATE_KEY, or REPO_EPHEMERAL_KEY=1/);
  assert.match(text, /--clearsign/);
  assert.match(text, /--detach-sign.*Release\.gpg/);
  assert.match(text, /repomd\.xml\.asc/);
  assert.match(text, /rpmsign .*--addsign/);
});

test('the release publishes the repos artifact only for a real tag, with the release key and fingerprint', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /repos:\n\s+needs: \[packages, app\]\n\s+uses: \.\/\.github\/workflows\/repos\.yml\n\s+with:\n\s+release: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/'\) && !inputs\.dry_run \}\}/);
  assert.match(release, /repos-publish:\n\s+needs: \[repos, github-release\]\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\) && !inputs\.dry_run/);
  assert.match(read('.github/workflows/repos.yml'), /CBE706A42B7AED6141667D695239F12AF24A7030/);
  assert.match(read('.github/workflows/ci.yml'), /repos:\n\s+needs: \[packages, app\]\n\s+uses: \.\/\.github\/workflows\/repos\.yml\n/);
});
