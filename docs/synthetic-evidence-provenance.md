# Synthetic demo evidence

Synthetic source authenticity is separate from payment settlement. The authored seed
corpus, including the 178ms/240ms Arc benchmark and its conflicting pair, is illustrative
demo content. It cannot establish actual empirical settlement speed.

`Source`, `SourceItem` and recorded article identities carry trusted optional
`evidenceProvenance: "synthetic-demo"`. Public registration never accepts that
classification from caller input. Internal seeding writes it before storing items.
Ordinary real research excludes classified publications and classified items in mixed
publications before model selection, caching, paid reads or evidence qualification.
Display names, IDs, URLs, ownership verification and real settlement are not factual
eligibility authority.

Storage computes plaintext hashes before encryption and classifies exact known seed
copies even when public uploads carry no provenance flag. Research admission and the
evidence ledger also reject the checked title/URL/body-hash fingerprint before factual
qualification or citation rewards; they do not wait for a later startup backfill.

Explicit offline research may exercise the authored demo pair and simulated citation
rewards. Its answer and citations identify illustrative content. Final factual coverage
and evidence qualification exclude synthetic excerpts even when demonstration payments
are simulated. A historically real payment remains real settled testnet money.

## Existing rows and deployment gate

SQLite's ordinary schema installer and Supabase migration
`0079_synthetic_evidence_provenance.sql` backfill known corpus rows only when exact
article title, summary and link match **and** the complete plaintext body or stored
plaintext body hash matches the repository corpus. Ciphertext, keys, manifests and
payment rows are unchanged. A publication is marked only when every attached item is
classified; a mixed publication retains item-level exclusion. Sticky storage guards
prevent normal refreshes and old writers from erasing known classification.

Read-only inspection on October 3, 2026 confirmed that the existing deployed benchmark
item `11203a0e-e458-421d-9722-a6a243f1f779` and both Onchain Micropayments Digest items
match the exact metadata and stored body hashes. All three use `db_encrypted` storage.
The benchmark body hash starts `0xcc0a59349dd16c4499`; its retained article version
starts `sha256:f1823c1d02eb7043`. These differ because article versions bind identity
and stored content, while body hashes describe plaintext. No paid research or content
decryption was needed for this inspection.

Deployment acceptance still requires applying the reviewed schema with ordinary owner
authority, restarting the ordinary SQLite runtime, checking the classified source/item
counts, and retrieving dispatch `a455ae08-114b-4532-8680-c0049b3a6c4f` and its refreshed
receipt. Confirm the S4 demo designation, zero factual support for its latency claim,
valid receipt digest, and unchanged real payment legs/totals. Do not rewrite old saved
receipt bytes or their independently retained digests. After original digest verification,
derived exports can recognize the checked corpus title/URL/body-hash fingerprint and
label it illustrative without changing those original bytes. Missing strong fingerprints
require a fresh projected receipt when updating a previously downloaded historical artifact.

The staged enrolled Supabase runtime pins its earlier reviewed source schema. This
migration does not authorize silently replacing that profile or an enrolled store's
identity. Fresh source-contract capture, profile review and enrollment migration remain
gates before activating that optional lane against the changed schema; mismatch must
refuse. The deployed ordinary TypeScript path remains authoritative.

## Historical and transport behavior

Historical reads use a request-local, metadata-only lookup, deduplicated across each
page and bounded to 500 source/item IDs per database operation. They do not read paid
bodies or decrypt content. Archived prose stays inspectable under a prominent notice;
synthetic citations/excerpts are labeled, lose factual/reward qualification and cannot
raise factual claim coverage or confidence. A newly projected receipt hashes precisely
that visible projection, preserving recorded settlement independently.

Web SSE/history, public archive and feeds, API dispatch/receipts, A2A, OpenAI and remote
MCP share these records. Caller CLI and stdio MCP forward the same API result. BibTeX,
RIS and evidence CSV retain explicit illustrative labels. Operator CLI and desktop
derived exports preserve classification from integrity-checked saved receipts; they
do not enrich old artifacts or acquire payment authority. Extensions and bots keep
their thin consumer role and show/link the labeled answer rather than interpreting
settlement as authenticity. Creator directory, detail and preview metadata expose the
same classification. Direct paid demonstration content remains accessible with its
provenance metadata; access is not factual qualification.

Exact arXiv target coverage is bound to the observed article URL: `gatheredArticle`
stores the reader's final redirect URL as `itemUrl`. The arXiv provider path refuses
redirects to another or unversioned paper and requires the expected PDF or explicit
abstract fallback URL before attaching provider metadata. The evidence ledger checks
that final identity against versioned targets, including bare versioned IDs retained by
decomposition. Discovery metadata cannot override a conflicting observed original URL.

## Validation

Hermetic tests cover null and malformed request admission, zero-budget free Deep gap
reads with paid/read limits, exact encrypted/plaintext backfill and near-match refusal,
mixed catalogs, old-writer provenance preservation, explicit offline illustration,
and retained S4 archive/receipt/export demotion with unchanged settlement records.

`node --import tsx scripts/test-synthetic-provenance-postgres.mts` exercises actual
migrations in an owned network-isolated PostgreSQL 17 container, including sticky
classification, bounded metadata reads, permissions and storage identity refusal.
Docker is unavailable on the development PC; this native PostgreSQL gate must pass in
CI before release. No test uses a real wallet, service environment or payment.
