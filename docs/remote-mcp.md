# Remote MCP

Keryx exposes a stateless MCP Streamable HTTP endpoint at `https://keryx.cc/mcp`. It complements
the published `keryx-mcp` stdio package: remote clients need no local process, while the stdio
package remains the caller-funded x402 option.

## Architecture decision

**Decision.** Create a fresh `McpServer` and Web Standard transport per request, with JSON response
mode and no session id. The `research` tool calls the same `collectRun` core as the web, OpenAI, and
A2A surfaces. Completed runs and their payments carry the distinct `mcp` origin.

**Invariant preserved.** The agent's existing budget enforcement, creator payee validation,
settlement recording, and source attribution remain the only money path. The MCP model cannot pick
an arbitrary payee or create a payment itself.

**Threat introduced.** A public remote client could repeatedly authorize treasury-funded research,
and a browser could attempt DNS-rebinding/cross-origin calls.

**Mitigation.**

- Anonymous `research` calls use the existing IP-keyed `treasuryAsk` limit and `anonMaxBudget`.
- An ask-scoped `kx_live_…` key uses the keyed rate limit and `a2aMaxBudget`; its verified wallet,
  not a client argument, supplies stable actor attribution.
- A present `Origin` must match the request origin, configured Keryx base URL, or an explicit
  `KERYX_MCP_ALLOWED_ORIGINS` entry. Invalid origins receive HTTP 403.
- The endpoint is stateless and exposes no server-initiated notification stream or durable session.

**Migration and rollback.** Supabase migration `0022_remote_mcp_origin.sql` expands the query-run
origin constraint. SQLite stores origin as text and needs no schema rewrite. Rollback is to remove
the `/mcp` route and registry `remotes` entry; existing `mcp` rows remain readable external history.

## Tools

- `research(question, budget?, model?)` — runs budgeted creator-paid research and returns both text
  and structured answer/citation/settlement metadata.
- `keryx_status()` — reports the active caller tier and budget cap without starting a dispatch.

## Client configuration

Use `https://keryx.cc/mcp` as a Streamable HTTP server URL. For copy-ready setup and a live
connection check, open [`https://keryx.cc/integrations/mcp`](https://keryx.cc/integrations/mcp).

### Codex

```bash
codex mcp add keryx --url "https://keryx.cc/mcp?client=codex"
```

For an authenticated key stored in `KERYX_API_KEY`:

```bash
codex mcp add keryx --url "https://keryx.cc/mcp?client=codex" --bearer-token-env-var KERYX_API_KEY
```

Codex CLI, the IDE extension, and the ChatGPT desktop app share this MCP configuration on the same
Codex host.

### Claude Code

```bash
claude mcp add --transport http keryx "https://keryx.cc/mcp?client=claude"
```

Add `--scope user` to make it available outside the current project. For authenticated use, append
`--header "Authorization: Bearer <kx_live_…>"`.

### Cursor

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "keryx": {
      "url": "https://keryx.cc/mcp?client=cursor"
    }
  }
}
```

Authentication is optional. Clients with a Keryx key may send:

```text
Authorization: Bearer kx_live_…
```

Only keys with the `ask` scope can run as an authenticated caller. The key raises rate/budget caps
and attributes the run; it does not custody funds or become a payment authority.
