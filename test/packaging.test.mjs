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
