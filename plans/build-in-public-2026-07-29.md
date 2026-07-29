# Build in Public — Keryx, July 27–29, 2026

**Code range:** [`6788f16...ad08452`](https://github.com/tang-vu/keryx/compare/6788f1696ecb497c974de4c7a2edd400466f396f...ad084524266a2832c1ea2874c507e23d07adc670)  
**Release:** [`v0.8.0`](https://github.com/tang-vu/keryx/releases/tag/v0.8.0)  
**Live product:** [keryx.cc](https://keryx.cc)

This file is ready to copy into X and Discord. The figures below are verification results, not
traction claims. Keryx remains on Arc testnet.

---

## X thread

### 1/9

Build in public: in 3 days, Keryx moved from “an agent that pays for sources” to a stricter open research economy.

Better source judgment. Remote MCP. Evidence-gated rewards. Wanted claims that can end in verified creator payouts. 🧵

### 2/9

First, we fixed what the agent learns from history.

A source is now judged only by relevant past questions—not unrelated traffic. The public answer archive also stopped dropping older pages and gained canonical navigation, crawl paths, and complete topic coverage.

### 3/9

We also changed what Keryx calls traction.

External completed queries are now the primary KPI; autonomous engine volume stays visible but secondary. Returning users require verified identity, and money metrics count settled records only—no fingerprinting or simulated revenue.

### 4/9

Keryx is now available as a hosted Remote MCP server:

`https://keryx.cc/mcp`

Codex, Claude, Cursor, or a direct MCP client can inspect Keryx and run the same research loop without installing the local package.

Setup: https://keryx.cc/integrations/mcp

### 5/9

The most important payment change: a model citation can no longer authorize money by itself.

A reward now needs a valid claim, an inline source marker, an exact quote found in content Keryx actually read, and enough support. No evidence = no citation payout.

### 6/9

`/wanted` now closes the loop.

A creator can offer a specific RSS post for a claim Keryx previously failed to answer. Keryx retries that question, reads through the normal x402 path, and calls it “filled” only when the source earns a real settled citation.

### 7/9

We also hardened every new treasury boundary:

• atomic session caps + onramp claims

• wanted offers: 1/gap-owner, 5/wallet/day

• 1 funded research call/MCP batch

• mapped-IPv6 SSRF blocked

• uncertain receipts cannot double-drip

### 8/9

Verification for the release:

✓ 543 Vitest tests

✓ TypeScript check

✓ Next.js production build

✓ 16 SourceRegistry contract tests

✓ live VPS health on commit `ad08452`

Settlement mode remains real on Arc testnet.

### 9/9

Rule behind this release:

Models may propose relevance, evidence, and attribution. Code must authorize payment.

Try Keryx: https://keryx.cc

Wanted claims: https://keryx.cc/wanted

Release: https://github.com/tang-vu/keryx/releases/tag/v0.8.0

#BuildInPublic #AIagents #x402

---

## Discord announcement

### Keryx v0.8.0 — evidence before money, and a path from wanted claim to creator payout

Three days, 12 commits, one rule: models may propose relevance, evidence, and attribution; code
must authorize payment.

**Remote MCP:** Codex, Claude, Cursor, and direct MCP clients can now invoke Keryx at
`https://keryx.cc/mcp`. External completed queries are the primary KPI; autonomous traffic remains
visible but secondary.

**Evidence before money:** citation rewards now require a valid claim, inline source marker, exact
quote found in content Keryx actually read, and sufficient support. No verified evidence means no
citation payout.

**Wanted claim → creator payout:** at <https://keryx.cc/wanted>, a creator can offer an RSS post for
a claim Keryx previously failed to answer. Keryx re-checks the live gap and feed preview, retries
through the normal x402 path, and marks it `filled` only when the offered source produces qualified
evidence and receives a genuinely settled citation.

**Hardening:** atomic session/onramp reservations; one wanted offer per gap and verified owner;
five offers per wallet/day; one funded research call per MCP batch; DNS-pinned public fetches;
IPv4-mapped IPv6 SSRF blocking; and no double drip while an onramp receipt is uncertain.

The agent also judges sources using relevant history, and the public archive now exposes complete
topic/crawl coverage instead of dropping older pages.

Verified: 543 Vitest tests, TypeScript, production build, and 16 SourceRegistry contract tests.
Live at commit `ad08452` with real settlement mode on Arc testnet.

Product: <https://keryx.cc>

MCP setup: <https://keryx.cc/integrations/mcp>

Release: <https://github.com/tang-vu/keryx/releases/tag/v0.8.0>
