import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { versionOutput } from '../lib/launch.js';
import { packageNames, renderConfig } from '../packaging/nfpm/build.mjs';

test('package names follow the distro conventions', () => {
  assert.deepEqual(packageNames('0.4.0', 'x64'), {
    archive: 'canvas-0.4.0-linux-x64.tar.gz',
    deb: 'canvas_0.4.0_amd64.deb',
    rpm: 'canvas-0.4.0-1.x86_64.rpm',
    nfpmArch: 'amd64',
  });
  assert.deepEqual(packageNames('0.4.0', 'arm64'), {
    archive: 'canvas-0.4.0-linux-arm64.tar.gz',
    deb: 'canvas_0.4.0_arm64.deb',
    rpm: 'canvas-0.4.0-1.aarch64.rpm',
    nfpmArch: 'arm64',
  });
});

test('an unknown architecture is refused', () => {
  assert.throws(() => packageNames('0.4.0', 'riscv64'), /unknown architecture/);
  // Archive names only: the deb/rpm spellings are outputs, not inputs.
  assert.throws(() => packageNames('0.4.0', 'amd64'), /unknown architecture/);
});

test('the nfpm config installs under /usr/lib/canvas and links /usr/bin/canvas', () => {
  const config = readFileSync(new URL('../packaging/nfpm/canvas.yaml', import.meta.url), 'utf8');
  assert.match(config, /dst: \/usr\/lib\/canvas\/bin\/canvas/);
  assert.match(config, /src: \/usr\/lib\/canvas\/bin\/canvas\n\s+dst: \/usr\/bin\/canvas\n\s+type: symlink/);
});

test('renderConfig leaves no placeholder and points every source at the extracted archive', () => {
  const config = renderConfig('/stage');
  assert.ok(!config.includes('${CANVAS_STAGE}'));
  const sources = [...config.matchAll(/^\s+(?:- )?src: (\/stage\/.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sources.sort(), ['/stage/LICENSE', '/stage/NOTICE', '/stage/README.md', '/stage/bin/canvas', '/stage/share']);
});

test('the native launcher answers --version with the package version, and only that', () => {
  assert.equal(versionOutput(['--version'], '0.4.0'), 'canvas 0.4.0');
  assert.equal(versionOutput(['--version'], undefined), null);
  assert.equal(versionOutput(['render', '--version'], '0.4.0'), null);
  assert.equal(versionOutput([], '0.4.0'), null);
});

test('nix/release.json is rendered from SHA256SUMS in Nix hash format', async () => {
  const { renderNixRelease, SYSTEMS } = await import('../scripts/render-nix-release.mjs');
  const hex = (n) => n.toString(16).repeat(64).slice(0, 64);
  const sums = Object.values(SYSTEMS).map((t, i) => `${hex(i + 1)}  canvas-1.2.3-${t}.tar.gz`).concat([`${hex(9)}  canvas-1.2.3-windows-x64.zip`]).join('\n');
  const out = JSON.parse(renderNixRelease('1.2.3', `${sums}\n`));
  assert.equal(out.version, '1.2.3');
  assert.deepEqual(Object.keys(out.hashes), ['x86_64-linux', 'aarch64-linux', 'x86_64-darwin', 'aarch64-darwin']);
  assert.equal(out.hashes['x86_64-linux'], `sha256-${Buffer.from(hex(1), 'hex').toString('base64')}`);
  assert.equal(out.hashes['aarch64-darwin'], `sha256-${Buffer.from(hex(4), 'hex').toString('base64')}`);
});

test('a SHA256SUMS missing an archive, or from another version, is refused', async () => {
  const { renderNixRelease } = await import('../scripts/render-nix-release.mjs');
  const line = `${'a'.repeat(64)}  canvas-1.2.3-linux-x64.tar.gz`;
  assert.throws(() => renderNixRelease('1.2.3', line), /canvas-1\.2\.3-linux-arm64\.tar\.gz is not in SHA256SUMS/);
  assert.throws(() => renderNixRelease('9.9.9', line), /canvas-9\.9\.9-linux-x64\.tar\.gz is not in SHA256SUMS/);
});

test('the committed nix/release.json is in the generator\'s canonical format (hashes are checked against the published SHA256SUMS in ci.yml)', async () => {
  const { renderNixRelease, SYSTEMS } = await import('../scripts/render-nix-release.mjs');
  const committed = JSON.parse(readFileSync(new URL('../nix/release.json', import.meta.url), 'utf8'));
  const sums = Object.entries(SYSTEMS).map(([system, t]) => `${Buffer.from(committed.hashes[system].slice(7), 'base64').toString('hex')}  canvas-${committed.version}-${t}.tar.gz`).join('\n');
  assert.equal(renderNixRelease(committed.version, sums), readFileSync(new URL('../nix/release.json', import.meta.url), 'utf8'));
});

test('flake.nix builds exactly the systems the generator hashes', async () => {
  const { SYSTEMS } = await import('../scripts/render-nix-release.mjs');
  const flake = readFileSync(new URL('../flake.nix', import.meta.url), 'utf8');
  const block = flake.match(/targets = \{([^}]*)\}/)[1];
  const targets = Object.fromEntries([...block.matchAll(/([\w-]+) = "([\w-]+)";/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(targets, SYSTEMS);
});

// A cheap guard on the text; docker.yml builds and runs the image, and is the behavioral check.
test('the Docker image runs canvas serve on all interfaces from the linux archive, with projects in a volume', () => {
  const file = readFileSync(new URL('../packaging/docker/Dockerfile', import.meta.url), 'utf8');
  assert.match(file, /^FROM debian:stable-slim$/m);
  assert.match(file, /amd64\) cpu=x64 ;; arm64\) cpu=arm64/);
  assert.match(file, /canvas-\$\{VERSION\}-linux-\$\{cpu\}\.tar\.gz/);
  assert.match(file, /CANVAS_SERVICE_HOST=0\.0\.0\.0/);
  assert.match(file, /CANVAS_SERVICE_CONFIG=\/data\/service\.json/);
  assert.match(file, /^VOLUME \/data$/m);
  assert.match(file, /^USER canvas$/m);
  // The extracted archive lands where the symlink and the entrypoint expect it.
  assert.match(file, /tar -xzf [^\n]+ -C \/canvas/);
  assert.match(file, /COPY --from=archive \/canvas \/usr\/lib\/canvas/);
  assert.match(file, /ln -s \/usr\/lib\/canvas\/bin\/canvas \/usr\/local\/bin\/canvas/);
  assert.match(file, /org\.opencontainers\.image\.source="https:\/\/github\.com\/hyperlab-sh\/canvas"/);
  assert.match(file, /^HEALTHCHECK .*\/health/m);
  assert.match(file, /^ENTRYPOINT \["canvas", "serve"\]$/m);
});
