# Evidence procurement

Owner direction, October 12, 2026: implement the strongest Tameion idea first,
then its supporting improvements. The ranked sequence is (1) commission missing
evidence, (2) compare proposed coverage against price, (3) retain useful supporting
and refuting evidence equally, and (4) produce a decision receipt. The owner
confirmed no participating buyer or provider yet and requested a usable product
before a real pilot. No external contact, payment, funding or custody change is
authorized by this implementation.

## First usable slice

`/operator/evidence` is a private, portable request/quotation/delivery workspace.
Create an evidence request with concrete questions, priorities, an expiration,
an explicitly recorded Arc network and a quote budget in integer micro-USDC.
One USDC is 1,000,000 micro-USDC. Quotes are proposals, not prices of an admitted
source purchase or balances available to spend.

Providers can sign a quotation message binding the complete request digest,
their EOA wallet, source URL, delivery terms, exact quoted amount, proposed
requirements, expiration and nonce. A separate delivery signature binds that
quotation, the body hash and the exact UTF-16 excerpt spans and declared stances.
The versioned messages explicitly authorize neither payments nor source ownership.
Contract-wallet signatures requiring a chain observation are not supported in
this CPU-only slice. Never paste a private key or a payment authorization.

Keryx ranks eligible supplied offers by proposed missing-priority per micro-USDC.
It uses integer cross-products, deterministic ties and cumulative selected quote
costs. Signed free offers are allowed. Unsigned, altered, conflicting, expired,
foreign-request and unaffordable offers have visible refusal reasons. Duplicate
offer IDs or provider nonces withhold every conflicting member. Expiration does
not erase a selected quoted commitment or establish a refund.

Selected requirements remain missing until a review bound to separately signed
delivered bytes declares them resolved. Supporting and refuting excerpts can both
resolve a question; inconclusive excerpts cannot. The signature authenticates
attribution and bytes only. Exact slices do not certify truth, semantic entailment,
reproducible benchmark execution, registry ownership or payment. Provider coverage
and stance are declarations; reviewer identity, notes and acceptance are caller
declarations, not authenticated independent customer acceptance. Changed request,
offer, delivered body or excerpt bytes invalidate their downstream bindings.

The result contains the original validated packet, recomputed hashes, quote-budget
account, recommendation, exact excerpts, review state and `payment.status:
not-observed`. It must not be counted as settled traction or creator earnings.

## Privacy and supported surfaces

All imports are closed version-1 JSON packets, at most 65,536 actual UTF-8 bytes,
with bounded nesting, arrays, regular text and unique requirement IDs. Restore
imports the original packet and recomputes all outputs; a saved result or a
caller-supplied `settled`, `payTo` or `sourceId` field cannot confer authority.
The browser holds data in tab memory. Deliberate downloads are private plaintext;
choose a private destination. Closing or reloading loses edits without an export.
Remote MCP retains its existing 65,536-byte cap on the entire JSON-RPC body, so
the tool envelope reduces the packet size available over that transport.

The browser wrapper's labels, notices and named text templates use the separate
English source catalogue `locales/en/evidence-procurement.json`; this adds no
locale selection, translation approval or support for additional languages.

| Surface | Role |
|---|---|
| Web | Create, inspect, export and restore the portable packet at `/operator/evidence`; computations stay in the browser. The decision receipt selector offers JSON, Markdown and CSV. |
| API | Authenticated `POST /api/research/evidence-procurement`; optional single `?format=json`, `markdown` or `csv`; export scope, exact-origin cookie policy, bounded input and private/no-store responses. Authentication may access the existing account store. |
| Remote and stdio MCP | `evidence_procurement` transforms caller-supplied packets; optional `format: "json"`, `"markdown"` or `"csv"`. Structured procurement stays unchanged; text contains the selected receipt. Messages can be retained by the caller's MCP client. It never contacts a provider or purchases. |
| CLI | `npm run evidence:procurement -- --file private-packet.json`; optional `--format json\|markdown\|csv`. Default/json `--out NEW_FILE` publishes the original packet for restore; Markdown/CSV `--out NEW_FILE` saves the receipt. All writes refuse overwrite. |
| Desktop | Browser workspace and CLI file handoff; no new native helper, task journal, installer or local scheduler authority. |
| Extension and bots | Existing research roles; the workspace is available by URL. No private packet is automatically forwarded through a bot or extension. |

This shared evaluator performs no network, model, provider, storage or payment
I/O. API authentication, CLI file handling and explicit browser downloads have
their stated effects. The source URL is not fetched or certified by this tool.

## Readable decision receipts

The default JSON contracts are unchanged. Only the original validated packet is
restorable; JSON results and Markdown/CSV receipts are inspection artifacts.
Readable receipts include the observation time, request and content bindings,
exact integer quote amounts, all supplied quotations and refusal reasons,
requirement states, attributed excerpts and caller review notes. Rejected
deliveries expose no attributed excerpt text. Neither signatures nor a formatted
report establish factual truth, source ownership, customer acceptance or payment.

Browser receipt downloads preserve the displayed observation, even if a quote
expires afterward. Reinspect the packet to obtain a current decision; downloading
a historical receipt does not refresh it or reserve funds. Edits, account changes
and closing the workspace invalidate pending formatted downloads. API, CLI and
MCP rebuild the original packet at the current inspection time.

Markdown escapes supplied prose and quotes it as literal text. CSV uses a
`record_type` column: one request row, requirement rows, one row per supplied
quotation, delivery rows, attributed excerpt rows and caller review rows. Quote
prices occur only on quotation rows, so repeating excerpts does not multiply
costs. Filter by record type before aggregating. Formula-like cells, including
those with leading whitespace or Unicode control/format characters, receive a
leading apostrophe. This presentation safeguard changes that CSV cell's literal
text; the original packet retains the exact input. CSV uses quoted cells and CRLF
records, including proper quoting of embedded newlines and quotation marks.

Each requested formatted receipt is limited to 524,288 actual UTF-8 bytes and
refused without truncation if larger. Non-displayable C0/C1 controls other than
tab, CR and LF also refuse formatted export. Neither restriction changes the
original packet/JSON contract. An export failure leaves the packet and displayed
inspection available for JSON download. Keep downloaded receipts as private as
the original packet; no additional upload or automatic sharing occurs.

## Remaining gates

This is a request and evaluation artifact, not a funded marketplace or a completed
autonomous business cycle. The existing research/buyer, x402, original payment
journal, SourceRegistry and actual citation evidence remain the only payment and
reward authority. No imported quote or review is admitted to a signer.

Next delivery needs an owner/provider journal with atomic revisions, authorization,
idempotency, expiry and crash recovery; separately accepted storage enrollment;
explicit provider-discovery/contact consent; verifiable original delivery and a
reviewed handoff to the original buyer. Shared production DDL, background schedules,
new custody and mainnet spending retain their existing explicit authorization gates.
Before a real pilot, obtain an independent legitimate buyer, providers with content
rights, a concrete task, source/payout authority and a finite approved economic
envelope. Do not populate fake providers or fabricate payment evidence to close it.

Acceptance for this slice requires adversarial signature/binding/budget tests,
private API failure tests, browser export/restore and stale-output tests, CLI/MCP
parity, TypeScript, lint, production build, source review, required CI and verified
deployment/publication. Source delivery is not independent usefulness evidence.
