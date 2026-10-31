# canvas

Wrapper repo: builds the `editor` submodule (hyperlab-sh/canvas-editor, tracked on its `main`) and publishes it as
`@hyperlab.sh/canvas`. Do not edit anything inside `editor/`; changes go to canvas-editor.

- `npm run build`: `npm ci` + app build + mcp-server build in the submodule, then assembles `server/` and `app/`
  (gitignored). The submodule is an npm workspace: never run `npm ci` inside `editor/mcp-server`.
- `bin/canvas.js` is the only bin (`canvas serve`, `canvas mcp`, ...) and spawns `server/dist/cli.js`, which only runs as an entry point. Keep it the only bin: `bunx @hyperlab.sh/canvas` cannot pick between two.
- `lib/service.js` is `canvas service` (launchd/systemd units, pure generators plus an injectable runner); `npm test` covers it. `bin/canvas.js` handles `service` itself and appends it to the top-level help.
- Standalone binaries: `scripts/package-native.mjs` (needs bun) bundles `server/dist/cli.js` and compiles `bin/canvas-native.js`; `lib/launch.js` is shared by both entries. `install.sh`/`install.ps1` and `scripts/render-formula.mjs` (Homebrew) consume its `release/` output. Test a change with `bun scripts/package-native.mjs` then extract the archive; the bundle must keep `delete globalThis.self;` (elkjs).
- `package.json` `dependencies` must equal the submodule's `mcp-server` dependencies; the build fails on drift.
- Check the package with `npm pack --dry-run` before changing `files`.
- Releases: tag `vX.Y.Z`; the Release workflow publishes through npm trusted publishing (the first publish was manual).
- `packaging/nfpm/` builds `canvas_<v>_<amd64|arm64>.deb` and `canvas-<v>-1.<x86_64|aarch64>.rpm` from the release archives (`node packaging/nfpm/build.mjs`, needs nfpm); `.github/workflows/packages.yml` builds them and installs them in clean Debian, Ubuntu, Fedora and openSUSE containers (called by `ci.yml` and `release.yml`). `release.yml` also runs by `workflow_dispatch` with `dry_run` (default true): everything but publishing.
