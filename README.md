# @hyperlab.sh/canvas

[![CI](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@hyperlab.sh/canvas)](https://www.npmjs.com/package/@hyperlab.sh/canvas) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A local diagram service for coding agents. An agent draws a diagram, you open a link and see it on a canvas, you
comment on it, and the agent answers. Diagrams are plain `.openflow.json` files in folders you choose.

It packages a build of the [hyperlab-sh/openflowkit](https://github.com/hyperlab-sh/openflowkit) fork (a fork of
[OpenFlowKit](https://github.com/openflowkit/openflowkit)): the canvas editor, a local service that keeps the files
and serves the editor, and an MCP server agents draw through.

- [Quick start](#quick-start)
- [Run it in the background](#run-it-in-the-background)
- [Projects and configuration](#projects-and-configuration)
- [Connect an agent](#connect-an-agent)
- [Command reference](#command-reference)
- [Building and releasing](#building-and-releasing)

Needs Node 20.11 or newer. Linux and macOS; the background service is not supported on Windows.

## Quick start

```sh
npx @hyperlab.sh/canvas serve        # or: bunx @hyperlab.sh/canvas serve
```

Open http://127.0.0.1:43120. The service listens on the loopback address only and refuses requests from other hosts and
other websites.

For daily use install it once, so that `canvas` is a command and the background service can find it:

```sh
npm i -g @hyperlab.sh/canvas         # or: bun add -g @hyperlab.sh/canvas
canvas serve
```

## Run it in the background

`canvas service` keeps the service running without a terminal, and starts it at every login: a launchd agent on macOS,
a systemd user unit on Linux. It never needs root.

```sh
canvas service install               # start now and at every login
canvas service status                # installed? running? answering?
canvas service restart               # after editing the config file
canvas service logs -f               # follow the log
canvas service uninstall             # stop and remove it
```

Options for `install`: `--port <n>` (default 43120) and `--config <path>` (a service config file, see
[below](#projects-and-configuration)). Run `install` again to change them.

| | macOS | Linux |
|---|---|---|
| Unit file | `~/Library/LaunchAgents/sh.hyperlab.canvas.plist` | `~/.config/systemd/user/canvas.service` |
| Logs | `~/Library/Logs/canvas/canvas.log` | `journalctl --user -u canvas` |
| Restarts | after a crash or a kill, not after a clean exit | `Restart=on-failure`, 3 s apart |

Things to know:

- **Install from a lasting location.** `canvas service install` refuses to run from an `npx`/`bunx` cache or a
  temporary directory, because the service would point into something that gets deleted. Install the package globally
  first.
- **The service pins the paths of Node and of the package** from the moment you run `install`. After a Node upgrade
  that removes the old Node (version managers do this), or after moving the package, run `canvas service install`
  again. `canvas service status` shows `not answering` when that happened.
- **Linux, logged out.** A systemd user unit stops when your last session ends. To keep it running, run
  `sudo loginctl enable-linger $USER` once; `install` tells you when this applies.
- **Something already on the port.** An agent's MCP server starts the service itself when nothing answers, and
  you may have started `canvas serve` by hand. Then the installed service finds the port taken, exits without error and
  is not restarted; the running copy keeps working and the installed one takes over after the next login.
  `install` says when this is the case.

## Projects and configuration

A project is a name mapped to a folder, and a diagram is one `.openflow.json` file in it. The service reads
`~/.config/openflowkit/service.json`, written on first run with one project, `scratch`, in
`~/.local/share/openflowkit/diagrams`:

```json
{
  "port": 43120,
  "projects": [
    { "name": "scratch", "path": "/Users/you/.local/share/openflowkit/diagrams" },
    { "name": "my-app", "path": "/Users/you/code/my-app/diagrams" }
  ]
}
```

Names are lowercase letters, digits, `.`, `_` and `-`; paths are absolute, existing folders. Edit the file and run
`canvas service restart` (or restart `canvas serve`) to add a project. Files you add or change by hand show up without a
restart. Keeping a project's folder in a repository puts its diagrams under version control.

Each diagram has a link, `http://127.0.0.1:43120/#/p/<project>/<diagram>`. The home page lists the projects and their
diagrams.

| Variable | Used by | Meaning |
|---|---|---|
| `OPENFLOWKIT_SERVICE_CONFIG` | `canvas serve` | Config file path (same as `--config`). |
| `OPENFLOWKIT_APP_DIR` | `canvas serve` | The built editor to serve. Defaults to the one in this package. |
| `OPENFLOWKIT_SERVICE_URL` | the MCP server | Where to find the service if you changed the port, e.g. `http://127.0.0.1:43200`. |
| `OPENFLOWKIT_CHANNEL` | the MCP server | Set to `1` if your agent session was started with channels, so canvas comments reach the agent as they are written. |
| `OPENFLOWKIT_CLI_NAME` | the CLI | The command name shown in help and errors. Defaults to `canvas` here. |

## Connect an agent

```sh
claude mcp add -s user canvas -- canvas mcp
# without a global install:
claude mcp add -s user canvas -- bunx @hyperlab.sh/canvas mcp
```

Any MCP client works with the command `canvas mcp` (stdio). When no service answers, the MCP server starts one itself,
detached; with [the background service](#run-it-in-the-background) installed it is always there.

An agent binds to a diagram with `connect_diagram` or by creating one with `create_diagram` (name a `project`). One
session holds a diagram at a time: a held diagram is refused and the error names the holder, and you release it
with Disconnect on the canvas. Comments you write on the canvas go to the session that holds the diagram.

The `paint-a-picture` skill in [`skills/`](skills/paint-a-picture/SKILL.md) teaches an agent the whole flow. This repo is
also a Claude Code plugin (`.claude-plugin/plugin.json`).

## Command reference

`canvas --help` lists everything. The ones you will use:

| Command | What it does |
|---|---|
| `canvas serve [--port N] [--config path] [--app dir]` | Run the service and the editor in the foreground. |
| `canvas service <install\|status\|restart\|logs\|uninstall>` | Run it in the background. |
| `canvas mcp` | The MCP server on stdio, for agents. |
| `canvas render <file> -o out.svg` | Mermaid, D2, Structurizr or OpenFlow DSL to SVG. |
| `canvas validate <file>` / `canvas convert <file>` | Check a diagram source / turn it into an editable `.openflow.json`. |
| `canvas discover <dir>` / `canvas drift <dir>` | Propose a C4 model of a repository / report drift from it. |

## Building and releasing

The editor and server come from the `openflowkit` submodule, pinned to a commit of the fork's `main`.

```sh
git clone --recurse-submodules https://github.com/hyperlab-sh/canvas.git
cd canvas
npm run build          # builds the submodule, assembles server/ and app/
npm test               # the service-installer tests
node bin/canvas.js serve
```

To take a newer fork: `git -C openflowkit fetch origin && git -C openflowkit checkout origin/main`, then commit the new
pointer. Release by bumping `version` in `package.json`, committing, and pushing the tag `vX.Y.Z`: the Release workflow
builds and publishes through npm trusted publishing (the repo and `release.yml` are registered as the trusted
publisher on npmjs.com, so no token is stored) and attaches provenance. The very first publish was manual.

Inside this repo `npx @hyperlab.sh/canvas` finds the local package and fails; use `node bin/canvas.js` or run npx from
another directory.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Editor and service changes belong in the fork.

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
