# @hyperlab.sh/canvas

[![CI](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/hyperlab-sh/canvas/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@hyperlab.sh/canvas)](https://www.npmjs.com/package/@hyperlab.sh/canvas) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A local diagram service for coding agents. It packages a build of the
[hyperlab-sh/openflowkit](https://github.com/hyperlab-sh/openflowkit) fork (a fork of
[OpenFlowKit](https://github.com/openflowkit/openflowkit)): a canvas editor in the browser, a local service that keeps
diagrams as `.openflow.json` files in named projects, and an MCP server agents draw through.

```
npm i -g @hyperlab.sh/canvas
canvas serve                     # http://127.0.0.1:43120
claude mcp add -s user canvas -- canvas-mcp
```

The `paint-a-picture` skill (`skills/`) teaches an agent to draw, connect to a diagram and answer canvas comments.
Service configuration (`~/.config/openflowkit/service.json`) and environment variables are documented in the fork's
self-hosting guide.

## Building

The app and server come from the `openflowkit` submodule, pinned to a commit of the fork's `main`.

```
git submodule update --init
npm run build      # builds the submodule, assembles server/ and app/
npm publish --access public
```

The first publish is manual (`npm run build && npm publish`). After that, add this repo and `release.yml` as a trusted publisher in the package settings on npmjs.com; then bump `version`, tag `vX.Y.Z` and push the tag, and the Release workflow publishes with provenance. No npm token is stored.

To take a newer fork: `git -C openflowkit pull origin main`, then commit the new pointer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Editor and service changes belong in the fork.

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
