# Changelog

All notable changes are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/). Changes inside the editor and service come from the pinned
`openflowkit` submodule; each release note names the fork commit it was built from.

## [Unreleased]

### Added
- `canvas open [diagram] [--print]` opens a diagram (a file, `project/id`, or an id or title) in the default browser and starts the service when nothing answers.

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
