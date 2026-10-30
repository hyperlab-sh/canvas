import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appInstalled, appUrl, browserCommand, diagramUrl, installHint, linuxManagers, parseOpenArgs, probeResult, resolveTarget, runOpen } from '../lib/open.js';

const BASE = 'http://127.0.0.1:43120';

function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'canvas-open-')));
  const notes = join(root, 'notes');
  const work = join(root, 'work');
  mkdirSync(notes);
  mkdirSync(work);
  writeFileSync(join(notes, 'arch.openflow.json'), JSON.stringify({ id: 'arch-1', name: 'Architecture' }));
  writeFileSync(join(root, 'stray.openflow.json'), JSON.stringify({ id: 'stray' }));
  writeFileSync(join(notes, 'broken.openflow.json'), 'not json');
  writeFileSync(join(notes, 'noid.openflow.json'), '{}');
  const projects = [
    { name: 'notes', path: notes, diagrams: [{ id: 'arch-1', title: 'Architecture' }, { id: 'flow', title: 'Login flow' }] },
    { name: 'work', path: work, diagrams: [{ id: 'flow', title: 'Deploy flow' }, { id: 'a/b', title: 'a/b' }] },
  ];
  return { root, notes, work, projects };
}

describe('parseOpenArgs', () => {
  it('takes one target and --print', () => {
    assert.deepEqual(parseOpenArgs(['x', '--print']), { target: 'x', print: true, help: false, app: false, browser: false });
    assert.deepEqual(parseOpenArgs([]), { target: undefined, print: false, help: false, app: false, browser: false });
    assert.equal(parseOpenArgs(['--app', 'x']).app, true);
    assert.equal(parseOpenArgs(['--browser']).browser, true);
    assert.equal(parseOpenArgs(['-h']).help, true);
  });
  it('rejects a second target and unknown flags', () => {
    assert.match(parseOpenArgs(['a', 'b']).error, /one diagram/);
    assert.match(parseOpenArgs(['--nope']).error, /unknown argument "--nope"/);
  });
  it('--print ignores --app and --browser, as the help says', () => {
    assert.equal(parseOpenArgs(['--app', '--print']).error, undefined);
    assert.equal(parseOpenArgs(['--app', '--browser', '--print']).error, undefined);
  });
  it('rejects --app together with --browser', () => assert.match(parseOpenArgs(['--app', '--browser']).error, /cannot be combined/));
});

describe('diagramUrl', () => {
  it('encodes the project and the id', () => assert.equal(diagramUrl(BASE, 'my proj', 'a/b'), `${BASE}/#/p/my%20proj/a%2Fb`));
});

describe('resolveTarget', () => {
  const { root, notes, projects } = tree();
  it('reads the id from a diagram file inside a project folder', () => {
    assert.deepEqual(resolveTarget(join(notes, 'arch.openflow.json'), projects, '/'), { project: 'notes', id: 'arch-1' });
  });
  it('resolves a relative file against the working directory', () => {
    assert.deepEqual(resolveTarget('arch.openflow.json', projects, notes), { project: 'notes', id: 'arch-1' });
  });
  it('follows a symlinked folder to its project', () => {
    const link = join(root, 'link');
    symlinkSync(notes, link);
    assert.deepEqual(resolveTarget(join(link, 'arch.openflow.json'), projects, '/'), { project: 'notes', id: 'arch-1' });
  });
  it('explains a file outside every project, a missing file, bad JSON and a missing id', () => {
    assert.match(resolveTarget(join(root, 'stray.openflow.json'), projects, '/').error, /not in a project the service knows/);
    assert.match(resolveTarget(join(root, 'gone.openflow.json'), projects, '/').error, /does not exist/);
    assert.match(resolveTarget(join(notes, 'broken.openflow.json'), projects, '/').error, /not a diagram file/);
    assert.match(resolveTarget(join(notes, 'noid.openflow.json'), projects, '/').error, /not a diagram file/);
  });
  it('takes project/id, including an id with a slash', () => {
    assert.deepEqual(resolveTarget('notes/flow', projects, '/'), { project: 'notes', id: 'flow' });
    assert.deepEqual(resolveTarget('work/a/b', projects, '/'), { project: 'work', id: 'a/b' });
  });
  it('finds a unique id or title, ignoring case', () => {
    assert.deepEqual(resolveTarget('arch-1', projects, '/'), { project: 'notes', id: 'arch-1' });
    assert.deepEqual(resolveTarget('LOGIN FLOW', projects, '/'), { project: 'notes', id: 'flow' });
  });
  it('lists the candidates when a name is ambiguous', () => {
    const { error } = resolveTarget('flow', projects, '/');
    assert.match(error, /matches 2 diagrams/);
    assert.match(error, /notes\/flow/);
    assert.match(error, /work\/flow/);
  });
  it('says what exists when nothing matches', () => {
    const { error } = resolveTarget('nope', projects, '/');
    assert.match(error, /No diagram "nope"/);
    assert.match(error, /notes\/arch-1 \(Architecture\)/);
    assert.match(resolveTarget('nope', [{ name: 'p', path: '/p', diagrams: [] }], '/').error, /hold no diagrams/);
  });
});

describe('appUrl', () => {
  it('encodes the project and the id', () => assert.equal(appUrl('my proj', 'a/b'), 'canvas://open/my%20proj/a%2Fb'));
});

describe('appInstalled', () => {
  const answer = (code, stdout = '') => { const seen = []; return { seen, run: (command, args) => { seen.push([command, ...args]); return { code, stdout }; } }; };
  it('asks Spotlight for the bundle id on macOS, without opening anything', () => {
    const a = answer(0, '/Applications/Canvas.app\n');
    assert.equal(appInstalled('darwin', a.run, '/h'), true);
    assert.deepEqual(a.seen, [['mdfind', 'kMDItemCFBundleIdentifier == "sh.hyperlab.canvas"']]);
  });
  it('falls back to the bundle identifier of the app folders on macOS', () => {
    const seen = [];
    const run = (command, args) => { seen.push([command, ...args]); return args[1]?.startsWith('/h/') ? { code: 0, stdout: 'sh.hyperlab.canvas\n' } : { code: 0, stdout: '' }; };
    assert.equal(appInstalled('darwin', run, '/h'), true);
    assert.deepEqual(seen.map((call) => call[0] + ' ' + (call[2] ?? '')), ['mdfind ', 'defaults /Applications/Canvas.app/Contents/Info', 'defaults /h/Applications/Canvas.app/Contents/Info']);
    assert.ok(seen.every(([command]) => command !== 'open'));
    assert.equal(appInstalled('darwin', (command) => ({ code: 0, stdout: command === 'mdfind' ? '' : 'com.other.app\n' }), '/h'), false);
    assert.equal(appInstalled('darwin', answer(1).run, '/h'), false);
  });
  it('wants a non-empty handler from xdg-mime on Linux', () => {
    const a = answer(0, 'canvas-app.desktop\n');
    assert.equal(appInstalled('linux', a.run), true);
    assert.deepEqual(a.seen, [['xdg-mime', 'query', 'default', 'x-scheme-handler/canvas']]);
    assert.equal(appInstalled('linux', answer(0, '\n').run), false);
    assert.equal(appInstalled('linux', answer(1, 'x').run), false);
  });
  it('tries HKCU then HKCR on Windows', () => {
    const seen = [];
    assert.equal(appInstalled('win32', (command, args) => { seen.push(args[1]); return { code: args[1].startsWith('HKCR') ? 0 : 1, stdout: '' }; }), true);
    assert.deepEqual(seen, ['HKCU\\Software\\Classes\\canvas', 'HKCR\\canvas']);
    assert.equal(appInstalled('win32', answer(1).run), false);
  });
  it('counts a probe killed by the timeout (no status) as failed', () => {
    assert.deepEqual(probeResult({ status: null, stdout: null }), { code: 1, stdout: '' });
    assert.deepEqual(probeResult({ status: 0, stdout: 'x' }), { code: 0, stdout: 'x' });
    assert.equal(appInstalled('darwin', () => probeResult({ status: null })), false);
  });
  it('treats a missing probe command as not installed', () => {
    assert.equal(appInstalled('linux', () => { throw new Error('ENOENT'); }), false);
  });
});

describe('browserCommand', () => {
  it('uses the platform opener', () => {
    assert.deepEqual(browserCommand('darwin', 'u'), ['open', ['u']]);
    assert.deepEqual(browserCommand('linux', 'u'), ['xdg-open', ['u']]);
    assert.deepEqual(browserCommand('win32', 'u'), ['rundll32', ['url.dll,FileProtocolHandler', 'u']]);
  });
});

function harness(overrides = {}) {
  const { projects, ...paths } = tree();
  const calls = { fetch: [], opened: [], started: [] };
  const lines = { out: [], err: [] };
  let up = true;
  const ctx = {
    program: ['/bin/canvas'], env: {}, platform: 'darwin', cwd: paths.root, wait: 600,
    fetchImpl: async (url) => {
      calls.fetch.push(url);
      if (url.endsWith('/health')) { if (!up) throw new TypeError('fetch failed'); return { json: async () => ({ service: 'openflowkit-service', pid: 1 }) }; }
      if (url.endsWith('/projects')) return { json: async () => projects };
      throw new Error(`unexpected ${url}`);
    },
    detectApp: () => false,
    opener: async (command, args) => { calls.opened.push([command, ...args]); return true; },
    start: (program, port) => { calls.started.push([program, port]); up = true; },
    out: (text) => lines.out.push(text), err: (text) => lines.err.push(text),
    ...overrides,
  };
  return { calls, lines, paths, setUp: (value) => { up = value; }, run: (args) => runOpen(args, ctx) };
}

describe('installHint and linuxManagers', () => {
  it('lists every Linux command when no manager is known', () => {
    const text = installHint('linux');
    for (const manager of ['apt', 'dnf', 'zypper']) assert.match(text, new RegExp(`sudo ${manager} install canvas-app`));
  });
  it('finds the package managers whose --version succeeds, in README order', () => {
    const seen = [];
    const found = linuxManagers((command, args) => { seen.push([command, ...args]); return { code: command === 'apt' || command === 'zypper' ? 0 : 1, stdout: '' }; });
    assert.deepEqual(found, ['apt', 'zypper']);
    assert.deepEqual(seen, [['apt', '--version'], ['dnf', '--version'], ['zypper', '--version']]);
    assert.deepEqual(linuxManagers(() => { throw new Error('ENOENT'); }), []);
  });
});

describe('installHint and the README', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  it('prints the macOS and Windows commands exactly as the README has them', () => {
    for (const platform of ['darwin', 'win32']) {
      const commands = installHint(platform).split('\n').filter((line) => /^ {2}\S/.test(line)).map((line) => line.trim());
      assert.ok(commands.length > 0);
      for (const command of commands) assert.ok(readme.includes(command), `${command} is not in README.md`);
    }
  });
  it('prints, for each Linux manager, an install line ending in canvas-app that the README also uses', () => {
    for (const manager of ['apt', 'dnf', 'zypper']) {
      const command = installHint('linux', [manager]).split('\n').map((line) => line.trim()).find((line) => line.startsWith(`sudo ${manager} install`));
      assert.ok(command?.endsWith('canvas-app'), command);
      assert.ok(readme.includes(`sudo ${manager} install`), `README has no ${manager} install line`);
    }
  });
});

describe('runOpen', () => {
  it('opens the browser on the editor home without touching the project list', async () => {
    const h = harness();
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/home`]]);
    assert.deepEqual(h.calls.fetch, [`${BASE}/health`]);
  });
  it('opens a diagram by project/id', async () => {
    const h = harness();
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/p/notes/flow`]]);
    assert.deepEqual(h.lines.out, [`${BASE}/#/p/notes/flow`]);
  });
  it('opens a diagram by file path', async () => {
    const h = harness();
    assert.equal(await h.run([join(h.paths.notes, 'arch.openflow.json')]), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/p/notes/arch-1`]]);
  });
  it('--print writes the link and opens nothing', async () => {
    const h = harness();
    assert.equal(await h.run(['notes/flow', '--print']), 0);
    assert.deepEqual(h.calls.opened, []);
    assert.deepEqual(h.lines.out, [`${BASE}/#/p/notes/flow`]);
    const bare = harness();
    assert.equal(await bare.run(['--print']), 0);
    assert.deepEqual(bare.lines.out, [`${BASE}/#/home`]);
    assert.deepEqual(bare.calls.fetch, []);
  });
  it('starts the service when nothing answers, with the port from the URL', async () => {
    const h = harness({ env: { OPENFLOWKIT_SERVICE_URL: 'http://127.0.0.1:43999/' } });
    h.setUp(false);
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.started, [[['/bin/canvas'], '43999']]);
    assert.deepEqual(h.calls.opened, [['open', 'http://127.0.0.1:43999/#/p/notes/flow']]);
  });
  it('does not start a service that already answers', async () => {
    const h = harness();
    await h.run(['notes/flow']);
    assert.deepEqual(h.calls.started, []);
  });
  it('gives up when the service never answers', async () => {
    const h = harness({ start: () => {} });
    h.setUp(false);
    assert.equal(await h.run(['notes/flow']), 1);
    assert.match(h.lines.err.join('\n'), /did not answer/);
    assert.deepEqual(h.calls.opened, []);
  });
  it('names a port held by another program', async () => {
    const h = harness({ fetchImpl: async () => ({ json: async () => { throw new SyntaxError('not json'); } }) });
    assert.equal(await h.run(['notes/flow']), 1);
    assert.match(h.lines.err.join('\n'), /in use by something that is not the canvas service/);
  });
  it('reports a target that does not exist, and a browser that will not start', async () => {
    const h = harness();
    assert.equal(await h.run(['nope']), 1);
    assert.match(h.lines.err.join('\n'), /No diagram "nope"/);
    const blocked = harness({ opener: async () => false });
    assert.equal(await blocked.run(['notes/flow']), 1);
    assert.match(blocked.lines.err.join('\n'), /could not start a browser \(open\)[\s\S]*#\/p\/notes\/flow/);
  });
  it('opens the app by default when it is detected', async () => {
    const h = harness({ detectApp: () => true });
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://open/notes/flow']]);
    assert.deepEqual(h.lines.out, ['canvas://open/notes/flow']);
  });
  it('with no diagram and no flag opens the app on its home when it is installed', async () => {
    const h = harness({ detectApp: () => true });
    h.setUp(false);
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://home']]);
    assert.equal(h.calls.started.length, 1);
  });
  it('with no diagram and no flag opens the browser on /#/home when the app is missing', async () => {
    const h = harness({ detectApp: () => false });
    h.setUp(false);
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/home`]]);
    assert.equal(h.calls.started.length, 1);
  });
  it('with no diagram, --browser does not probe for the app', async () => {
    let probed = false;
    const h = harness({ detectApp: () => { probed = true; return true; } });
    assert.equal(await h.run(['--browser']), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/home`]]);
    assert.equal(probed, false);
  });
  it('with no diagram, an app that fails to start falls back to the browser home', async () => {
    const h = harness({ detectApp: () => true, opener: async (command, args) => { h.calls.opened.push([command, ...args]); return args[0] !== 'canvas://home'; } });
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://home'], ['open', `${BASE}/#/home`]]);
  });
  it('--app without a diagram opens the app on its home page', async () => {
    const h = harness({ detectApp: () => true });
    assert.equal(await h.run(['--app']), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://home']]);
    assert.deepEqual(h.calls.fetch, [`${BASE}/health`]);
    assert.equal(await h.run(['--app', '--help']), 0);
  });
  it('--app without a diagram starts the service first', async () => {
    const h = harness({ detectApp: () => true });
    h.setUp(false);
    assert.equal(await h.run(['--app']), 0);
    assert.equal(h.calls.started.length, 1);
  });
  it('--app without a diagram and without the app prints the install hint and opens nothing', async () => {
    const h = harness({ detectApp: () => false });
    assert.equal(await h.run(['--app']), 1);
    assert.match(h.lines.err.join('\n'), /desktop app is not installed[\s\S]*brew install --cask hyperlab-sh\/tap\/canvas-app/);
    assert.deepEqual(h.calls.opened, []);
    assert.deepEqual(h.calls.started, []);
  });
  it('opens the browser when the app is not detected', async () => {
    const h = harness({ detectApp: () => false });
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/p/notes/flow`]]);
  });
  it('--app without the app is an error and opens nothing', async () => {
    const h = harness({ detectApp: () => false });
    assert.equal(await h.run(['notes/flow', '--app']), 1);
    assert.match(h.lines.err.join('\n'), /desktop app is not installed/);
    assert.deepEqual(h.calls.opened, []);
  });
  for (const [platform, managers, expected, absent] of [
    ['darwin', [], ['brew install --cask hyperlab-sh/tap/canvas-app'], ['apt', 'scoop']],
    ['win32', [], ['scoop bucket add hyperlab https://github.com/hyperlab-sh/homebrew-tap', 'scoop install canvas-app'], ['brew install', 'apt install']],
    ['linux', ['apt'], ['sudo apt install canvas-app'], ['dnf install', 'zypper install', 'brew']],
    ['linux', ['dnf'], ['sudo dnf install canvas-app'], ['apt install', 'zypper install']],
    ['linux', ['zypper'], ['sudo zypper install canvas-app'], ['apt install', 'dnf install']],
    ['linux', [], ['sudo apt install canvas-app', 'sudo dnf install canvas-app', 'sudo zypper install canvas-app'], ['brew', 'scoop']],
  ]) {
    it(`--app without the app on ${platform}${managers.length ? ` with ${managers[0]}` : ' with no package manager'} prints that platform's command`, async () => {
      const h = harness({ platform, detectApp: () => false, detectManagers: platform === 'linux' ? () => managers : () => { throw new Error('not on this platform'); } });
      for (const args of [['--app'], ['notes/flow', '--app']]) {
        h.lines.err.length = 0;
        assert.equal(await h.run(args), 1);
        const text = h.lines.err.join('\n');
        for (const command of expected) assert.ok(text.includes(command), `${command} in ${text}`);
        for (const other of absent) assert.ok(!text.includes(other), `${other} not in ${text}`);
        assert.ok(text.includes('https://github.com/hyperlab-sh/canvas/releases'));
        assert.equal(text.includes('https://github.com/hyperlab-sh/canvas#linux'), platform === 'linux');
      }
      assert.deepEqual(h.calls.opened, []);
    });
  }
  it('uses the browser without probing when the service is not at the default URL', async () => {
    let probed = false;
    const h = harness({ env: { OPENFLOWKIT_SERVICE_URL: 'http://127.0.0.1:43999' }, detectApp: () => { probed = true; return true; } });
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', 'http://127.0.0.1:43999/#/p/notes/flow']]);
    assert.equal(probed, false);
  });
  it('--app with a service at another URL is an error and opens nothing', async () => {
    const h = harness({ env: { OPENFLOWKIT_SERVICE_URL: 'http://127.0.0.1:43999' }, detectApp: () => true });
    assert.equal(await h.run(['notes/flow', '--app']), 1);
    assert.match(h.lines.err.join('\n'), /only reaches the service at 127\.0\.0\.1:43120[\s\S]*--browser/);
    assert.deepEqual(h.calls.opened, []);
  });
  it('--app without a diagram and a service at another URL is the reachability error, not the install hint', async () => {
    const h = harness({ env: { OPENFLOWKIT_SERVICE_URL: 'http://127.0.0.1:43999' }, detectApp: () => false });
    assert.equal(await h.run(['--app']), 1);
    const text = h.lines.err.join('\n');
    assert.match(text, /only reaches the service at 127\.0\.0\.1:43120/);
    assert.ok(!text.includes('not installed'), text);
    assert.deepEqual(h.calls.opened, []);
  });
  it('--app opens the app when it is installed', async () => {
    const h = harness({ detectApp: () => true });
    assert.equal(await h.run(['--app', 'notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://open/notes/flow']]);
  });
  it('--browser opens http even when the app is installed, without probing', async () => {
    let probed = false;
    const h = harness({ detectApp: () => { probed = true; return true; } });
    assert.equal(await h.run(['notes/flow', '--browser']), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/#/p/notes/flow`]]);
    assert.equal(probed, false);
  });
  it('--app with --browser is a usage error', async () => {
    const h = harness({ detectApp: () => true });
    assert.equal(await h.run(['--app', '--browser']), 2);
    assert.match(h.lines.err.join('\n'), /cannot be combined/);
    assert.deepEqual(h.calls.opened, []);
  });
  it('--print still writes the http link when the app is installed', async () => {
    const h = harness({ detectApp: () => true });
    assert.equal(await h.run(['notes/flow', '--print']), 0);
    assert.deepEqual(h.lines.out, [`${BASE}/#/p/notes/flow`]);
    assert.deepEqual(h.calls.opened, []);
  });
  it('--print ignores --app even when the app is missing', async () => {
    const h = harness({ detectApp: () => false });
    assert.equal(await h.run(['notes/flow', '--app', '--print']), 0);
    assert.deepEqual(h.lines.out, [`${BASE}/#/p/notes/flow`]);
    assert.deepEqual(h.calls.opened, []);
  });
  it('names the app when it will not start', async () => {
    const h = harness({ detectApp: () => true, opener: async () => false });
    assert.equal(await h.run(['notes/flow']), 1);
    assert.match(h.lines.err.join('\n'), /could not start the app[\s\S]*canvas:\/\/open\/notes\/flow[\s\S]*#\/p\/notes\/flow/);
  });
  it('falls back to the browser when a detected app will not start', async () => {
    const h = harness({ detectApp: () => true, opener: async (command, args) => { h.calls.opened.push([command, ...args]); return !args[0].startsWith('canvas://'); } });
    assert.equal(await h.run(['notes/flow']), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://open/notes/flow'], ['open', `${BASE}/#/p/notes/flow`]]);
    assert.deepEqual(h.lines.out, [`${BASE}/#/p/notes/flow`]);
  });
  it('does not fall back when --app was forced', async () => {
    const h = harness({ detectApp: () => true, opener: async (command, args) => { h.calls.opened.push([command, ...args]); return !args[0].startsWith('canvas://'); } });
    assert.equal(await h.run(['notes/flow', '--app']), 1);
    assert.equal(h.calls.opened.length, 1);
  });
  it('prints usage for a bad argument and for --help', async () => {
    const h = harness();
    assert.equal(await h.run(['--bogus']), 2);
    assert.match(h.lines.err.join('\n'), /canvas open \[diagram\]/);
    assert.equal(await h.run(['--help']), 0);
    assert.match(h.lines.out.join('\n'), /Open a diagram/);
  });
});
