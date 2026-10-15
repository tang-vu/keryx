# Chat account 263: observed research compatibility repair

Source successor, 2026-10-15. Runtime controls, types and build are UNRUN here.
ROOT retains review, execution, current-main composition, PR/required CI, merge
and batch delivery. This document establishes neither production acceptance nor
completion of original issue 263.

## Observed failure and reachable cause

The parent capture `chat263-only-observed-server-successors-20261015` under
`output/resume-distribution63-audit-20261012` reports 72 PASS, four FAIL and 59
unselected controls. Its process closed naturally; this is not timeout evidence.
The four failed assertions are Slack's scoped generation callback (26.553 ms),
Telegram's preparation-refusal storage prohibition (12.279 ms), and Telegram's
two default-OFF budget cases (6.892 ms and 1.745 ms).

Slack POST verifies the raw-body HMAC, parses research, checks treasury and
sponsored admission, clamps the budget, and schedules `runAndReply`. The callback
checks the enabled private response-URL gate before research. Telegram POST
verifies its webhook secret before parsing, then follows its existing admission
and budget path into `runAndReply`. Neither request handler opens research storage.

Both callbacks had newly called `getDb()` for `linkedChatOwner` before
`prepareHostedRunClaim`, regardless of `hostedRunClaimsEnabled()`. Both original
fixtures deliberately reject DB access and leave hosted claims OFF. Slack's raw
stderr records that exact fixture rejection; its catch sends the existing private
error instead of collecting research. Telegram catches the same rejected lookup
and returns, explaining both zero collect calls and the unexpected DB call in
the preparation-refusal case. JavaScript evaluates `await getDb()` before the
following binding argument, so these failures do not prove a URL parse failure.
The fixture URLs are valid; their missing network is not reached in this failure.
Real config supplies `baseUrl` and `networkId` in `lib/config.ts`.

`preparePrivateRunClaim` in `lib/run-claims/delivery.ts` explicitly returns null
without opening a store when OFF or owned. Thus the unconditional lookup added a
new storage dependency ahead of the pre-existing default-OFF anonymous contract.
The Telegram refusal fixture's preparation mock must remain reachable without
that unrelated storage call. No expected-zero DB assertion is weakened.

## Correction and boundaries

Use the existing hosted-claims predicate to guard linked-owner resolution in
these two callbacks. OFF requests retain anonymous admission without opening
chat-link storage or parsing a chat binding. They still invoke the existing claim
preparation exactly once, retaining refusal-before-preferences/providers. No new
flag, owner cache, duplicate preparation, discarded anonymous claim or credential
consumption is introduced. This deliberately confines automatic future history
attachment in these two research adapters to the enabled hosted-history path;
link/unlink/whoami control functionality is unchanged. OFF research does not infer
an owner from a payer, recipient, wallet or channel.

When enabled, the exact provider-derived recipient still passes to the real
`linkedChatOwner` service before the single claim preparation. Its existing
non-enumerable port resolves the current confirmed membership through the
unchanged native store. Lookup failures remain fail-closed: no anonymous fallback
on uncertainty. Telegram claim and private-placeholder refusals still precede
preferences and research; Slack's private URL gate still precedes storage.

Anonymous collect inputs retain their original exact shape. Explicit
`fundingOwner: "treasury"` accompanies a linked `asker`; anonymous inputs rely on
the existing runner default. `lib/agent/run-agent.ts` uses
`input.fundingOwner !== "browser"` for outside-funded asker exclusion and emits
`gateway.mode === "offline" ? "offline" : (input.fundingOwner ?? "treasury")`.
Thus omitting the redundant anonymous field preserves actual treasury/offline
semantics rather than changing funding authority. Exact unknown ownership
provenance, surface, question and budget remain unchanged. There is no public
contract change requiring fixture correction.

## Controls and remaining delivery

All original tests, assertions and deadlines are retained as an exact byte
prefix in each of the two existing test files. Eight appended UNRUN cases use
the real signed/secret-checked POST and actual linked-owner service, with explicit
synthetic downstream ports: linked/unlinked/uncertain for both adapters, plus
Telegram private-reply and claim refusal. They check exact recipient and binding,
single preparation with the resolved owner, treasury/unknown provenance inputs,
ordering, no chat mutations, and no paid-research fallback on uncertainty. These
fixtures do not independently prove native membership authenticity; the earlier
genuine native evidence remains separately bound and unchanged.

ROOT next performs the small independent payment/security source review and only
the four failed plus eight new cases and types first. Relevant E2E UI/current-main
auth-channel composition, routing build/canonical checks and required PR CI remain
open before the sole coordinator merges and delivers the batch. Unchanged earlier
native/API successes are reusable only for their exact pinned source and inputs.
The frozen English/UI five paths and prior eight other R143 paths remain pinned
in `output/research-compatibility-handoff.json`; the two changed R143 routes have
separate before/after pins. No consent, HMAC, native guard, funding authority,
session proof, auth-channel protocol or provider transport verifier was re-authored.

Affected runtime surfaces are Slack and Telegram research APIs only. Web/desktop,
CLI, MCP, extension and Discord receive no implementation change here; their
combined current-main and distribution acceptance remains ROOT's release work.
No tests, compiler, imports, app, browser, DB, provider, target, ENV, schedule,
spend or Git writer operation was executed by this source worker.
