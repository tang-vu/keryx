# Public activity question projection

The activity endpoint used one full privacy-list read per distinct citation query
to enrich its settled payment rows with question text. The installed-source
read-only diagnosis observed ten such reads materializing about 6.6 million JSON
characters. This source change keeps the financial selection and payload and uses
one bounded question batch instead.

`RunPrivacyStore.questions` is an optional internal read port for at most 32 IDs.
SQLite implements it inside the existing guarded privacy port. A materialized
selection admits only current `public`, nonerased rows with a matching sidecar
before inspecting their original JSON. The reader obtains the question from that
JSON, binds its original ID to the selected storage row, and preserves Unicode
and escapes. The denormalized question column is not its authority.

SQLite returns required metadata and type tags rather than answer text, evidence,
decisions or trace graphs. It requires the original metadata types and heavy-field
shapes, refuses duplicate essential fields, and bounds the stored original to
4,000,000 physical UTF-8 bytes. Malformed or unsupported oversized originals make
enrichment unavailable. This is a separate question projection, not a reconstructed
`QueryRun`, a full-run validation result, publication grant or settlement proof.
The existing full-run reader and its serialized-object limit remain unchanged.

Each read retains the ordinary schema guard and the native wrapper's identity,
source-policy, before/after checks, readonly behavior and terminal refusal. No TTL,
publication cache, schema installation, migration, repair, writer or new custody
authority is introduced. Native transient contention retains its private error
identity and existing recovery behavior. Revocation cannot revive an old port.

`listedQuestions` deduplicates a bounded batch and accepts only requested, unique
ID/question rows. If the optional projection is absent, including the existing
Supabase adapter, it uses the original guarded privacy list once. Supabase retains
its fixed RPC and timeout; no new RPC action, REST read or SQL deployment is needed.
An available reader's error never selects a raw, stale or legacy fallback. The
explicitly inactive legacy path retains its captured behavior. Empty questions
and nonpublic/missing rows remain null enrichment; unavailable activity remains
distinct from a successful empty activity list.

The endpoint still reads at most 80 recent payments, keeps its first 15 settled
citation rows, and preserves their order, source/item/version fields, amounts and
origin. Question projection does not authorize reads of hidden runs or determine
whether a payment settled. Creator profiles and other existing single-question
consumers retain their previous reader in this increment.

A controlled native readonly fixture with ten synthetic large-trace runs returned
identical questions. Three warmed local samples measured 789–826 ms for ten prior
full-list calls and 104–116 ms for one question batch. Runtime guard invocations
were 50 versus 5: the same checks per operation, fewer operations. Serialized port
results were 7,042,671 versus 441 characters. Serialization was outside the read
timer; these counts are not HTTP response bytes or all internal SQLite traffic.
The fixture's database bytes stayed unchanged and no network, model or payment
call occurred. These are local fixture observations, not a production speed,
service-cost, invoice or correctness benchmark.

Focused tests cover canonical/shadow identity, Unicode and lone surrogates,
malformed/duplicate/oversized originals, hidden rows with malformed bodies,
retraction/erasure, native readonly/guard/contention behavior, existing Supabase
RPC wiring, and the actual API's financial payload, caps and empty/error paths.
Existing public/private route, archive, owner/export and native policy tests are
retained. The Unix inode replacement control is platform-skipped on Windows and
requires its unchanged Linux CI coverage. The frozen study's complete 48 trial
objects and four archived originals must remain unchanged when source hashes are
refreshed. Full required PR/domain/native and exact-main checks still apply.

Web, desktop, CLI, API, MCP, extension and bot financial/privacy contracts and
versions retain their current roles. No deployment, release, funding renewal,
schedule or paused migration execution is part of this source work. Supabase's
optional question-only projection, other single-question consumers, Sources
directory overfetch and metadata filesystem verification remain separate work.
