import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const names = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].map((target) => `canvas-0.4.0-${target}.tar.gz`);

function render() {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-formula-'));
  try {
    writeFileSync(join(dir, 'SHA256SUMS'), names.map((name, index) => `${String(index).repeat(64)}  ${name}\n`).join(''));
    return execFileSync(process.execPath, ['scripts/render-formula.mjs', '0.4.0', dir], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the caveats tell brew users the desktop app is a separate cask', () => {
  const formula = render();
  const caveats = formula.slice(formula.indexOf('def caveats'), formula.indexOf('  test do'));
  assert.ok(caveats.includes('brew install --cask hyperlab-sh/tap/canvas-app'));
  assert.match(caveats, /canvas service install/);
});

test('the cask line is shown on macOS only, because the cask is macOS-only', () => {
  const formula = render();
  const caveats = formula.slice(formula.indexOf('def caveats'), formula.indexOf('  test do'));
  assert.match(caveats, /app = OS\.mac\? \? "[^"\n]*brew install --cask hyperlab-sh\/tap\/canvas-app[^"\n]*" : ""\n\s+app \+ <<~EOS/);
  assert.ok(!caveats.slice(caveats.indexOf('<<~EOS')).includes('--cask'), 'the cask command must not be in the unconditional heredoc');
});

test('the formula still carries a url and sha256 per platform', () => {
  assert.equal(render().match(/sha256 "/g).length, 4);
});
