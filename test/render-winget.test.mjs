import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderWinget } from '../scripts/render-winget.mjs';

const ZIP = 'ab'.repeat(32);
const MSI = 'cd'.repeat(32);
const sums = {
  'canvas-0.4.0-windows-x64.zip': ZIP,
  'canvas-app-0.4.0-windows-x64.msi': MSI,
  'canvas-app-0.4.0-windows-x64-setup.exe': 'e'.repeat(64),
};
const file = (files, suffix) => Object.entries(files).find(([path]) => path.endsWith(suffix))[1];

test('Hyperlab.Canvas is three files in the winget-pkgs layout', () => {
  const files = renderWinget('canvas', '0.4.0', sums);
  assert.deepEqual(Object.keys(files).sort(), [
    'manifests/h/Hyperlab/Canvas/0.4.0/Hyperlab.Canvas.installer.yaml',
    'manifests/h/Hyperlab/Canvas/0.4.0/Hyperlab.Canvas.locale.en-US.yaml',
    'manifests/h/Hyperlab/Canvas/0.4.0/Hyperlab.Canvas.yaml',
  ]);
});

test('Hyperlab.CanvasApp is three files in the winget-pkgs layout', () => {
  const files = renderWinget('canvas-app', '0.4.0', sums);
  assert.deepEqual(Object.keys(files).sort(), [
    'manifests/h/Hyperlab/CanvasApp/0.4.0/Hyperlab.CanvasApp.installer.yaml',
    'manifests/h/Hyperlab/CanvasApp/0.4.0/Hyperlab.CanvasApp.locale.en-US.yaml',
    'manifests/h/Hyperlab/CanvasApp/0.4.0/Hyperlab.CanvasApp.yaml',
  ]);
});

test('every file names the package, the version and its manifest type', () => {
  for (const [name, id] of [['canvas', 'Hyperlab.Canvas'], ['canvas-app', 'Hyperlab.CanvasApp']]) {
    for (const [path, text] of Object.entries(renderWinget(name, '0.4.0', sums))) {
      assert.match(text, new RegExp(`^PackageIdentifier: ${id.replace('.', '\\.')}$`, 'm'), path);
      assert.match(text, /^PackageVersion: 0\.4\.0$/m, path);
      assert.match(text, /^ManifestVersion: 1\.6\.0$/m, path);
    }
  }
  const files = renderWinget('canvas', '0.4.0', sums);
  assert.match(file(files, '.installer.yaml'), /^ManifestType: installer$/m);
  assert.match(file(files, '.locale.en-US.yaml'), /^ManifestType: defaultLocale$/m);
  assert.match(file(files, 'Canvas.yaml'), /^ManifestType: version$/m);
  assert.match(file(files, 'Canvas.yaml'), /^DefaultLocale: en-US$/m);
});

test('Canvas is the zip as a portable with the canvas command alias', () => {
  const installer = file(renderWinget('canvas', '0.4.0', sums), '.installer.yaml');
  assert.match(installer, /^InstallerType: zip$/m);
  assert.match(installer, /^NestedInstallerType: portable$/m);
  assert.match(installer, /^- RelativeFilePath: bin\\canvas\.exe\n {2}PortableCommandAlias: canvas$/m);
  assert.match(installer, /^ {2}InstallerUrl: https:\/\/github\.com\/hyperlab-sh\/canvas\/releases\/download\/v0\.4\.0\/canvas-0\.4\.0-windows-x64\.zip$/m);
  assert.match(installer, /^- Architecture: x64$/m);
  assert.doesNotMatch(installer, /Dependencies/);
});

test('CanvasApp is the MSI, per machine, and depends on Hyperlab.Canvas', () => {
  const installer = file(renderWinget('canvas-app', '0.4.0', sums), '.installer.yaml');
  assert.match(installer, /^InstallerType: wix$/m);
  assert.match(installer, /^Scope: machine$/m);
  assert.match(installer, /^ {2}InstallerUrl: .*\/v0\.4\.0\/canvas-app-0\.4\.0-windows-x64\.msi$/m);
  assert.match(installer, /^Dependencies:\n {2}PackageDependencies:\n {2}- PackageIdentifier: Hyperlab\.Canvas$/m);
});

test('the sha256 is upper case, as winget prints it', () => {
  assert.match(file(renderWinget('canvas', '0.4.0', sums), '.installer.yaml'), new RegExp(`^ {2}InstallerSha256: ${ZIP.toUpperCase()}$`, 'm'));
  assert.match(file(renderWinget('canvas-app', '0.4.0', sums), '.installer.yaml'), new RegExp(`^ {2}InstallerSha256: ${MSI.toUpperCase()}$`, 'm'));
});

test('the locale file carries publisher, license and a description', () => {
  const locale = file(renderWinget('canvas', '0.4.0', sums), '.locale.en-US.yaml');
  assert.match(locale, /^Publisher: Hyperlab$/m);
  assert.match(locale, /^PackageName: Canvas$/m);
  assert.match(locale, /^License: MIT$/m);
  assert.match(locale, /^ShortDescription: .+$/m);
  assert.match(locale, /^Moniker: canvas$/m);
  assert.match(locale, /^Tags:\n- diagram/m);
});

test('a missing asset is refused, naming the file', () => {
  const { 'canvas-0.4.0-windows-x64.zip': _, ...noZip } = sums;
  assert.throws(() => renderWinget('canvas', '0.4.0', noZip), /canvas-0\.4\.0-windows-x64\.zip is not in SHA256SUMS/);
  const { 'canvas-app-0.4.0-windows-x64.msi': __, ...noMsi } = sums;
  assert.throws(() => renderWinget('canvas-app', '0.4.0', noMsi), /canvas-app-0\.4\.0-windows-x64\.msi is not in SHA256SUMS/);
});

test('sums of another version do not satisfy the manifests', () => {
  assert.throws(() => renderWinget('canvas', '0.5.0', sums), /canvas-0\.5\.0-windows-x64\.zip is not in/);
});

test('an unknown package is refused', () => {
  assert.throws(() => renderWinget('nope', '0.4.0', sums), /unknown package "nope"/);
});

test('the command line writes the files under --out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-winget-'));
  try {
    writeFileSync(join(dir, 'SHA256SUMS'), Object.entries(sums).map(([name, hash]) => `${hash}  ${name}`).join('\n') + '\n');
    const script = new URL('../scripts/render-winget.mjs', import.meta.url).pathname;
    const out = join(dir, 'out');
    execFileSync(process.execPath, [script, 'canvas', '0.4.0', dir, '--out', out], { encoding: 'utf8' });
    for (const [path, text] of Object.entries(renderWinget('canvas', '0.4.0', sums))) {
      assert.equal(existsSync(join(out, path)), true, path);
      assert.equal(readFileSync(join(out, path), 'utf8'), text);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
