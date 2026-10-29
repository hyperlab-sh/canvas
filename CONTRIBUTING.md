# Contributing

This repo only packages a fork of OpenFlowKit and ships the `paint-a-picture` skill. Changes to the editor, the
service or the MCP server go to https://github.com/hyperlab-sh/openflowkit, not here.

## What belongs here

- `scripts/build.mjs`, `bin/`, `package.json`: how the package is built and run.
- `skills/paint-a-picture/`: the agent skill.
- Bumping the submodule to a newer fork commit.

## Development setup

```
git clone --recurse-submodules https://github.com/hyperlab-sh/canvas.git
cd canvas
npm run build          # needs Node >= 20.11 (22 recommended); builds the app and server
npm install --omit=dev
node bin/canvas.js serve
```

Run `npx @hyperlab.sh/canvas` from another directory: inside this repo npx finds the local package and fails with `canvas: command not found`.

`npm test` runs the unit tests for `canvas service`.

Check the package contents before opening a PR that touches `files` or the build: `npm pack --dry-run`.

## Pull requests

Branch from `main`, use conventional commits (`feat:`, `fix:`, `build:`, `docs:`), keep one concern per PR.
Describe how you checked it: for the build, the `npm pack --dry-run` file count and a `canvas serve` run.

## Reporting bugs and ideas

Use the issue templates. Say whether the problem is in the packaging or in the editor/service; the latter go to the fork.
