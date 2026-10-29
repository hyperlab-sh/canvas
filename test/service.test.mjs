import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_PORT, LABEL, UNIT, ephemeralReason, launchdPlist, parseServiceArgs, runService, systemdUnit } from '../lib/service.js';

const SCRIPT = '/opt/lib/node_modules/@hyperlab.sh/canvas/bin/canvas.js';

function harness(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'canvas-svc-'));
  const calls = [];
  const lines = { out: [], err: [] };
  const ctx = {
    script: SCRIPT, node: '/usr/local/bin/node', home, uid: 501, env: { USER: 'me' },
    exec: (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: '', stderr: '' }; },
    probe: async () => false,
    out: (text) => lines.out.push(text), err: (text) => lines.err.push(text),
    ...overrides,
  };
  return { home, calls, lines, ctx, run: (args) => runService(args, ctx) };
}

describe('launchdPlist', () => {
  it('runs node, the script and serve, restarting only after a failure', () => {
    const plist = launchdPlist({ node: '/n/node', script: SCRIPT, logFile: '/l/canvas.log' });
    assert.match(plist, /<string>\/n\/node<\/string>\s*<string>\/opt\/lib[^<]*canvas\.js<\/string>\s*<string>serve<\/string>\s*<\/array>/);
    assert.doesNotMatch(plist, /--port|--config/);
    assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  });
  it('passes the port and config and escapes XML', () => {
    const plist = launchdPlist({ node: '/n/node', script: '/a&b/<x>/canvas.js', port: 43999, config: '/c/svc.json', logFile: '/l' });
    assert.match(plist, /<string>--port<\/string>\s*<string>43999<\/string>\s*<string>--config<\/string>\s*<string>\/c\/svc\.json<\/string>/);
    assert.match(plist, /\/a&amp;b\/&lt;x&gt;\/canvas\.js/);
  });
});

describe('systemdUnit', () => {
  it('quotes every argument and escapes % and $', () => {
    const unit = systemdUnit({ node: '/my node/node', script: '/p/100%/$HOME/canvas.js', port: 43999 });
    assert.match(unit, /^ExecStart="\/my node\/node" "\/p\/100%%\/\$\$HOME\/canvas\.js" "serve" "--port" "43999"$/m);
    assert.match(unit, /^Restart=on-failure$/m);
    assert.match(unit, /^WantedBy=default\.target$/m);
  });
});

describe('ephemeralReason', () => {
  it('refuses npx and bunx caches and temp directories', () => {
    assert.ok(ephemeralReason('/Users/x/.npm/_npx/abc123/node_modules/@hyperlab.sh/canvas/bin/canvas.js'));
    assert.ok(ephemeralReason('/private/var/folders/yk/T/bunx-501-@hyperlab.sh/canvas@latest/node_modules/@hyperlab.sh/canvas/bin/canvas.js'));
    assert.ok(ephemeralReason(join(tmpdir(), 'x', 'canvas.js')));
  });
  it('accepts a global install', () => {
    assert.equal(ephemeralReason(SCRIPT), null);
    assert.equal(ephemeralReason('/Users/x/.bun/install/global/node_modules/@hyperlab.sh/canvas/bin/canvas.js'), null);
  });
});

describe('parseServiceArgs', () => {
  it('defaults to status', () => assert.equal(parseServiceArgs([]).action, 'status'));
  it('reads install flags', () => {
    const parsed = parseServiceArgs(['install', '--port', '43999', '--config', 'svc.json']);
    assert.equal(parsed.port, 43999);
    assert.match(parsed.config, /svc\.json$/);
  });
  it('rejects bad input', () => {
    for (const bad of [['nope'], ['install', '--port', 'x'], ['install', '--port', '0'], ['install', '--port', '70000'], ['install', '--port'], ['install', '--wat'], ['status', '--port', '1'], ['status', '-f']]) {
      assert.ok(parseServiceArgs(bad).error, bad.join(' '));
    }
  });
  it('accepts logs -f', () => assert.equal(parseServiceArgs(['logs', '-f']).follow, true));
});

describe('runService on macOS', () => {
  const mac = { platform: 'darwin' };

  it('installs: writes the plist, reloads and starts it', async () => {
    const h = harness(mac);
    assert.equal(await h.run(['install', '--port', '43999']), 0);
    const plist = join(h.home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    assert.match(readFileSync(plist, 'utf8'), /43999/);
    assert.deepEqual(h.calls, [['launchctl', 'bootout', `gui/501/${LABEL}`], ['launchctl', 'bootstrap', 'gui/501', plist]]);
    assert.match(h.lines.out.join('\n'), /running on http:\/\/127\.0\.0\.1:43999/);
  });

  it('says so when the port already answers', async () => {
    const h = harness({ ...mac, probe: async () => true });
    assert.equal(await h.run(['install']), 0);
    assert.match(h.lines.out.join('\n'), /already answers on port 43120/);
  });

  it('fails when launchctl bootstrap fails', async () => {
    const h = harness({ ...mac, exec: (command, args) => (args[0] === 'bootstrap' ? { status: 5, stdout: '', stderr: 'Bootstrap failed' } : { status: 0, stdout: '', stderr: '' }) });
    assert.equal(await h.run(['install']), 1);
    assert.match(h.lines.err.join('\n'), /Bootstrap failed/);
  });

  it('refuses to install from an npx cache and writes nothing', async () => {
    const h = harness({ ...mac, script: '/Users/x/.npm/_npx/abc/node_modules/@hyperlab.sh/canvas/bin/canvas.js' });
    assert.equal(await h.run(['install']), 1);
    assert.match(h.lines.err.join('\n'), /npm i -g/);
    assert.deepEqual(h.calls, []);
    assert.equal(existsSync(join(h.home, 'Library')), false);
  });

  it('uninstalls: boots out and removes the plist; a second time is a no-op', async () => {
    const h = harness(mac);
    await h.run(['install']);
    h.calls.length = 0;
    assert.equal(await h.run(['uninstall']), 0);
    assert.deepEqual(h.calls, [['launchctl', 'bootout', `gui/501/${LABEL}`]]);
    assert.equal(existsSync(join(h.home, 'Library', 'LaunchAgents', `${LABEL}.plist`)), false);
    assert.equal(await h.run(['uninstall']), 0);
    assert.match(h.lines.out.at(-1), /not installed/);
  });

  it('status reports the manager state and whether the port answers, from the installed port', async () => {
    const ports = [];
    const h = harness({
      ...mac,
      probe: async (port) => { ports.push(port); return true; },
      exec: (command, args) => ({ status: 0, stdout: args[0] === 'print' ? 'state = running\n' : '', stderr: '' }),
    });
    await h.run(['install', '--port', '43999']);
    ports.length = 0;
    assert.equal(await h.run(['status']), 0);
    assert.deepEqual(ports, [43999]);
    const text = h.lines.out.join('\n');
    assert.match(text, /manager: running/);
    assert.match(text, /answering/);
  });

  it('status and restart before install', async () => {
    const h = harness(mac);
    assert.equal(await h.run(['status']), 0);
    assert.match(h.lines.out.at(-1), /not installed/);
    assert.equal(await h.run(['restart']), 1);
    assert.deepEqual(h.calls, []);
  });

  it('restart kicks the agent', async () => {
    const h = harness(mac);
    await h.run(['install']);
    h.calls.length = 0;
    assert.equal(await h.run(['restart']), 0);
    assert.deepEqual(h.calls, [['launchctl', 'kickstart', '-k', `gui/501/${LABEL}`]]);
  });

  it('logs tails the log file', async () => {
    const h = harness(mac);
    await h.run(['install']);
    h.calls.length = 0;
    await h.run(['logs', '-f']);
    assert.deepEqual(h.calls, [['tail', '-n', '100', '-f', join(h.home, 'Library', 'Logs', 'canvas', 'canvas.log')]]);
  });
});

describe('runService on Linux', () => {
  const linux = { platform: 'linux' };

  it('installs a user unit, enables it and mentions linger', async () => {
    const h = harness(linux);
    assert.equal(await h.run(['install']), 0);
    const unit = join(h.home, '.config', 'systemd', 'user', UNIT);
    assert.match(readFileSync(unit, 'utf8'), /^ExecStart=/m);
    assert.deepEqual(h.calls.slice(0, 2), [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', UNIT]]);
    assert.match(h.lines.out.join('\n'), /enable-linger/);
  });

  it('stays quiet about linger when it is already on', async () => {
    const h = harness({ ...linux, exec: (command, args) => ({ status: 0, stdout: command === 'loginctl' ? 'Linger=yes\n' : '', stderr: '' }) });
    await h.run(['install']);
    assert.doesNotMatch(h.lines.out.join('\n'), /enable-linger/);
  });

  it('honours XDG_CONFIG_HOME', async () => {
    const h = harness(linux);
    h.ctx.env = { USER: 'me', XDG_CONFIG_HOME: join(h.home, 'xdg') };
    await h.run(['install']);
    assert.ok(existsSync(join(h.home, 'xdg', 'systemd', 'user', UNIT)));
  });

  it('uninstalls, restarts and reads logs through systemd', async () => {
    const h = harness(linux);
    await h.run(['install']);
    h.calls.length = 0;
    await h.run(['restart']);
    await h.run(['logs']);
    await h.run(['uninstall']);
    assert.deepEqual(h.calls, [
      ['systemctl', '--user', 'restart', UNIT],
      ['journalctl', '--user', '-u', UNIT, '-n', '100'],
      ['systemctl', '--user', 'disable', '--now', UNIT],
      ['systemctl', '--user', 'daemon-reload'],
    ]);
    assert.equal(existsSync(join(h.home, '.config', 'systemd', 'user', UNIT)), false);
  });

  it('status reads the port from the unit', async () => {
    const ports = [];
    const h = harness({ ...linux, probe: async (port) => { ports.push(port); return false; }, exec: () => ({ status: 0, stdout: 'active\n', stderr: '' }) });
    await h.run(['install', '--port', '43999']);
    ports.length = 0;
    await h.run(['status']);
    assert.deepEqual(ports, [43999]);
    assert.match(h.lines.out.join('\n'), /manager: active[\s\S]*not answering/);
  });
});

describe('runService elsewhere', () => {
  it('is unsupported on Windows', async () => {
    const h = harness({ platform: 'win32' });
    assert.equal(await h.run(['install']), 1);
    assert.match(h.lines.err.join('\n'), /not supported/);
  });
  it('prints usage for a bad action', async () => {
    const h = harness({ platform: 'darwin' });
    assert.equal(await h.run(['frobnicate']), 2);
    assert.match(h.lines.err.join('\n'), /canvas service install/);
  });
  it('defaults to the documented port', () => assert.equal(DEFAULT_PORT, 43120));
});
