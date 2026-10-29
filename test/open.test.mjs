import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appInstalled, appUrl, browserCommand, diagramUrl, parseOpenArgs, resolveTarget, runOpen } from '../lib/open.js';

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
    assert.equal(parseOpenArgs(['--app']).app, true);
    assert.equal(parseOpenArgs(['--browser']).browser, true);
    assert.equal(parseOpenArgs(['-h']).help, true);
  });
  it('rejects a second target and unknown flags', () => {
    assert.match(parseOpenArgs(['a', 'b']).error, /one diagram/);
    assert.match(parseOpenArgs(['--nope']).error, /unknown argument "--nope"/);
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
  it('encodes the project and the id, and falls back to the bare host', () => {
    assert.equal(appUrl('my proj', 'a/b'), 'canvas://open/my%20proj/a%2Fb');
    assert.equal(appUrl(undefined, undefined), 'canvas://open/');
  });
});

describe('appInstalled', () => {
  const answer = (code, stdout = '') => { const seen = []; return { seen, run: (command, args) => { seen.push([command, ...args]); return { code, stdout }; } }; };
  it('asks LaunchServices on macOS', () => {
    const a = answer(0);
    assert.equal(appInstalled('darwin', a.run), true);
    assert.deepEqual(a.seen, [['open', '-Ra', 'Canvas']]);
    assert.equal(appInstalled('darwin', answer(1).run), false);
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

describe('runOpen', () => {
  it('opens the home page without touching the project list', async () => {
    const h = harness();
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', `${BASE}/`]]);
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
    assert.deepEqual(bare.lines.out, [`${BASE}/`]);
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
  it('opens the app on the bare host when there is no diagram, still starting the service', async () => {
    const h = harness({ detectApp: () => true });
    h.setUp(false);
    assert.equal(await h.run([]), 0);
    assert.deepEqual(h.calls.opened, [['open', 'canvas://open/']]);
    assert.equal(h.calls.started.length, 1);
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
  it('names the app when it will not start', async () => {
    const h = harness({ detectApp: () => true, opener: async () => false });
    assert.equal(await h.run(['notes/flow']), 1);
    assert.match(h.lines.err.join('\n'), /could not start the app[\s\S]*canvas:\/\/open\/notes\/flow/);
  });
  it('prints usage for a bad argument and for --help', async () => {
    const h = harness();
    assert.equal(await h.run(['--bogus']), 2);
    assert.match(h.lines.err.join('\n'), /canvas open \[diagram\]/);
    assert.equal(await h.run(['--help']), 0);
    assert.match(h.lines.out.join('\n'), /Open a diagram/);
  });
});
