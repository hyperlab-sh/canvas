// `canvas open [diagram]`: shows a diagram in the desktop app when installed, else the browser, starting the service first when nothing answers.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { dirname, resolve } from 'node:path';

export const DEFAULT_URL = 'http://127.0.0.1:43120';
const SUFFIX = '.openflow.json';
const START_WAIT_MS = 10_000;
const PROBE_TIMEOUT_MS = 3000;

export const OPEN_USAGE = `Open a diagram:
  canvas open [diagram] [--app | --browser] [--print]
  Opens in the desktop app when it is installed, in your browser otherwise; starts the service when it is not running.
  diagram: a .openflow.json file, project/id, or a diagram id or title. Without one the home page opens.
  --app      use the desktop app; fails when it is not installed
  --browser  use the browser even when the app is installed
  --print    writes the http link instead of opening it; it ignores --app and --browser.`;

export function parseOpenArgs(args) {
  const out = { target: undefined, print: false, help: false, app: false, browser: false };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--print') out.print = true;
    else if (arg === '--app') out.app = true;
    else if (arg === '--browser') out.browser = true;
    else if (arg.startsWith('--')) return { error: `unknown argument "${arg}"` };
    else if (out.target !== undefined) return { error: 'open takes one diagram' };
    else out.target = arg;
  }
  if (out.app && out.browser) return { error: '--app and --browser cannot be combined' };
  return out;
}

/** The link the editor routes: `/#/p/<project>/<id>`. */
export const diagramUrl = (base, project, id) => `${base}/#/p/${encodeURIComponent(project)}/${encodeURIComponent(id)}`;

const describe = (project, diagram) => `${project}/${diagram.id}${diagram.title && diagram.title !== diagram.id ? ` (${diagram.title})` : ''}`;

/**
 * Finds the diagram a target names among the service's projects (`[{name, path, diagrams: [{id, title}]}]`).
 * Returns `{project, id}` or `{error}`. `fs` is injectable for the tests.
 */
export function resolveTarget(target, projects, cwd, fs = { stat: statSync, read: readFileSync, real: realpathSync }) {
  const file = resolve(cwd, target);
  const isFile = (() => { try { return fs.stat(file).isFile(); } catch { return false; } })();
  if (isFile || target.endsWith(SUFFIX)) {
    if (!isFile) return { error: `${file} does not exist.` };
    let id;
    try { id = JSON.parse(fs.read(file, 'utf8')).id; } catch { /* reported below */ }
    if (typeof id !== 'string' || !id) return { error: `${file} is not a diagram file (no "id").` };
    const folder = fs.real(dirname(file));
    const owner = projects.find((project) => { try { return fs.real(project.path) === folder; } catch { return false; } });
    if (!owner) return { error: `${file} is not in a project the service knows. Add its folder to "projects" in ~/.config/openflowkit/service.json and run \`canvas service restart\`.` };
    return { project: owner.name, id };
  }

  const slash = target.indexOf('/');
  if (slash > 0) {
    const project = projects.find((candidate) => candidate.name === target.slice(0, slash));
    const diagram = project?.diagrams.find((candidate) => candidate.id === target.slice(slash + 1));
    if (project && diagram) return { project: project.name, id: diagram.id };
  }

  const all = projects.flatMap((project) => project.diagrams.map((diagram) => ({ project: project.name, diagram })));
  const byId = all.filter(({ diagram }) => diagram.id === target);
  const wanted = target.toLowerCase();
  const matches = byId.length ? byId : all.filter(({ diagram }) => diagram.title?.toLowerCase() === wanted);
  if (matches.length === 1) return { project: matches[0].project, id: matches[0].diagram.id };
  if (matches.length > 1) return { error: `"${target}" matches ${matches.length} diagrams; name one:\n${matches.map(({ project, diagram }) => `  ${project}/${diagram.id}`).join('\n')}` };
  const known = all.slice(0, 10).map(({ project, diagram }) => `  ${describe(project, diagram)}`).join('\n');
  return { error: `No diagram "${target}" in the service's projects.${known ? `\nKnown diagrams:\n${known}${all.length > 10 ? '\n  …' : ''}` : '\nThe projects hold no diagrams yet.'}` };
}

/** What starts the platform's default browser on a URL. */
export function browserCommand(platform, url) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

/** The desktop app's deep link: `canvas://open/<project>/<id>`, or `canvas://open/` for the home page. */
export const appUrl = (project, id) => (project === undefined ? 'canvas://open/' : `canvas://open/${encodeURIComponent(project)}/${encodeURIComponent(id)}`);

/** What asks the OS whether something handles `canvas://`; `ok(result)` reads the answer. */
function appProbe(platform) {
  if (platform === 'darwin') return { command: 'open', args: ['-Ra', 'Canvas'], ok: ({ code }) => code === 0 };
  if (platform === 'win32') return { command: 'reg', args: ['query', 'HKCU\\Software\\Classes\\canvas'], fallback: ['query', 'HKCR\\canvas'], ok: ({ code }) => code === 0 };
  return { command: 'xdg-mime', args: ['query', 'default', 'x-scheme-handler/canvas'], ok: ({ code, stdout }) => code === 0 && stdout.trim() !== '' };
}

/** A finished probe as `{code, stdout}`; a probe killed by the timeout has no status and counts as failed. */
export const probeResult = (result) => ({ code: result.status ?? 1, stdout: result.stdout ?? '' });

const defaultRun = (command, args) => probeResult(spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: PROBE_TIMEOUT_MS, windowsHide: true }));

/** Whether a `canvas://` handler is registered on this OS. `run(command, args)` returns `{code, stdout}`; injectable. */
export function appInstalled(platform, run = defaultRun) {
  const probe = appProbe(platform);
  const attempts = [probe.args, ...(probe.fallback ? [probe.fallback] : [])];
  return attempts.some((args) => { try { return probe.ok(run(probe.command, args)); } catch { return false; } });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const defaultOpener = (command, args) => new Promise((done) => {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.once('error', () => done(false));
  child.once('exit', (code) => done(code === 0));
  child.unref();
});

/** `serve` detached, as the MCP server starts it; the service outlives this command. */
const defaultStart = (program, port) => {
  const child = spawn(program[0], [...program.slice(1), 'serve', '--port', port], { detached: true, stdio: 'ignore' });
  child.once('error', () => {});
  child.unref();
};

/**
 * Runs `canvas open` and returns the exit code. `program` is how to start this CLI (the binary, or runtime + script);
 * everything else is injectable so the tests need neither a service nor a browser.
 */
export async function runOpen(args, ctx) {
  const {
    program, env = process.env, platform = osPlatform(), cwd = process.cwd(),
    fetchImpl = fetch, opener = defaultOpener, detectApp = (os) => appInstalled(os), start = defaultStart, wait = START_WAIT_MS, fs,
    out = (text) => process.stdout.write(`${text}\n`), err = (text) => process.stderr.write(`${text}\n`),
  } = ctx;
  const parsed = parseOpenArgs(args);
  if (parsed.error) { err(`canvas open: ${parsed.error}\n\n${OPEN_USAGE}`); return 2; }
  if (parsed.help) { out(OPEN_USAGE); return 0; }
  const base = (env.OPENFLOWKIT_SERVICE_URL ?? DEFAULT_URL).replace(/\/+$/, '');
  const port = new URL(base).port || '80';

  const health = async () => {
    try {
      const body = await (await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(2000) })).json();
      return body?.service === 'openflowkit-service' ? 'up' : 'foreign';
    } catch (error) { return error instanceof SyntaxError ? 'foreign' : 'down'; }
  };
  const ensureService = async () => {
    let state = await health();
    if (state === 'down') {
      start(program, port);
      for (const deadline = Date.now() + wait; state === 'down' && Date.now() < deadline; await sleep(250)) state = await health();
    }
    if (state === 'foreign') return `Port ${port} is in use by something that is not the canvas service. Free it, or set OPENFLOWKIT_SERVICE_URL to where the service runs.`;
    if (state === 'down') return `The service did not answer on ${base}. Run \`canvas serve\` to see why.`;
    return null;
  };

  let useApp = false;
  if (!parsed.browser && !parsed.print) {
    useApp = detectApp(platform);
    if (parsed.app && !useApp) { err('canvas open: the Canvas desktop app is not installed (no handler for canvas:// is registered). Install it, or use --browser.'); return 1; }
  }

  let url = `${base}/`;
  let project;
  let id;
  if (parsed.target !== undefined) {
    const problem = await ensureService();
    if (problem) { err(`canvas open: ${problem}`); return 1; }
    let projects;
    try { projects = await (await fetchImpl(`${base}/projects`, { signal: AbortSignal.timeout(5000) })).json(); } catch (error) { err(`canvas open: could not list the projects (${error.message}).`); return 1; }
    const found = resolveTarget(parsed.target, projects, cwd, fs);
    if (found.error) { err(`canvas open: ${found.error}`); return 1; }
    ({ project, id } = found);
    url = diagramUrl(base, project, id);
  }

  if (parsed.print) { out(url); return 0; }
  if (parsed.target === undefined) {
    const problem = await ensureService();
    if (problem) { err(`canvas open: ${problem}`); return 1; }
  }
  const target = useApp ? appUrl(project, id) : url;
  const [command, commandArgs] = browserCommand(platform, target);
  if (!(await opener(command, commandArgs))) { err(`canvas open: could not start ${useApp ? 'the app' : 'a browser'} (${command}). Open it yourself:\n${target}`); return 1; }
  out(target);
  return 0;
}
