# Changelog

All notable changes are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/). Changes inside the editor and service come from the pinned
`openflowkit` submodule; each release note names the fork commit it was built from.

## [Unreleased]

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
