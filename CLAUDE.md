# canvas

Wrapper repo: builds the `openflowkit` submodule (a fork, tracked on its `main`) and publishes it as
`@hyperlab.sh/canvas`. Do not edit anything inside `openflowkit/`; changes go to the fork.

- `npm run build`: `npm ci` + app build + mcp-server build in the submodule, then assembles `server/` and `app/`
  (gitignored). The submodule is an npm workspace: never run `npm ci` inside `openflowkit/mcp-server`.
- `bin/canvas.js` spawns `server/dist/cli.js` (it only runs as an entry point); `bin/canvas-mcp.js` imports the stdio server.
- `package.json` `dependencies` must equal the submodule's `mcp-server` dependencies; the build fails on drift.
- Check the package with `npm pack --dry-run` before changing `files`.
- Releases: tag `vX.Y.Z`; the Release workflow publishes through npm trusted publishing (the first publish was manual).
