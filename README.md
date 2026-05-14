# UMSU MCP

MCP server for the original UMSU / `wo/tpg` tree argument checker.

This repo contains:

- `umsu-web/` — git submodule pointing at the original vanilla UMSU checker (`https://github.com/wo/tpg`)
- `umsu-mcp/` — TypeScript MCP server using the official `@modelcontextprotocol/sdk`

The MCP links into the vanilla `umsu-web` scripts at runtime through Node `vm`. It does not copy or rewrite the UMSU tree logic.

## Clone

```bash
git clone --recurse-submodules git@github.com:benjosua/umsu-mcp.git
cd umsu-mcp
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

## Install

```bash
cd umsu-mcp
npm ci
```

## Run over stdio

```bash
npm run start:stdio
```

## Run over Streamable HTTP

```bash
npm run start:http
```

Default endpoint:

```text
http://127.0.0.1:3337/mcp
```

Override host/port:

```bash
npm run start -- --transport http --host 127.0.0.1 --port 3337
```

## Codex config

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.umsu]
command = "/bin/bash"
args = ["-lc", "cd /path/to/umsu-mcp/umsu-mcp && exec ./node_modules/.bin/tsx src/index.ts --transport stdio"]
```

Replace `/path/to/umsu-mcp` with your clone path.

## Tools

- `parse_argument` — parse a UMSU formula or argument
- `prove_argument` — run the tableau checker and return validity, trees, and countermodel when available
- `interactive_prove_argument` — collect formula/constraints through MCP elicitation
- `explain_proof_with_sampling` — run checker and ask client model to explain result
- `list_modal_constraints` — list modal accessibility constraints

## Examples

```text
p∨q, ¬p |= q
∀x(Hx→Mx), Hs |= Ms
□p→p
```

For modal constraints, use one or more of:

```text
universality, reflexivity, symmetry, transitivity, euclidity, seriality
```

Example with reflexivity:

```json
{
  "input": "□p→p",
  "constraints": ["reflexivity"]
}
```

## Verify

```bash
cd umsu-mcp
npm run check
npm run smoke
```

## License

GPL-3.0-only. The bundled `umsu-web` submodule is the original UMSU checker licensed under GNU GPL v3; this MCP wrapper is distributed under the same license.
