# UMSU MCP package

TypeScript MCP server for the original UMSU / `wo/tpg` tree argument checker.

Backend expectation: this package lives next to an `umsu-web/` submodule at repo root:

```text
repo-root/
  umsu-web/
  umsu-mcp/
```

The server loads `../umsu-web/*.js` at runtime and uses the official `@modelcontextprotocol/sdk`.

## Install

```bash
npm ci
```

## Run

```bash
npm run start:stdio
npm run start:http
```

Default HTTP endpoint:

```text
http://127.0.0.1:3337/mcp
```

## Verify

```bash
npm run check
npm run smoke
```

## License

GPL-3.0-only. The bundled `umsu-web` submodule is the original UMSU checker licensed under GNU GPL v3; this MCP wrapper is distributed under the same license.
