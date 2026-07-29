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

Over the last three days, Keryx shipped 12 commits that make its research and payment loop more
open, more useful to other agents, and much stricter about what is allowed to move money.

**The agent now judges sources using relevant history.** A source is no longer penalized or promoted
because of unrelated questions from older runs. The public answer archive also exposes its complete
history with canonical navigation, crawl paths, and topic coverage instead of quietly forgetting
older pages.

**Keryx now has a hosted Remote MCP endpoint.** Codex, Claude, Cursor, and direct MCP clients can
connect to `https://keryx.cc/mcp`, inspect the available tools, and invoke the same research pipeline
without installing the local npm package. The setup hub is live at
<https://keryx.cc/integrations/mcp>.

**Traction now means external demand first.** Completed questions from real web askers and
third-party agents are the primary KPI; autonomous engine volume remains visible but secondary.
Returning actors require a server-verified wallet or settled inbound payer, and money metrics read
only settled records. Anonymous visitors are not fingerprinted and historical samples are not
invented.

**Citation rewards are now evidence-gated.** A model saying “cite this source” is no longer payment
authority. Keryx requires a valid decomposed claim, an inline source marker, an exact quote found in
content the agent actually read, and sufficient support. Rejected citations cannot enter
attribution or settlement, and confidence is bounded by the same verified evidence ledger.

**The wanted board now has a financial completion loop.** At <https://keryx.cc/wanted>, a creator can
offer a specific RSS post for a claim Keryx previously failed to answer. Registration re-checks the
live gap and public feed preview. A durable worker then retries the failed question through the
normal x402 path, with a hard treasury ceiling and bounded attempts. “Filled” requires both
reward-qualified evidence and a genuinely settled citation leg for the offered source; otherwise
the result stays explicitly `unpaid`, `missed`, `stale`, or `failed`.

**The newly exposed boundaries were hardened before release.** Wanted offers are atomic at one per
gap and verified owner, with a five-per-wallet daily valve. Remote MCP rejects batches containing
multiple treasury-funded research calls. The public fetcher blocks hexadecimal IPv4-mapped IPv6
private targets. The testnet onramp retains its reservation when a transaction was broadcast but
the receipt is still uncertain, preventing a retry from double-dripping.

Earlier in the same range, session-cap spending and onramp address/daily claims moved from
check-then-write sequences to atomic database reservations. Public feed and webhook requests pin
validated DNS answers to the socket, closing rebinding between validation and connection.

The release passed 543 Vitest tests, TypeScript checking, a production Next.js build, and all 16
SourceRegistry contract tests. It is live on the VPS at commit `ad08452`, with real settlement mode
on Arc testnet.

**Links**

- Product: <https://keryx.cc>
- Wanted claims: <https://keryx.cc/wanted>
- Remote MCP setup: <https://keryx.cc/integrations/mcp>
- v0.8.0 release: <https://github.com/tang-vu/keryx/releases/tag/v0.8.0>
- Full code range: <https://github.com/tang-vu/keryx/compare/6788f1696ecb497c974de4c7a2edd400466f396f...ad084524266a2832c1ea2874c507e23d07adc670>

Models may propose relevance, evidence, and attribution. Code must authorize payment.
