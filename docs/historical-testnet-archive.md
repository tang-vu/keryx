# Original testnet history after mainnet migration

The mainnet ledger remains separate. Historical public dispatches keep their
original `/dispatch/{id}` URLs, questions, answer records, dates and payment states.
If an ID is absent from the current database, a dedicated read-only reader checks
the retained Arc testnet snapshot. Current records take precedence; a current
database error is not treated as a missing record.

Browse every retained public question at `/history/testnet`, with stable cursor
pagination through `/api/history/testnet`. This includes uncited and zero-payment
runs. Ledger and Proof show a separate testnet evidence panel. The cited-answer
index, topic pages, related links, Atom feed and sitemap also retain historical
entries under their original URLs. Index selection remains bounded to the newest
2,500 runs per corpus; the complete history has separate pagination.

The ledger now leads with the retained testnet track record and creator leaderboard.
Five ranked source/wallet entries appear immediately; expand to inspect all entries.
The full history page shows the complete leaderboard. Download the original ranking
at `/api/history/testnet/creators`: it returns archive provenance and every source,
recorded display name, recipient wallet, exact integer micro-USDC, payment count
and citation count. A source with multiple recipients has separate entries;
source/wallet pairs are not the distinct paid-wallet count. Historical rows link
only to their original testnet wallet explorer, never current creator profiles.
Current mainnet creator rankings remain a separate section.

`/me/asks` keeps current authenticated wallet history separate from the Arc testnet
tab. `/api/me/asks?network=arcTestnet` accepts only the current verified session's
wallet; it imports no historical session or login authority. The retained snapshot's
largest attributed wallet history is 93 rows, within the 200-row historical view.
Anonymous asks are not assigned to a new account.

## Evidence and authority

- Every archived page identifies Arc testnet and the snapshot cutoff. Historical
  creator/source identities are not current payout authority. No live freshness
  or feedback write is claimed for a frozen record.
- New follow-ups carry only the bounded parent question into current execution;
  current funding, source discovery and payment admission remain unchanged.
  Cross-network parents/children are labeled, and monetary deltas are not compared
  across networks. Optional thread outages preserve the completed answer.
- The reader uses native SQLite read-only mode, verifies a pinned database SHA-256,
  refuses WAL/journal sidecars and foreign-network rows, and checks file identities
  on reads. It performs no initialization, migration, enrollment or reconciliation.
  Frozen source/item provenance still demotes synthetic demo material.
- Creator totals use original settled rows with recorded settlement evidence,
  exact integer micro-USDC and separate inbound service receipts. Pending, failed
  and simulated states are not settled money. Channels and wallet attribution do
  not establish independent people or current-event traction.
- Portable receipts retain the exact v1 envelope and integrity contract. Archive
  network/cutoff/source/hash are response headers, not invented fields in a signed
  or checksummed payload. A zero-payment downloaded v1 receipt needs accompanying
  provenance headers/page; historical A2A prepaid funding is omitted rather than
  reconstructed from current mainnet authority.

## Protected deployment configuration

Set `KERYX_TESTNET_ARCHIVE_MANIFEST` to an absolute protected JSON path. Its shape is:

```json
{
  "version": 1,
  "network": "eip155:5042002",
  "capturedAt": "2026-10-03T00:26:18.665Z",
  "sourceCommit": "f9dca8d04f4657abbf0153175feec65728ba6a99",
  "database": "/absolute/protected/original.sqlite",
  "databaseSha256": "c5d9c0d2bf01099de526d7510321eabd1b0e3519f2792d40b61e49062d766272"
}
```

Keep the snapshot, manifest and original recovery artifacts outside Git and public
static paths. Preserve original backup bytes; never restore them over mainnet
storage. No archive path is accepted from HTTP requests. If the archive is unavailable,
its routes report that condition while healthy current history/metrics remain usable.

Read-only acceptance, including the three reported old URLs and complete pagination:

```text
node --import tsx scripts/inspect-testnet-history.mts --manifest ABSOLUTE_MANIFEST
```

The retained snapshot contains 3,280 questions through October 2, 16:56:42 UTC,
11,314 settled creator payment rows totaling 56.748064 **testnet** USDC, 636 inbound
service receipts, and one pending 0.002 testnet-USDC access attempt at capture time.
These are historical database evidence, not mainnet revenue, new customers, or
event-period growth. Later external reconciliation evidence can supplement the
dated record without silently rewriting its frozen payment state.

## Supported surfaces

Web and public APIs restore direct pages, history, metadata, OG and portable
receipts. Existing remote MCP, OpenAI-compatible, extensions and bot dispatch links
use those restored URLs. CLI, stdio MCP and desktop receipt consumers retain the v1
schema; this hosted restoration requires no changed local installer or package
contract. Current paid-job polling, private job history, private results, wallets,
grants and workers keep their selected-network authority; they are not redirected
to historical storage. No testnet signing service or scheduler is started.
