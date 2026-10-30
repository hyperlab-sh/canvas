# @hyperlab.sh/canvas

[![CI](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@hyperlab.sh/canvas)](https://www.npmjs.com/package/@hyperlab.sh/canvas) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A local diagram service for coding agents. An agent draws a diagram, you open a link and see it on a canvas, you
comment on it, and the agent answers. Diagrams are plain `.openflow.json` files in folders you choose.

It packages a build of the [hyperlab-sh/openflowkit](https://github.com/hyperlab-sh/openflowkit) fork (a fork of
[OpenFlowKit](https://github.com/openflowkit/openflowkit)): the canvas editor, a local service that keeps the files
and serves the editor, and an MCP server agents draw through.

- [Install](#install)
- [Desktop app](#desktop-app)
- [Quick start](#quick-start)
- [Run it in the background](#run-it-in-the-background)
- [Projects and configuration](#projects-and-configuration)
- [Connect an agent](#connect-an-agent)
- [Command reference](#command-reference)
- [Building and releasing](#building-and-releasing)

## Install

Two things ship: **`canvas`**, the CLI and background service (with the MCP server), and **`canvas-app`**, a desktop
window onto that service ([below](#desktop-app)). The app does not contain the service: install `canvas` too, except
with Homebrew, Scoop and the `.deb`/`.rpm`, which pull it in. Every channel below is built by the release workflow and
installs the same version.

The standalone channels (Homebrew, the apt/dnf repositories, `.deb`/`.rpm`, install scripts, Scoop, winget, Nix,
Docker) carry their own runtime: no Node or bun needed, and nothing else on your machine decides which runtime runs
the service. Only npm and bun use yours.

### macOS

```sh
brew install hyperlab-sh/tap/canvas                      # CLI and service
brew install --cask hyperlab-sh/tap/canvas-app           # desktop app (installs the formula too)
```

Or download `canvas-app-<version>-darwin-arm64.dmg` (Apple silicon) or `-darwin-x64.dmg` (Intel) from the
[releases page](https://github.com/hyperlab-sh/canvas/releases) and drag Canvas to Applications.

**The app is not signed or notarized** (there is no Apple Developer account behind this project). The cask removes the
quarantine flag for you. A `.dmg` you download yourself is quarantined, and Gatekeeper says Canvas "cannot be
opened" or "is damaged". Either right-click Canvas in Applications and choose Open (then Open again), or run:

```sh
xattr -dr com.apple.quarantine /Applications/Canvas.app
```

### Linux

**Debian, Ubuntu** (apt; x86_64 and arm64). The repository is signed; the key is pinned to it with `signed-by`:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://hyperlab-sh.github.io/canvas/canvas-archive-keyring.gpg | sudo tee /etc/apt/keyrings/canvas-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/canvas-archive-keyring.gpg] https://hyperlab-sh.github.io/canvas/apt stable main" | sudo tee /etc/apt/sources.list.d/canvas.list
sudo apt update
sudo apt install canvas canvas-app          # canvas-app is optional
```

**Fedora, RHEL and clones, openSUSE** (dnf, zypper; x86_64 and aarch64). `canvas.repo` sets `gpgcheck=1`,
`repo_gpgcheck=1` and the `gpgkey`:

```sh
# Fedora, RHEL, Rocky, Alma
sudo curl -fsSL https://hyperlab-sh.github.io/canvas/canvas.repo -o /etc/yum.repos.d/canvas.repo
sudo dnf install canvas canvas-app          # canvas-app is optional

# openSUSE (zypper does not fetch the key by itself)
sudo curl -fsSL https://hyperlab-sh.github.io/canvas/canvas.repo -o /etc/zypp/repos.d/canvas.repo
sudo rpm --import https://hyperlab-sh.github.io/canvas/canvas.asc
sudo zypper install canvas canvas-app
```

Both repositories are updated on every release, so `apt upgrade` / `dnf upgrade` keep canvas current. Neither package
starts the service: run `canvas service install` ([below](#run-it-in-the-background)).

**One-off packages**, from the [releases page](https://github.com/hyperlab-sh/canvas/releases) (checked against
`SHA256SUMS`; no repository, so no automatic upgrades). `<v>` is the version, for example `0.4.0`:

```sh
sudo apt install ./canvas_<v>_amd64.deb ./canvas-app-<v>-linux-x64.deb        # arm64: _arm64.deb, linux-arm64
sudo dnf install ./canvas-<v>-1.x86_64.rpm ./canvas-app-<v>-linux-x64.rpm     # aarch64: .aarch64.rpm, linux-arm64
```

**AppImage** (the app only, x86_64 and arm64): download `canvas-app-<v>-linux-x64.AppImage` (or `-linux-arm64`),
`chmod +x` it and run it. It has no dependencies and installs no service, so get `canvas` from another channel. It
registers no `canvas://` handler or file association; use the `.deb` or `.rpm` for those.

**Homebrew on Linux** installs the CLI and service: `brew install hyperlab-sh/tap/canvas`.

### Windows

```powershell
scoop bucket add hyperlab https://github.com/hyperlab-sh/homebrew-tap
scoop install canvas                       # CLI
scoop install canvas-app                   # desktop app (installs canvas too)
```

Or install the CLI with the script, which puts it in `%LOCALAPPDATA%\canvas` and on your user `PATH`:

```powershell
irm https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.ps1 | iex
```

Or download the app installer from the [releases page](https://github.com/hyperlab-sh/canvas/releases):
`canvas-app-<v>-windows-x64.msi` or `canvas-app-<v>-windows-x64-setup.exe`.

**winget** is manual for now: the manifests (`Hyperlab.Canvas` and `Hyperlab.CanvasApp`) are generated on each release
and submitted to `microsoft/winget-pkgs` by hand, so `winget install Hyperlab.Canvas` works only once Microsoft has merged
that version. Until it has, use Scoop or the installers.

**Unsigned binaries.** Nothing here is code-signed (no paid certificate). Windows may react in two ways:
- **SmartScreen** shows "Windows protected your PC" for the installers and `canvas-app.exe`. Choose *More info*, then
  *Run anyway*. Files fetched by Scoop or `irm` rarely trigger it.
- **Smart App Control**, when switched on (a fresh Windows 11 install starts in evaluation mode), blocks unsigned
  programs outright, with no *Run anyway*. Turn it off in *Windows Security > App & browser control > Smart App
  Control*; it cannot be switched back on without resetting Windows. If you would rather keep it on, run the CLI in WSL or
  Docker.

`canvas service` (the background service) is available on macOS and Linux only; on Windows run `canvas serve`, or let
the app start it.

### Other channels

| | Command | Notes |
|---|---|---|
| Install script | `curl -fsSL https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.sh \| sh` | macOS, Linux (x64, arm64; not Alpine/musl) |
| Nix | `nix run github:hyperlab-sh/canvas -- --version`, or `nix profile install github:hyperlab-sh/canvas` | the CLI, Linux and macOS (x64, arm64) |
| Docker | `docker run --rm -p 127.0.0.1:43120:43120 -v canvas-data:/data ghcr.io/hyperlab-sh/canvas:latest` | the service on `http://127.0.0.1:43120`, projects in `/data` (amd64, arm64) |
| npm | `npm i -g @hyperlab.sh/canvas` | needs Node 20.11 or newer |
| bun | `bun add -g @hyperlab.sh/canvas` | installs with bun, but **runs on Node** (see below) |

The install script puts the program in `~/.local/share/canvas` and links `~/.local/bin/canvas` (override with
`CANVAS_HOME` and `CANVAS_BIN_DIR`; pick a version with `--version 0.4.0`). Run it again to upgrade, and
`sh install.sh --uninstall` to remove it. It checks the download against the release's `SHA256SUMS`. `brew upgrade canvas`
upgrades the Homebrew copy.

The Docker image has no authentication and binds all interfaces inside the container, so publish the port on
loopback only, as above, unless the network is yours. It runs as uid 10001: use a named volume for
`/data`, or add `--user "$(id -u):$(id -g)"` when you bind-mount a host directory.

**The npm package runs on Node, whichever tool installed it.** The `canvas` command starts with `#!/usr/bin/env node`,
and bun, like npm, runs installed commands through that line. If you installed with bun and have no Node, use one of the
standalone options instead. To run it on bun anyway, use `bun --bun canvas serve`, and for the background service
`canvas service install --runtime bun`.

## Desktop app

`canvas-app` is a native window (Tauri 2) onto the running service at `http://127.0.0.1:43120`. It is a thin viewer:
the service stays a separate program, so keep it running with `canvas service install`. With the service down the
window says so and offers *Start service*, which runs `canvas serve` for you.

- **Open from the terminal:** `canvas open [diagram]` opens a diagram in the app when it is installed and in your
  browser otherwise. `canvas open --app` insists on the app, `canvas open --browser` on the browser, and `--print`
  writes the http link instead.
- **Deep links:** `canvas://open/<project>/<id>` opens that diagram in the app, in a running window or a cold start.
- **Files:** double-click a `.openflow` or `.mmd` file (all platforms), or a `.openflow.json` file (Linux), to open it in
  the app; on macOS and Windows an `.openflow.json` opens through *Open With*, by dropping it on the window, or with
  `canvas open file.openflow.json`, because those systems match only the last extension. A diagram outside your projects
  is imported into `scratch` as a copy.
- **Exports** (PNG, SVG, JSON) land in your Downloads folder.
- `canvas-app --version` and `canvas-app --smoke` (loads the editor, prints one JSON line, exits 0 or 1) are
  there for scripts. More in [`desktop/README.md`](desktop/README.md).

## Quick start

```sh
canvas serve                         # after any install above
npx @hyperlab.sh/canvas serve        # or without installing: bunx @hyperlab.sh/canvas serve
```

Open http://127.0.0.1:43120. The service listens on the loopback address only and refuses requests from other hosts and
other websites.

`bunx` caches what it resolves for `latest`, so after a release it can keep running the old version. Name the version (`bunx @hyperlab.sh/canvas@0.4.0 serve`) or clear it with `bun pm cache rm`; `npx` does not do this.

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
    { "name": "scratch", "path": "/home/you/.local/share/openflowkit/diagrams" },
    { "name": "my-app", "path": "/home/you/code/my-app/diagrams" }
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
   `HOMEBREW_TAP_DEPLOY_KEY` secret (a write deploy key on the tap) is set; the same step pushes the Scoop manifests
   (`scripts/render-scoop.mjs`) to the tap's `bucket/` folder;
3. renders and validates the winget manifests for `Hyperlab.Canvas` and `Hyperlab.CanvasApp` (`scripts/render-winget.mjs`,
   `winget validate`) and uploads them as the `winget-manifests` workflow artifact; the pull request to
   `microsoft/winget-pkgs` is opened by hand from it: submit `Hyperlab.Canvas` first and `Hyperlab.CanvasApp` once that is merged, because the app
   manifest depends on the CLI package and the winget-pkgs checks reject it otherwise;
4. publishes the npm package through npm trusted publishing (the repo and `release.yml` are registered as the trusted
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
