# Remote MCP

Keryx exposes a stateless MCP Streamable HTTP endpoint at `https://keryx.cc/mcp`. It complements
the published `keryx-mcp` stdio package: remote clients need no local process, while the stdio
package remains the caller-funded x402 option.

Public production uses Arc mainnet. Remote calls use the hosted treasury-funded
research path; the client supplies no payment signer. Hosted health and per-role
availability remain separate from publication of the stdio package. See
[current deployment and distribution evidence](mainnet-status.md).

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

- Anonymous `research` calls share the 5/minute anonymous IP allowance and `anonMaxBudget`.
- An ask-scoped `kx_live_…` key uses `a2aMaxBudget`; all keys for its verified wallet share
  10/minute across sponsored web/chat/MCP. Direct requests also share 10/minute per IP.
  Every sponsored surface shares a durable global allowance (60/minute by default);
  unavailable counters refuse research. See [admission limits](engineering/mainnet-economic-recovery.md#sponsored-admission).
- A present `Origin` must match the request origin, configured Keryx base URL, or an explicit
  `KERYX_MCP_ALLOWED_ORIGINS` entry. Invalid origins receive HTTP 403.
- The endpoint is stateless and exposes no server-initiated notification stream or durable session.

**Migration and rollback.** Supabase migration `0022_remote_mcp_origin.sql` expands the query-run
origin constraint. SQLite stores origin as text and needs no schema rewrite. Rollback is to remove
the `/mcp` route and registry `remotes` entry; existing `mcp` rows remain readable external history.

## Tools

- `paper_lookup(query, searchRepositories?)` — returns free bibliography with
  recorded title, contributors, DOI when present, exact version, metadata source
  and observation time. Default is retained catalog metadata. External arXiv/
  Crossref metadata lookup requires `searchRepositories: true`; no paper-body
  reading, model, research dispatch or payment is performed. Unknown status and
  provider failures remain visible. See [lookup boundaries](engineering/free-paper-lookup.md).

- `research(question, budget?, model?, mode?, scholarly?)` — runs budgeted creator-paid research and returns both text
  and structured answer/citation/settlement metadata.
- `keryx_status()` — reports the active caller tier and budget cap without starting a dispatch.
- `research_monthly()` — reads Monthly discovery and returns a web/API handoff;
  it never buys or redeems an entitlement. Check the actual quote for current
  availability. The shared tool's retained testnet wording is a documented
  [runtime-copy follow-up](surface-parity.md#october-4-documentation-and-current-release-status).

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

`mode` accepts `quick` or `deep` (default). `scholarly: true` opts into bounded Crossref/arXiv discovery and sends the question to those services. Structured results retain article/version metadata, answer-qualified public evidence, and recorded BibTeX/RIS/evidence CSV exports. Planned citation allocations are separate from settlement; `creatorsPaid` remains null when the distinct settled count is unavailable.

The result exposes bounded `reasoningAttempts` and one `reasoning` projection with
`telemetry`, `attemptsOmitted`, per-step serving and `sourceSelection`. Each step
retains its recorded engine/tier and marks degraded/heuristic serving. Text-only
consumers receive the same summary; the aggregate `engine` alone does not show
which provider selected sources. Attempts contain allowlisted categories/status/
timing and numeric local input bounds, never prompts or provider response bodies.
`reasoning.telemetry` marks unavailable/incomplete history explicitly; absent
serving tiers are not reconstructed. Remote protocol0.3.0 remains additive.

Request-local output validation or input refusal does not clear historical circuit failures.
If a half-open probe was already acquired, its bounded lease expires normally; a rejected
result is not evidence of successful provider health. No circuit reset is part of this repair.

This additive contract also travels through shared A2A and OpenAI metadata. The caller-funded
stdio package forwards hosted fields and formats the same summary without adding a model call
or changing source-payment authority. Hosted deployment and stdio package publication remain
independent release gates. The original S10 exception diagnosis and a separately authorized
bounded live retest for [issue #158](https://github.com/tang-vu/keryx/issues/158) remain open;
synthetic resilience checks do not establish live model quality or authorize a circuit reset.
