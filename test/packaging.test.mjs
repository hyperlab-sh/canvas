import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { packageNames } from '../packaging/nfpm/build.mjs';

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
});

test('the nfpm config installs under /usr/lib/canvas and links /usr/bin/canvas', () => {
  const config = readFileSync(new URL('../packaging/nfpm/canvas.yaml', import.meta.url), 'utf8');
  assert.match(config, /dst: \/usr\/lib\/canvas\/bin\/canvas/);
  assert.match(config, /src: \/usr\/lib\/canvas\/bin\/canvas\n\s+dst: \/usr\/bin\/canvas\n\s+type: symlink/);
});
