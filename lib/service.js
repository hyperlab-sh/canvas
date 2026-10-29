// `canvas service`: keep `canvas serve` running in the background as a launchd agent (macOS) or a systemd user unit (Linux).
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform as osPlatform, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export const LABEL = 'sh.hyperlab.canvas';
export const UNIT = 'canvas.service';
export const DEFAULT_PORT = 43120;

export const SERVICE_USAGE = `Run the service in the background:
  canvas service install [--port N] [--config path] [--runtime node|bun|path]
                                                      start it now and at every login
  canvas service status                               is it installed, running, answering
  canvas service restart
  canvas service logs [-f]
  canvas service uninstall

  macOS installs a launchd agent (${LABEL}), Linux a systemd user unit (${UNIT}).`;

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The arguments after `serve` for this install: only what was asked for, the rest stays the service's own default. */
const serveArgs = ({ port, config }) => ['serve', ...(port ? ['--port', String(port)] : []), ...(config ? ['--config', config] : [])];

export function launchdPlist({ program, port, config, logFile }) {
  const args = [...program, ...serveArgs({ port, config })].map((arg) => `    <string>${xml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

/** systemd splits ExecStart on spaces unless quoted, and treats `%` and `$` specially. */
const quote = (arg) => `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

export function systemdUnit({ program, port, config }) {
  const exec = [...program, ...serveArgs({ port, config })].map(quote).join(' ');
  return `[Unit]
Description=canvas: local diagram service for agents
After=network.target

[Service]
ExecStart=${exec}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

/** A Homebrew Cellar path changes with every version and is deleted on upgrade; `opt/<formula>` is the stable link to the current one. */
export function stableExecutable(exe, exists = existsSync) {
  const match = /^(.*)[\\/]Cellar[\\/]([^\\/]+)[\\/][^\\/]+[\\/](.+)$/.exec(exe);
  if (!match) return exe;
  const stable = join(match[1], 'opt', match[2], match[3]);
  return exists(stable) ? stable : exe;
}

/** `--runtime node|bun` is looked up on PATH; anything else must be a path to an executable. */
export function resolveRuntime(value, env = process.env) {
  const executable = (file) => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } };
  if (/[\\/]/.test(value)) { const file = resolve(value); return executable(file) ? file : null; }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, value);
    if (executable(candidate)) return candidate;
  }
  return null;
}

/** An npx or bunx cache entry is deleted later, so a service pointing into it would break; only a lasting install qualifies. */
export function ephemeralReason(script) {
  const real = (() => { try { return realpathSync(script); } catch { return script; } })();
  if (/[\\/](_npx|bunx-[^\\/]*)[\\/]/.test(real)) return 'it runs from an npx/bunx cache';
  const temps = [tmpdir(), realpathSync(tmpdir())];
  if (temps.some((dir) => real.startsWith(dir + '/')) || real.startsWith('/private/var/folders/')) return 'it runs from a temporary directory';
  return null;
}

export function parseServiceArgs(args) {
  const [action = 'status', ...rest] = args;
  const out = { action, port: undefined, config: undefined, runtime: undefined, follow: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '-f' || flag === '--follow') { out.follow = true; continue; }
    if (flag !== '--port' && flag !== '--config' && flag !== '--runtime') return { error: `unknown argument "${flag}"` };
    const value = rest[i + 1];
    if (value === undefined) return { error: `${flag} needs a value` };
    i += 1;
    if (flag === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: `--port must be 1-65535, not "${value}"` };
      out.port = port;
    } else if (flag === '--runtime') out.runtime = value;
    else out.config = resolve(value);
  }
  if (!['install', 'uninstall', 'status', 'restart', 'logs'].includes(action)) return { error: `unknown action "${action}"` };
  if ((out.port || out.config || out.runtime) && action !== 'install') return { error: '--port, --config and --runtime belong to install' };
  if (out.follow && action !== 'logs') return { error: '-f belongs to logs' };
  return out;
}

const defaultExec = (command, args, { inherit = false } = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const defaultProbe = async (port) => {
  try { return (await fetch(`http://127.0.0.1:${port}/projects`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};

/**
 * Runs one `canvas service` action and returns the exit code. Everything it touches is injectable so the tests
 * drive it against a temp home with a recording `exec`.
 */
export async function runService(args, ctx) {
  const {
    script, program: fixedProgram, runtime = process.execPath, platform = osPlatform(), home = homedir(), env = process.env,
    uid = process.getuid?.(), exec = defaultExec, probe = defaultProbe,
    out = (text) => process.stdout.write(`${text}\n`), err = (text) => process.stderr.write(`${text}\n`),
  } = ctx;
  const parsed = parseServiceArgs(args);
  if (parsed.error) { err(`canvas service: ${parsed.error}\n\n${SERVICE_USAGE}`); return 2; }
  if (platform !== 'darwin' && platform !== 'linux') { err(`canvas service: ${platform} is not supported; run \`canvas serve\` yourself.`); return 1; }

  const mac = platform === 'darwin';
  const unitFile = mac ? join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`) : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', UNIT);
  const logFile = join(home, 'Library', 'Logs', 'canvas', 'canvas.log');
  const domain = `gui/${uid}`;
  const portOf = () => {
    if (!existsSync(unitFile)) return DEFAULT_PORT;
    const text = readFileSync(unitFile, 'utf8');
    return Number(/--port<\/string>\s*<string>(\d+)|--port" "(\d+)"/.exec(text)?.slice(1).find(Boolean)) || DEFAULT_PORT;
  };
  const control = (...argv) => (mac ? exec('launchctl', argv) : exec('systemctl', ['--user', ...argv]));

  if (parsed.action === 'install') {
    if (fixedProgram && parsed.runtime) { err('canvas service install: --runtime does not apply here, the standalone binary carries its own runtime.'); return 1; }
    const pinned = parsed.runtime ? resolveRuntime(parsed.runtime, env) : runtime;
    if (!pinned) { err(`canvas service install: --runtime ${parsed.runtime} is not an executable on PATH or at that path.`); return 1; }
    const program = fixedProgram ?? [pinned, script];
    const why = ephemeralReason(program.at(-1));
    if (why) { err(`canvas service install: ${why}, and a service pointing there would stop working.\nInstall canvas first (\`brew install hyperlab-sh/tap/canvas\`, the install script, \`npm i -g @hyperlab.sh/canvas\` or \`bun add -g @hyperlab.sh/canvas\`), then run \`canvas service install\`.`); return 1; }
    const port = parsed.port ?? DEFAULT_PORT;
    const running = await probe(port);
    mkdirSync(dirname(unitFile), { recursive: true });
    if (mac) {
      mkdirSync(dirname(logFile), { recursive: true });
      writeFileSync(unitFile, launchdPlist({ program, port: parsed.port, config: parsed.config, logFile }));
      control('bootout', `${domain}/${LABEL}`);
      const started = control('bootstrap', domain, unitFile);
      if (started.status !== 0) { err(`canvas service install: launchctl bootstrap failed: ${started.stderr.trim() || started.stdout.trim()}`); return 1; }
    } else {
      writeFileSync(unitFile, systemdUnit({ program, port: parsed.port, config: parsed.config }));
      control('daemon-reload');
      const started = control('enable', '--now', UNIT);
      if (started.status !== 0) { err(`canvas service install: systemctl failed: ${started.stderr.trim() || started.stdout.trim()}`); return 1; }
    }
    out(`installed ${unitFile}`);
    if (running) out(`Note: something already answers on port ${port} (an agent or a hand-started \`canvas serve\`). It keeps running; the installed service takes over once it exits or at the next login.`);
    else out(`canvas is running on http://127.0.0.1:${port} and starts at every login.`);
    if (!mac) {
      const linger = exec('loginctl', ['show-user', env.USER ?? '', '-p', 'Linger']).stdout;
      if (!/Linger=yes/.test(linger)) out('To keep it running while you are logged out: sudo loginctl enable-linger $USER');
    }
    if (fixedProgram) out(`Binary: ${program[0]} (it carries its own runtime). Upgrading it in place keeps the service pointing at it.`);
    else out(`Runtime: ${pinned}. If you move or remove it (a version manager upgrade), run \`canvas service install\` again, or pin another with --runtime.`);
    return 0;
  }

  if (parsed.action === 'uninstall') {
    if (!existsSync(unitFile)) { out('canvas service is not installed.'); return 0; }
    if (mac) control('bootout', `${domain}/${LABEL}`);
    else { control('disable', '--now', UNIT); }
    rmSync(unitFile, { force: true });
    if (!mac) control('daemon-reload');
    out(`removed ${unitFile}`);
    return 0;
  }

  if (!existsSync(unitFile)) { out('canvas service is not installed. Run `canvas service install`.'); return parsed.action === 'status' ? 0 : 1; }

  if (parsed.action === 'restart') {
    const result = mac ? control('kickstart', '-k', `${domain}/${LABEL}`) : control('restart', UNIT);
    if (result.status !== 0) { err(`canvas service restart failed: ${result.stderr.trim() || result.stdout.trim()}`); return 1; }
    out('restarted');
    return 0;
  }

  if (parsed.action === 'logs') {
    if (mac) return exec('tail', ['-n', '100', ...(parsed.follow ? ['-f'] : []), logFile], { inherit: true }).status;
    return exec('journalctl', ['--user', '-u', UNIT, '-n', '100', ...(parsed.follow ? ['-f'] : [])], { inherit: true }).status;
  }

  // status
  const listing = mac ? control('print', `${domain}/${LABEL}`) : control('is-active', UNIT);
  const state = mac ? /state = (\w+)/.exec(listing.stdout)?.[1] ?? 'not loaded' : listing.stdout.trim() || 'inactive';
  const port = portOf();
  out(`unit:    ${unitFile}`);
  out(`manager: ${state}`);
  out(`url:     http://127.0.0.1:${port} (${(await probe(port)) ? 'answering' : 'not answering'})`);
  return 0;
}
