# Preserve source context in evidence review

Three ordinary owner-operated production questions completed on v0.26.9: Next.js
self-hosting, systemd shutdown and SQLite live backup. All receipts passed integrity
checks, but independent grading accepted **0/3 complete useful answers**. Next.js
acquired no official documentation; systemd and SQLite returned partial excerpts.
No paid-source attempts or source USDC settlement occurred. These are actual client
runs, not independent customer traction or validation of paid mainnet settlement.

The SQLite result exposed an unconfirmed forum proposal without its neighboring
qualification, and an admitted excerpt ending mid-sentence. Retained receipts lack
full original reads and verifier input. Regression fixtures assembled from those
excerpts are explicitly synthetic, not byte-for-byte replays of the original context.

## Correction

The legacy generator selects a server-created quotation ID. Internal proposals now
carry exact UTF-16 read offsets. Only intact sentence spans of 8–240 characters are
offered. The deterministic ledger rejects missing offsets, altered text, partial
sentences and the final span touching a known extraction or 200,000-character scan
cut, regardless of model confidence. Heuristic and staged brief proposals carry
the same binding. Historical records are not rewritten.

The existing separate review receives the recorded item URL, version, delivery/truncation
metadata, quote offsets and up to 1,200 contiguous neighboring characters. It must
account for qualifications, proposals, questions and instructions in untrusted text.
Binding failures and rows exceeding the 32,000-byte input ceiling lose authority;
context is not silently shortened to admit them. Existing provider limits still
apply. No review retry or additional model call is introduced; output limits remain
unchanged. Private context and offsets do not enter public receipts, exports or SSE.
Public reads retain the fetched final URL; paid/cache reads retain existing catalog
URL trust. This is not independent proof of the paid transport's document origin.

A narrow source-role gate recognizes explicit English/Vietnamese requests for
official documentation and known discussion URL shapes. It preserves slots by
withholding incompatible previews/reads and checks the final observed URL before
evidence admission. Other URLs are **not** thereby verified as official. Discussion
research and mixed-source comparisons retain their own targets; creator ownership
proof is not evidence of document authority.

## Limits and release gates

Sentence segmentation is structural, not factual or semantic proof. Long sentences,
unpunctuated text and ambiguous abbreviations can be withheld. Bounded neighbors may
still omit distant qualifications. The URL/language classifier is limited; source
acquisition, full-answer support and unverified reasoning-trace assertions remain
open quality work. This correction has no new paid evaluation. Richer decision
briefs remain disabled after three failed candidate evaluations.

Release requires deterministic context/boundary tests, shared payment/SSE/receipt
regressions, TypeScript, lint, production build, required CI and independent review.
Passing these gates permits this correction, not a claim of recovered autonomous
usefulness. Fresh finite empirical authorization and independent user acceptance
remain required.

The completed USD2 round is closed: retained model holds USD0.515162 development
plus USD0.351220 production, and search reserve USD0.048, total **USD0.914382**.
These are reservations, not invoices. Exactly three production client questions
were submitted once each. The remainder does not reopen the round or authorize
more questions, model calls, source payments or top-ups.

## Supported surfaces

Web/SSE/history, API, A2A, remote MCP, OpenAI API, bots and extension share the server
correction. Repository engine/CLI uses the same ledger with existing custody and
search opt-ins. Buyer CLI and stdio MCP consume hosted results; Operator/desktop
inspect saved receipts and use explicit buyer handoff. Result/receipt schemas and
payment authority do not change. Exact package/bundle and deployment verification
must precede claims of synchronized distribution; publishing is not installation.

Paired executable builds against d6332a1, holding the source-commit define constant,
are byte-identical for desktop helper/renderer/bridge/CSS, MCP and extension inputs.
Desktop remains 0.4.4, MCP 0.4.3 and extension 0.1.1. Lazy sentence-segmenter
initialization avoids adding a side effect to receipt consumers that import only
the existing support threshold. Release source stamps/native manifests still
require exact-source CI and asset verification; npm's unchanged package is not
republished solely to change provenance.
