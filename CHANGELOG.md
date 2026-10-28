# Changelog

All notable changes are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/). Changes inside the editor and service come from the pinned
`openflowkit` submodule; each release note names the fork commit it was built from.

## [Unreleased]

## [0.1.1]

### Fixed
- `bunx @hyperlab.sh/canvas` failed with "could not determine executable": bun cannot choose between two bins. `canvas` is now the only bin and the MCP server is `canvas mcp`.

## [0.1.0]

### Added
- First package: the `canvas` CLI (`canvas serve`), the stdio MCP server, the bundled app, and the
  `paint-a-picture` skill.
