# Security Policy

## Supported versions

Only the latest published version of `@hyperlab.sh/canvas` is supported.

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on
https://github.com/hyperlab-sh/canvas. Do not open a public issue.

Vulnerabilities in the editor, the MCP server or the service code themselves belong to the fork
(https://github.com/hyperlab-sh/openflowkit) and, if they exist there, to upstream
(https://github.com/openflowkit/openflowkit). Report them to the fork the same way; this repo only packages it.

The service binds to 127.0.0.1 and refuses non-loopback Host and cross-site Origin requests. Anything that
gets around that is in scope.
