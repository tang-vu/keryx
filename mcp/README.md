# Keryx MCP server — add Keryx to any agent

Give any MCP-capable agent (Claude Code, Claude Desktop, Cursor, …) a tool that asks **Keryx** a
question. Keryx autonomously buys paid sources under a budget, answers with inline citations, and
**pays every creator it cites** in USDC on Arc. The toll for each call is paid from *your own*
Arc-testnet wallet — so every call is a real on-chain payment, visible live on
[keryx.cc/dashboard](https://keryx.cc/dashboard).

## Remote MCP (no install)

Connect a Streamable HTTP client directly to:

```text
https://keryx.cc/mcp
```

The remote server exposes:

| Tool | What it does |
|------|--------------|
| `research` | Runs budgeted creator-paid research and returns the answer, citations, confidence, settlement telemetry, and dispatch URL. |
| `keryx_status` | Shows the caller tier and active creator-payment budget cap. |

It includes an anonymous IP-limited trial. For higher limits and verified wallet attribution, send
an ask-scoped Keryx API key as `Authorization: Bearer kx_live_…`. The remote path is treasury-funded;
the budget is clamped server-side, and the local x402 option below remains available when the caller
should pay Keryx's inbound toll from its own wallet.

### Connect from Codex

```bash
codex mcp add keryx --url https://keryx.cc/mcp
```

### Connect from Claude Code

```bash
claude mcp add --transport http keryx https://keryx.cc/mcp
```

### Connect from Cursor

```json
{
  "mcpServers": {
    "keryx": {
      "url": "https://keryx.cc/mcp"
    }
  }
}
```

See [`docs/remote-mcp.md`](../docs/remote-mcp.md) for API-key variants and the trust model.

## Local x402 MCP tools

| Tool | What it does |
|------|--------------|
| `ask_keryx` | Ask a research question (+ optional USDC `budget`). Returns a cited answer and the creators Keryx paid downstream. Costs **0.02 USDC** per call, paid from your wallet. |
| `keryx_wallet_status` | Show the wallet this server pays from — address, balances, whether it's ready, and how to fund it. **Run this first.** |

## Local x402 setup (≈3 minutes)

Published to npm as [`keryx-mcp`](https://www.npmjs.com/package/keryx-mcp) — no clone, no build.

### Add it to Claude Code (one line)

```bash
claude mcp add keryx -- npx -y keryx-mcp@latest
```

### Or add it to any MCP client (Claude Desktop, Cursor, Windsurf, …)

```json
{
  "mcpServers": {
    "keryx": {
      "command": "npx",
      "args": ["-y", "keryx-mcp@latest"]
    }
  }
}
```

### Fund the wallet, then ask

1. Call **`keryx_wallet_status`** — it prints the wallet address it pays from.
2. Open the [Circle faucet](https://faucet.circle.com), pick **Arc Testnet**, paste that address.
   (20 USDC / 2h — also covers gas.)
3. Call **`ask_keryx`** with your question. The server deposits to Circle Gateway on the first call
   and pays the toll; Keryx researches, answers with citations, and pays the creators it cited.

That's it — the answer comes back with the on-chain payment proof and a link to the live dashboard
where your call now appears as external traction.

## Configuration (env)

All optional — sane Arc-testnet defaults are built in.

| Var | Default | Purpose |
|-----|---------|---------|
| `KERYX_BASE_URL` | `https://keryx.cc` | Keryx deployment to call. |
| `KERYX_BUYER_PRIVATE_KEY` | *(generated)* | Bring your own funded Arc wallet instead of the generated one. |
| `KERYX_WALLET_FILE` | `~/.keryx/buyer-wallet.json` | Where the generated wallet is persisted. |
| `KERYX_GATEWAY_DEPOSIT` | `0.5` | USDC moved into Gateway per top-up. |
| `KERYX_RPC_URL` | `https://rpc.testnet.arc.network` | Arc testnet RPC. |

> **Testnet funds only.** Calls settle Arc testnet USDC. The generated wallet holds only what you
> faucet into it; Keryx never touches your keys. The published buyer is pinned to Arc testnet.
> Mainnet requires a separate audited release and is not enabled by an environment variable.

## From source (development)

```bash
git clone https://github.com/tang-vu/keryx && cd keryx && npm install
claude mcp add keryx -- node --import tsx --no-warnings "$(pwd)/mcp/keryx-mcp-server.mts"
```

`npm run build` (in `mcp/`) bundles `keryx-mcp-server.mts` → `dist/keryx-mcp.mjs` with esbuild; that
single file is what ships to npm and runs under plain `node`.
