// Runs the OpenFlowKit CLI (server/dist/cli.js) as a child of the canvas launcher, named `canvas`, pointed at the shipped app.
// cli.js runs its commands only when it is the entry script (isMain), so it is spawned rather than imported.
import { spawn } from 'node:child_process';
import { OPEN_USAGE } from './open.js';
import { SERVICE_USAGE } from './service.js';

/**
 * `command` is the runtime to start, with any flags of its own; `cli` the script it runs; `env` is added to the child's.
 * Returns the child so callers can wait on it; the process exits with the child's code.
 */
export function runCli({ args, command, cli, appDir, env = {} }) {
  const child = spawn(command[0], [...command.slice(1), cli, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENFLOWKIT_APP_DIR: process.env.OPENFLOWKIT_APP_DIR ?? appDir,
      OPENFLOWKIT_CLI_NAME: process.env.OPENFLOWKIT_CLI_NAME ?? 'canvas',
      ...env,
    },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => {
    // The top-level help lists the CLI's own commands; `open` and `service` are this package's, so it is added after them.
    if (code === 0 && (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])))) console.log(`\n${OPEN_USAGE}\n\n${SERVICE_USAGE}`);
    process.exit(code ?? (signal ? 128 : 1));
  });
  return child;
}

/** What `canvas --version` prints for the standalone binary: the package version embedded at bundle time, not the bundled CLI's own. */
export function versionOutput(args, version) {
  return args.length === 1 && args[0] === '--version' && version ? `canvas ${version}` : null;
}
