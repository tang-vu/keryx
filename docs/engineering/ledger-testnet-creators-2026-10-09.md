# Activity and retained creator rewards

Application **0.27.47 candidate**, October 9, 2026. The owner requested an Activity
& proof page that makes Keryx's demonstrated work easier to see and restores the
old testnet creator leaderboard.

## Evidence and behavior

Read-only public baseline: the retained snapshot still reports 3,280 questions,
11,314 settled creator payments, 56.748064 testnet USDC and 23 distinct paid
recipient wallets. The preceding restoration exposed summary/question history
without creator rankings. These frozen records include owner-operated activity,
not independent customer or current-event traction.

The ledger leads with this original-network track record and five historical
ranking entries, with an accessible expansion to every entry. The history page
shows all entries and retains complete question pagination. Current network
activity, creator rankings, source discovery and expandable payment evidence follow.
The initial recent-question list has four entries instead of eight; remaining
records and past answers remain reachable. Current opaque source labels can use
exact current source-name metadata for display, preserving IDs, recipients,
recorded descriptive names and all settlement amounts.

## Data boundary

The existing protected read-only archive reader supplies the complete ranking.
Only visible settled fetch/citation rows with recorded evidence contribute.
Prepared/cancelled unexposed authorizations, pending, failed, simulated, service
receipts and operating fees do not contribute. Each recorded amount becomes an
integer micro-USDC value before summing; unsafe aggregates fail closed.

Group by original source and normalized recipient wallet. Multiple recipients
for one source remain separate rows; the distinct wallet count in the summary is
not a source count or a count of independent publishers. Preserve recorded names;
optional frozen source-name metadata may label blank or raw-ID names without
reading content, keys, session authority or payout configuration.

The additive public `GET /api/history/testnet/creators` returns snapshot info and
all ranking entries with no-store responses. An unavailable/unconfigured archive
returns a sanitized 503. Historical wallet links keep the testnet explorer;
archived entries never open current creator profiles. Independent leaderboard
failure retains available summary and questions. File/hash/network/read-only
integrity gates remain unchanged.

## Supported surfaces

| Surface | Applicable behavior and boundary |
| --- | --- |
| Web | Activity & proof, retained history and the shared Proof summary presentation. Original dispatch URLs remain. |
| Public API | Additive read-only archive creator endpoint, documented in OpenAPI. Current metrics keep their contract and add no payment authority. |
| Remote MCP / OpenAI / paid A2A | Existing hosted research/payment contracts and receipt schemas remain. Dispatch/history links reach the updated web views. |
| CLI / Operator / stdio MCP | No imports of changed display/archive modules in distributed execution; versions and signing/recovery contracts remain. |
| Windows desktop | Existing browser handoff reaches updated pages. No shipped native/shared task graph changes; no new installer required for this outcome. |
| Extension / Telegram / Discord / Slack | Existing hosted/page handoff only; no new tool, signer, message or bot behavior. |
| Native Rust / SQLite / Supabase | No schema migration, enrollment, cutover, financial write, custody or schedule change. Immutable archive projection is independent of current storage adapters. |

The preceding coordinated release46 has its own outstanding exact-source
package/installer and production gates. This web outcome does not claim those
distributions published or installed merely because a web health response passes.

## Acceptance

Archive/API regressions cover evidenced-only settlement, all payment kinds and
authorization exclusions, split recipients, normalized wallets, deterministic
ties, complete rankings beyond question/index limits, integer sum safety, optional
old schemas, name fallback, privacy, integrity mutations and explicit unavailable
responses. The current-name regression preserves original monetary/identity fields.

The hermetic Chromium ledger suite uses real components at 320, 768 and 1440 pixels
under mainnet and testnet build labels. It checks section order, exact testnet
denomination, complete expansion, original-network links, archived channel/pending
detail, independent current metrics failures/retry/stale states and existing
source/payment behavior. Every fixture request is intercepted and read-only.
TypeScript in both graphs, lint, production build and independent source review
remain release checks. Production identity/page/API readbacks belong to retained
release evidence; this candidate does not claim missing checks successful.
