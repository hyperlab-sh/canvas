#!/usr/bin/env node
// The MCP server entry (stdio), the one an agent's MCP config runs.
import { fileURLToPath } from 'node:url';

process.env.OPENFLOWKIT_APP_DIR ??= fileURLToPath(new URL('../app', import.meta.url));
await import('../server/dist/index.js');
