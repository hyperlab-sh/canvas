# Changelog

All notable changes are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/). Changes inside the editor and service come from the pinned
`editor` submodule (hyperlab-sh/canvas-editor, `openflowkit` before 0.5.0); each release note names the commit it was
built from.

## [Unreleased]

### Changed
- **Rebrand to Canvas (breaking).** The editor is now hyperlab-sh/canvas-editor (was hyperlab-sh/openflowkit), built from
  the `editor` submodule. Names changed with no fallback: env vars are `CANVAS_*` (was `OPENFLOWKIT_*`, e.g.
  `CANVAS_SERVICE_CONFIG`, `CANVAS_SERVICE_URL`, `CANVAS_CHANNEL`), the service config is `~/.config/canvas/service.json`
  and the default project folder `~/.local/share/canvas/diagrams`, `/health` reports `canvas-service`, and DSL source
  files are `*.canvas` (was `*.ofk`; service diagrams stay `.openflow.json`). Move the old folders and rename old files by hand, then `canvas service restart`.
- New logo, in the README, the desktop app icons and the editor.

### Removed
- The `paint-a-picture` skill and this repo's Claude Code plugin manifest. The skill now ships in the hyper plugin as
  `/hyper:canvas`.

## [0.4.1]

### Changed
- `canvas open --app` without a diagram opens the desktop app on the editor home (`#/home`) instead of refusing. Bare `canvas open` does the same when the app is installed, and opens `/#/home` in the browser otherwise. With no diagram, `--browser` also opens `/#/home`, and `--print` writes `http://127.0.0.1:43120/#/home` (both used `/`, which showed an untitled diagram).
- When `--app` is given and the app is missing, `canvas open` exits 1 and prints the install command for the platform (macOS, apt, dnf, zypper, Scoop) with the repository or bucket setup it needs, and the releases page.
- The app accepts `canvas://home` (and the bare `canvas://`): it shows the editor home and brings the window to the front, also when it is already running. After start-up the app's first screen is the editor home, not an untitled diagram.
- README recommends `brew trust hyperlab-sh/tap` then `brew install --cask canvas-app` on macOS, with the two full-name installs (formula first, then cask) as the alternative. The Homebrew formula's caveats name the `canvas-app` cask on macOS.

### Fixed
- Links to other sites in the desktop app (for example "Anthropic Console" in the AI Provider modal) open in the default browser; links within the service stay in the window.
- The Homebrew cask no longer uses the deprecated `postflight` stanza (`postflight_steps` instead); the quarantine strip is kept.

## [0.4.0]

### Added
- Desktop app `canvas-app` (Tauri 2): a native window onto the running service at `http://127.0.0.1:43120`, with a page that starts the service when it is down, `canvas://open/<project>/<id>` deep links, file associations for `.openflow` and `.mmd` (and `.openflow.json` on Linux), exports saved to Downloads, and `--version` / `--smoke`. The service stays a separate program; see `desktop/README.md`.
- Install channels: signed apt and dnf/zypper repositories on GitHub Pages (`https://hyperlab-sh.github.io/canvas`); `canvas` and `canvas-app` `.deb` and `.rpm` packages (x86_64, arm64); `canvas-app` as `.dmg` (macOS arm64, x64), `.msi` and `-setup.exe` (Windows x64) and `.AppImage` (Linux x64, arm64); a Homebrew cask `canvas-app`; Scoop manifests `canvas` and `canvas-app` in the tap's `bucket/` folder; winget manifests `Hyperlab.Canvas` and `Hyperlab.CanvasApp` (generated and validated on release, submitted to winget-pkgs by hand); a Nix flake (`nix run github:hyperlab-sh/canvas`). All assets are listed in `SHA256SUMS`.
- The app and the binaries are not code-signed or notarized. README explains the macOS Gatekeeper and Windows SmartScreen / Smart App Control prompts.
- `canvas open [diagram] [--app|--browser] [--print]` opens a diagram (a file, `project/id`, or an id or title) in the desktop app when it is installed (through its `canvas://` link) and in the default browser otherwise, and starts the service when nothing answers. `--app` and `--browser` force one; `--print` still writes the http link.
- Docker image `ghcr.io/hyperlab-sh/canvas:<version>` and `:latest` (linux/amd64 and linux/arm64): `canvas serve` from the release archive on `debian:stable-slim`, bound to all interfaces inside the container, projects in the `/data` volume. Publish the port as `-p 127.0.0.1:43120:43120` and browse to `http://127.0.0.1:43120`; the service has no authentication, so do not publish it beyond loopback. The service runs as uid 10001: use a named volume for `/data`, or pass `--user "$(id -u):$(id -g)"` when bind-mounting a host directory. The `openflowkit` submodule moves to the fork commit that adds `serve --host` / `OPENFLOWKIT_SERVICE_HOST`.

## [0.3.0]

### Added
- Standalone binaries for macOS, Linux and Windows (bun-compiled, no Node or bun needed), attached to each GitHub release with `SHA256SUMS`.
- `install.sh` (macOS, Linux) and `install.ps1` (Windows) install the binary and verify its checksum; a Homebrew formula is pushed to `hyperlab-sh/homebrew-tap` on release.
- `canvas service install --runtime node|bun|<path>` pins the runtime the npm package's service runs on. The binary's service runs the binary itself, and under Homebrew points at the stable `opt` path so `brew upgrade` keeps it working.

### Fixed
- Running the CLI on bun no longer hangs layout (elkjs mistook bun's global `self` for a web worker).

### Documented
- The npm package runs on Node even when bun installed it, because the `canvas` command starts with a `node` shebang.

## [0.2.0]

### Added
- `canvas service install|status|restart|logs|uninstall`: run the service in the background as a launchd agent (macOS) or a systemd user unit (Linux), started at every login.

### Changed
- Help, command help, `--version` and errors name the command `canvas`, not `openflowkit` (fork PR #13, `OPENFLOWKIT_CLI_NAME`).
- README documents installing, the background service, projects, configuration and the commands.

## [0.1.1]

### Fixed
- `bunx @hyperlab.sh/canvas` failed with "could not determine executable": bun cannot choose between two bins. `canvas` is now the only bin and the MCP server is `canvas mcp`.

## [0.1.0]

### Added
- First package: the `canvas` CLI (`canvas serve`), the stdio MCP server, the bundled app, and the
  `paint-a-picture` skill.
