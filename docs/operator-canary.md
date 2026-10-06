# Finite Operator business acceptance

October 6, 2026 candidate: app 0.27.4. This implements a private, single-host
acceptance window for the [hosted business Operator](operator-business.md).
Code, synthetic tests and publication do not establish funded acceptance.

The owner authorized a 24-hour canary, at most three original orders, total
source/reward/fee/gas spend at most 1 USDC and model/search spend at most $0.25,
stopping new attempts on ambiguous settlement. This first implementation narrows
that authorization to **one** Quick original and **no creator payments** while
the verified creator catalog is empty. It cannot manufacture a creator or claim
independent customer revenue. Creating a new buyer wallet is separate from
authorizing its funding source; keep its key local and preserve custody backups.

## Frozen admission and retained limits

An unsigned `buyer prepare` obtains the real quote and records a new immutable
request, recipient, price, authorization nonce, network/domain and intent digest.
It has no signer. Quick package 1.0.0, creator cap 0.01 USDC, async response and
quoted total above 0.01 and at most 0.05 USDC are required. The protected policy
freezes that entire original and the execution host/user/home fingerprint.

The trusted POSIX host retains one policy-bound window in
`~/.local/share/keryx-business-canary`; exact owner-only files, non-writable
ancestors, no symlinks, exclusive creation and file/directory fsync are required.
Financial and provider admission must use that same host, user and ledger.
This is not a distributed lock or protection from a privileged operator.
Provision/activate during a positively drained transition of web, paid workers
and existing scheduler writers; the CLI alone does not drain running processes.

Before any buyer signature, the trusted `operator:canary admit` must reserve
the exact original with a retained **60,000 micro-USDC** hold. The local buyer
can invoke it through authenticated SSH using only the public prepared intent;
the private key stays local. A separate local exclusive submission record is
created before signing. Any interrupted signature/submission consumes that
attempt. Recovery polls the original with GET and never signs or POSTs again.
The CLI refuses success when no active canary is configured.
The seller retains a separate exclusive inbound-settlement attempt immediately
before Circle HTTP. Uncertain settlement cannot retry or fall back to another
payload; another POST cannot reopen that attempt on the shared host.

Before Circle verification/settlement, A2A POST rejects any other body, payer,
nonce, recipient, amount or authorization window, bot role, or missing retained
original reservation. An exact unsigned quote may still return 402. The normal
worker uses a targeted atomic claim, not whichever job wins FIFO: the original
tuple, body/package hash, immutable purchase authorization and genuine same-rail
settled inbound row must agree. Started/saved/payment-crossed/Monthly originals
and another creator attempt cannot acquire this execution permission.

SQLite checks and claims under its native transaction, including enrolled
mainnet storage. Ordinary Supabase requires service-role-only migration 0081;
missing/invalid RPC results refuse. Sealed PostgreSQL explicitly refuses this
new claim/proof capability pending separate domain enrollment. No REST or
unmanaged-connection fallback substitutes for proof.

## Supplier limits and closure

Only the exact paid public A2A original obtains an opaque execution admission.
The fixed official DeepSeek Flash and basic Tavily transports reserve before
HTTP. No provider fallback/retry, paid extract, embeddings, scholarly purchase,
marketplace probe or creator payment is enabled in this canary. Ordinary model
transports and the supplier watchdog are held; context-free calls cannot consume
the canary quota. Cancellation/revocation and late inherited work refuse.

Each model request retains at most 32,000 UTF-8 bytes of authored messages,
including the JSON instruction, at most 8,192 generated tokens and a conservative
4,096-token framing allowance in its financial forecast. Oversize requests refuse
without truncating evidence. The October 6 official
[DeepSeek tariff](https://api-docs.deepseek.com/quick_start/pricing/) bounds each
call at **20,660 micro-USD** using peak uncached-input and output rates. The
[API contract](https://api-docs.deepseek.com/api/create-chat-completion/) caps
generated tokens through `max_tokens`.

The [Tavily basic PAYG tariff](https://docs.tavily.com/documentation/api-credits)
reserves **8,000 micro-USD** per search. Eleven model slots plus two searches
retain at most **243,260 micro-USD** ($0.24326). Missing or interrupted slot files
consume their full bound; provider failures never refund a slot. These holds
are conservative limits, not invoices or observed profit. Earlier provider
allowances/captures remain unchanged and cannot renew this window.

Supplier permission ends at **2026-10-07T00:00:00Z**, earlier than the owner's
24-hour authorization. A changed digest/host, expiry, malformed/missing retained
manifest or removed selectors holds new work. Do not delete, copy, rename or
reset the registry to obtain another quota. A finite owner window is not a
recurring schedule.

`operator:canary close` performs metadata-only verification, including after
expiry. It requires the retained original hold, native same-original inbound
settlement, completed order, matching saved real QueryRun/accounting and zero
creator attempts. It exclusively writes and verifies a terminal record. Only
after that verified closure may the trusted operator remove selectors to resume
ordinary admission; all holds and journals remain. A failed/ambiguous original
requires review and does not automatically restore admission.

## Surfaces and remaining gates

### Failed delivery and retained admission

The October 6 owner canary settled its single 0.03 USDC inbound order, then
failed research before saving an answer. Native original-settlement proof was
verified; no creator attempt or result-save boundary occurred. One model and
two search holds retain an upper bound of $0.03666. These are reserved maxima,
not observed provider invoices. The owner trial establishes neither delivered
usefulness nor independent revenue. Its original is never re-signed, requeued
or submitted again.

App 0.27.4 adds distinct private `verify-failed` and `close-failed` operations.
They require the exact settled failed original, journal version 1, an existing
start, no payment/result boundary, no saved run and no creator attempts. Closure
commits the complete protected provider-file inventory and retains every hold.
An ambiguous, malformed, changed or partially saved original cannot use this lane.
The record explicitly says delivery is incomplete, no refund is proved, and the
paid-delivery obligation remains unresolved. It changes no database/payment state.

After a positive drain, this record permits restoring observation and original
GET recovery with selectors removed. **It keeps new paid research and supplier
transports held.** It does not release business admission or erase the customer's
charge. A separate reviewed fulfillment/refund resolution with its applicable
authority is required before that hold can be lifted. Do not replace this marker
with a completed marker, clear provider slots or renew the expired allowance.

Worker failures now retain only closed stage/category diagnostics in the private
Operator outcome audit and sanitized worker log. Raw exception messages, stack,
questions, prompts and provider response bodies are excluded. The prior canary
did not retain its exact exception, so its retrospective cause remains unknown.
Oversized source-selection inputs are a demonstrated failure mechanism: selection
now partitions the actual serialized messages before any model request, preserving
all candidate identities and targets under the same byte/token/provider ceilings.

Web/API, OpenAI-compatible, remote MCP and sponsored bots share the hosted
admission hold. Existing authenticated original GET/status/delivery recovery
remains available. Private workers pause before scans/claims; previously stored
private results remain recoverable. Browser model discovery uses no-store so a
dated ordinary picker is not retained as current permission.
Monthly and private purchase guards recheck after waits and before vendor
exposure. Source-content and citation seller endpoints retain their independent
caller-funded role; they run no research/model job and do not receive canary
treasury or buyer signing authority.

The private CLI adds prepare/submit and finite metadata operations. Desktop
continues GET-only local recovery with no signing, canary provisioning, secret
transfer or scheduler. Its helper imports the GET-only buyer module separately
from submission/policy code, requiring fresh desktop 0.4.7 source-bound artifacts.
Stdio MCP 0.4.6, remote protocol 0.3.2 and
extension 0.1.1 retain their roles; distribution bytes/versions must be checked
against the final source before claiming unchanged or synchronized delivery.

The failure/selection fix does not enter the shipped stdio MCP or desktop GET
recovery graphs. In-memory builds with their accepted source pins match the
published MCP 0.4.6 and desktop 0.4.7 helper/renderer bytes. Retain the existing
desktop installer at its `2acbf20` provenance. A new-source build changes embedded
commit identity and requires its own artifact/publication readback; it must not
be described as that unchanged installer. Repository buyer submission receives
the new admission guard. Hosted web/API, remote execution, extensions and bots
receive shared execution holds through the application deployment.

Required acceptance includes protected-file/process concurrency and adverse
tests, actual isolated PostgreSQL SQL/ACL checks, TypeScript/lint/build, exact
source CI/review and production health/runtime verification. The approved live
original additionally needs a known funded buyer, verified payee, useful delivered
answer, retained original settlement/provider records and explicit uncertainty
handling. Funding, real execution and accepted usefulness remain separate gates.

A general contract policy wallet is still open. Circle
[Nanopayments excludes ERC-1271](https://developers.circle.com/gateway/references/erc-1271);
ordinary Gateway contract-signer transfers have a different protocol. A bounded
on-chain transfer to a separate buyer can cap released capital but does not
enforce each creator payment. Do not relabel an EOA, application cap or internal
canary as that contract. Creator rights/payout verification, independent business
use and the under-three-minute Tameion demo still need real evidence.
