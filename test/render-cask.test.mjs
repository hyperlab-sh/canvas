import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseSums, renderCask } from '../scripts/render-cask.mjs';

const ARM = 'a'.repeat(64);
const INTEL = 'b'.repeat(64);
const sums = {
  'canvas-app-0.4.0-darwin-arm64.dmg': ARM,
  'canvas-app-0.4.0-darwin-x64.dmg': INTEL,
  'canvas-app-0.4.0-linux-x64.deb': 'c'.repeat(64),
  'canvas-0.4.0-darwin-arm64.tar.gz': 'd'.repeat(64),
};

test('the cask carries the version, one sha256 per architecture and the dmg url', () => {
  const cask = renderCask('0.4.0', sums);
  assert.match(cask, /^cask "canvas-app" do$/m);
  assert.match(cask, /^  version "0\.4\.0"$/m);
  assert.match(cask, new RegExp(`sha256 arm:   "${ARM}",\\n\\s+intel: "${INTEL}"`));
  assert.match(cask, /^  arch arm: "arm64", intel: "x64"$/m);
  assert.match(cask, /^  url "https:\/\/github\.com\/hyperlab-sh\/canvas\/releases\/download\/v0\.4\.0\/canvas-app-#\{version\}-darwin-#\{arch\}\.dmg"$/m);
});

test('the cask depends on the canvas formula and installs Canvas.app', () => {
  const cask = renderCask('0.4.0', sums);
  assert.match(cask, /^  depends_on formula: "hyperlab-sh\/tap\/canvas"$/m);
  assert.match(cask, /^  app "Canvas\.app"$/m);
});

test('the cask is macOS-only', () => {
  assert.match(renderCask('0.4.0', sums), /^  depends_on :macos$/m);
});

test('postflight_steps removes com.apple.quarantine from the installed app (A5)', () => {
  const cask = renderCask('0.4.0', sums);
  assert.match(cask, /^  postflight_steps do\n    run "\/usr\/bin\/xattr", args: \["-dr", "com\.apple\.quarantine", "\{\{appdir\}\}\/Canvas\.app"\]\n  end$/m);
});

test('the deprecated postflight stanza is not used', () => {
  assert.doesNotMatch(renderCask('0.4.0', sums), /^\s*postflight do\b|system_command/m);
});

test('--base replaces the download base', () => {
  const cask = renderCask('0.4.0', sums, 'http://127.0.0.1:8000');
  assert.match(cask, /url "http:\/\/127\.0\.0\.1:8000\/canvas-app-#\{version\}-darwin-#\{arch\}\.dmg"/);
});

test('a missing dmg for either architecture is refused, naming the file', () => {
  const { 'canvas-app-0.4.0-darwin-x64.dmg': _, ...noIntel } = sums;
  assert.throws(() => renderCask('0.4.0', noIntel), /canvas-app-0\.4\.0-darwin-x64\.dmg is not in SHA256SUMS/);
  const { 'canvas-app-0.4.0-darwin-arm64.dmg': __, ...noArm } = sums;
  assert.throws(() => renderCask('0.4.0', noArm), /canvas-app-0\.4\.0-darwin-arm64\.dmg is not in SHA256SUMS/);
});

test('sums of another version do not satisfy the cask', () => {
  assert.throws(() => renderCask('0.5.0', sums), /canvas-app-0\.5\.0-darwin-arm64\.dmg is not in/);
});

test('parseSums reads sha256sum output', () => {
  assert.deepEqual(parseSums(`${ARM}  x.dmg\n${INTEL}  y.dmg\n`), { 'x.dmg': ARM, 'y.dmg': INTEL });
});

test('the command line reads a release directory and --base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-cask-'));
  try {
    writeFileSync(join(dir, 'SHA256SUMS'), Object.entries(sums).map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n');
    const script = new URL('../scripts/render-cask.mjs', import.meta.url).pathname;
    const out = execFileSync(process.execPath, [script, '0.4.0', dir, '--base', 'http://localhost:1'], { encoding: 'utf8' });
    assert.equal(out, renderCask('0.4.0', sums, 'http://localhost:1'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
