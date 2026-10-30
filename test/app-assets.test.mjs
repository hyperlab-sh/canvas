import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assetName, bundleExt, collect, dependsConfig, diffAssets, expectedAssets, mergeSums } from '../scripts/app-assets.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'app-assets-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test('asset names follow canvas-app-<v>-<os>-<cpu>.<ext>', () => {
  assert.equal(assetName('0.4.0', 'darwin-arm64', 'dmg'), 'canvas-app-0.4.0-darwin-arm64.dmg');
  assert.equal(assetName('0.4.0', 'windows-x64', 'msi'), 'canvas-app-0.4.0-windows-x64.msi');
  assert.equal(assetName('0.4.0', 'windows-x64', '-setup.exe'), 'canvas-app-0.4.0-windows-x64-setup.exe');
  assert.equal(assetName('0.4.0', 'linux-arm64', 'AppImage'), 'canvas-app-0.4.0-linux-arm64.AppImage');
});

test('a bundle a target does not ship is refused', () => {
  assert.throws(() => assetName('0.4.0', 'darwin-x64', 'deb'), /no deb bundle for darwin-x64/);
  assert.throws(() => assetName('0.4.0', 'windows-arm64', 'msi'), /no msi bundle/);
});

test('the full list is the ten bundles of AC-6', () => {
  const list = expectedAssets('1.2.3');
  assert.equal(list.length, 10);
  assert.deepEqual(list, [...list].sort());
  assert.ok(list.includes('canvas-app-1.2.3-linux-x64.rpm'));
  assert.ok(list.includes('canvas-app-1.2.3-darwin-x64.dmg'));
});

test('bundleExt recognises bundles only', () => {
  assert.equal(bundleExt('Canvas_0.4.0_x64-setup.exe'), '-setup.exe');
  assert.equal(bundleExt('Canvas_0.4.0_amd64.AppImage'), 'AppImage');
  assert.equal(bundleExt('Canvas-0.4.0-1.x86_64.rpm'), 'rpm');
  assert.equal(bundleExt('canvas-app.exe'), null);
  assert.equal(bundleExt('Canvas.app.tar.gz'), null);
  assert.equal(bundleExt('Canvas_0.4.0_amd64.AppImage.sig'), null);
});

test('collect renames the Tauri outputs and ignores everything else', () => {
  const root = tree({
    'deb/Canvas_0.4.0_amd64.deb': 'deb',
    'rpm/Canvas-0.4.0-1.x86_64.rpm': 'rpm',
    'appimage/Canvas_0.4.0_amd64.AppImage': 'img',
    'appimage/Canvas.AppDir/usr/bin/canvas-app': 'bin',
    'macos/Canvas.app/Contents/Resources/ignored.deb': 'inside an .app',
  });
  const out = join(root, 'out');
  try {
    assert.deepEqual(collect(root, 'linux-x64', out, '0.4.0'), [
      'canvas-app-0.4.0-linux-x64.AppImage',
      'canvas-app-0.4.0-linux-x64.deb',
      'canvas-app-0.4.0-linux-x64.rpm',
    ]);
    assert.equal(readFileSync(join(out, 'canvas-app-0.4.0-linux-x64.deb'), 'utf8'), 'deb');
    assert.equal(readdirSync(out).length, 3);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('collect fails on a missing or an ambiguous bundle', () => {
  const root = tree({ 'dmg/a.dmg': '1', 'dmg2/b.dmg': '2' });
  try {
    assert.throws(() => collect(root, 'darwin-arm64', join(root, 'out'), '0.4.0'), /expected one dmg bundle.*found 2/);
    assert.throws(() => collect(root, 'windows-x64', join(root, 'out'), '0.4.0'), /expected one msi bundle.*found 0/);
    assert.throws(() => collect(root, 'plan9-x64', join(root, 'out'), '0.4.0'), /unknown target/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('diffAssets reports what is missing and what is stray, leaving the CLI assets alone', () => {
  const all = expectedAssets('0.4.0');
  assert.deepEqual(diffAssets([...all, 'canvas-0.4.0-linux-x64.tar.gz', 'SHA256SUMS'], '0.4.0'), { missing: [], unexpected: [] });
  const partial = all.filter((name) => !name.endsWith('.msi'));
  assert.deepEqual(diffAssets([...partial, 'canvas-app-0.3.0-linux-x64.deb'], '0.4.0'), {
    missing: ['canvas-app-0.4.0-windows-x64.msi'],
    unexpected: ['canvas-app-0.3.0-linux-x64.deb'],
  });
});

test('mergeSums appends the app digests and replaces a repeated name', () => {
  const root = tree({ 'canvas-app-0.4.0-linux-x64.deb': 'one', 'canvas-app-0.4.0-linux-x64.rpm': 'two' });
  try {
    const digest = (text) => createHash('sha256').update(text).digest('hex');
    const existing = `${digest('cli')}  canvas-0.4.0-linux-x64.tar.gz\n${'0'.repeat(64)}  canvas-app-0.4.0-linux-x64.deb\n`;
    const merged = mergeSums(existing, root, ['canvas-app-0.4.0-linux-x64.deb', 'canvas-app-0.4.0-linux-x64.rpm']);
    assert.equal(
      merged,
      `${digest('cli')}  canvas-0.4.0-linux-x64.tar.gz\n${digest('one')}  canvas-app-0.4.0-linux-x64.deb\n${digest('two')}  canvas-app-0.4.0-linux-x64.rpm\n`,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('the app packages depend on the CLI package at the same version or newer', () => {
  assert.deepEqual(dependsConfig('0.4.0'), {
    bundle: { linux: { deb: { depends: ['canvas (>= 0.4.0)'] }, rpm: { depends: ['canvas >= 0.4.0'] } } },
  });
});
