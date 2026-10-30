# @hyperlab.sh/canvas

[![CI](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@hyperlab.sh/canvas)](https://www.npmjs.com/package/@hyperlab.sh/canvas) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A local diagram service for coding agents. An agent draws a diagram, you open a link and see it on a canvas, you
comment on it, and the agent answers. Diagrams are plain `.openflow.json` files in folders you choose.

It packages a build of the [hyperlab-sh/openflowkit](https://github.com/hyperlab-sh/openflowkit) fork (a fork of
[OpenFlowKit](https://github.com/openflowkit/openflowkit)): the canvas editor, a local service that keeps the files
and serves the editor, and an MCP server agents draw through.

- [Install](#install)
- [Quick start](#quick-start)
- [Run it in the background](#run-it-in-the-background)
- [Projects and configuration](#projects-and-configuration)
- [Connect an agent](#connect-an-agent)
- [Command reference](#command-reference)
- [Building and releasing](#building-and-releasing)

## Install

Pick one. The first three are a standalone binary that carries its own runtime: no Node or bun needed, and nothing
else on your machine decides which runtime runs the service.

| | Command | Platforms |
|---|---|---|
| Homebrew | `brew install hyperlab-sh/tap/canvas` | macOS, Linux |
| Homebrew cask (desktop app) | `brew install --cask hyperlab-sh/tap/canvas-app` | macOS |
| Install script | `curl -fsSL https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.sh \| sh` | macOS, Linux (x64, arm64; not Alpine/musl) |
| PowerShell | `irm https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.ps1 \| iex` | Windows x64 |
| npm | `npm i -g @hyperlab.sh/canvas` | needs Node 20.11 or newer |
| bun | `bun add -g @hyperlab.sh/canvas` | installs with bun, but **runs on Node** (see below) |

The install script puts the program in `~/.local/share/canvas` and links `~/.local/bin/canvas` (override with
`CANVAS_HOME` and `CANVAS_BIN_DIR`; pick a version with `--version 0.3.0`). Run it again to upgrade, and
`sh install.sh --uninstall` to remove it. It checks the download against the release's `SHA256SUMS`. `brew upgrade canvas`
upgrades the Homebrew copy.

**The npm package runs on Node, whichever tool installed it.** The `canvas` command starts with `#!/usr/bin/env node`,
and bun, like npm, runs installed commands through that line. If you installed with bun and have no Node, use one of the
standalone options instead. To run it on bun anyway, use `bun --bun canvas serve`, and for the background service
`canvas service install --runtime bun`.

## Quick start

```sh
canvas serve                         # after any install above
npx @hyperlab.sh/canvas serve        # or without installing: bunx @hyperlab.sh/canvas serve
```

Open http://127.0.0.1:43120. The service listens on the loopback address only and refuses requests from other hosts and
other websites.

`bunx` caches what it resolves for `latest`, so after a release it can keep running the old version. Name the version (`bunx @hyperlab.sh/canvas@0.3.0 serve`) or clear it with `bun pm cache rm`; `npx` does not do this.

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

Options for `install`: `--port <n>` (default 43120), `--config <path>` (a service config file, see
[below](#projects-and-configuration)) and, for the npm package only, `--runtime node|bun|<path>` (which runtime the
service runs on; default the one running `canvas`). Run `install` again to change them.

| | macOS | Linux |
|---|---|---|
| Unit file | `~/Library/LaunchAgents/sh.hyperlab.canvas.plist` | `~/.config/systemd/user/canvas.service` |
| Logs | `~/Library/Logs/canvas/canvas.log` | `journalctl --user -u canvas` |
| Restarts | after a crash or a kill, not after a clean exit | `Restart=on-failure`, 3 s apart |

Things to know:

- **Install from a lasting location.** `canvas service install` refuses to run from an `npx`/`bunx` cache or a
  temporary directory, because the service would point into something that gets deleted. Install canvas first.
- **The service pins what it runs** from the moment you run `install`, and `install` prints it. With the standalone
  binary that is the binary itself: the install script replaces it in place and Homebrew's stable `opt` path follows
  `brew upgrade`, so upgrades need nothing. With the npm package it is the runtime and the package path: after a Node
  upgrade that removes the old Node (version managers do this), or after moving the package, run
  `canvas service install` again. `canvas service status` shows `not answering` when that happened.
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
| `canvas open [diagram] [--app\|--browser] [--print]` | Open a diagram in the desktop app when it is installed, in your browser otherwise, starting the service if needed. The app is detected without launching it (the bundle id `sh.hyperlab.canvas` through Spotlight or the Applications folders on macOS, the `canvas://` handler elsewhere). `--app` requires the app and a diagram, and exits 1 if the app is missing or cannot start; only an auto-detected app falls back to the browser when it fails to start (on Windows a failed app start is not detected). The app only reaches the service at `127.0.0.1:43120`, so with another `OPENFLOWKIT_SERVICE_URL` the browser is used and `--app` is an error. `--browser` insists on the browser. `diagram` is a `.openflow.json` file in a project folder, `project/id`, or a diagram id or title; with none the home page opens in the browser. `--print` writes the http link instead. |
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
pointer. Release by bumping `version` in `package.json`, committing, and pushing the tag `vX.Y.Z`. The Release workflow
then:

1. builds the standalone binaries for macOS, Linux and Windows (`scripts/package-native.mjs`, needs bun) and attaches
   them, with `SHA256SUMS`, to a GitHub release;
2. renders the Homebrew formula and the `canvas-app` cask (`scripts/render-formula.mjs`, `scripts/render-cask.mjs`) and pushes them to `hyperlab-sh/homebrew-tap` when the
   `HOMEBREW_TAP_DEPLOY_KEY` secret (a write deploy key on the tap) is set;
3. publishes the npm package through npm trusted publishing (the repo and `release.yml` are registered as the trusted
   publisher on npmjs.com, so no token is stored) with provenance.

To build the binary for your own machine: `npm run build && bun scripts/package-native.mjs`, which writes the archive
and `SHA256SUMS` to `release/`. The binary is bun plus `bin/canvas-native.js`; it starts itself as bun
(`BUN_BE_BUN=1`) to run the CLI bundled in `share/canvas`.

Inside this repo `npx @hyperlab.sh/canvas` finds the local package and fails; use `node bin/canvas.js` or run npx from
another directory.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Editor and service changes belong in the fork.

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
