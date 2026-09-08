# Keryx engineering publisher kit

**Registered on Arc testnet:** [September 8 registration evidence](./registration-2026-09-08.md).
Both full articles are indexed and RSS ownership is verified. The subsequent
[paid pilot](./pilot-2026-09-08.md) verified access and citation payments, with partial
research-quality coverage.

A [September 9 paid follow-up](./pilot-2026-09-09.md) reached the evidence threshold
on both substantive targets using the cached article, with a new citation reward.
It is one owner-operated result, not a broad reliability claim.

These dated, first-party notes provide complete source material for researching Keryx's
own behavior. They are documentation, not independent corroboration or external creator
traction. Their implementation references are pinned to the inspected code revision.

The complete article bodies are public in this repository and in `feed.xml`. Publishing
this kit does not register a source, choose a payout wallet, verify feed ownership or
make a payment. It does not make this public material exclusive paid content.

## Build and verify the feed

```bash
node --import tsx scripts/build-engineering-feed.mts
node --import tsx scripts/build-engineering-feed.mts --check
```

The check passes the generated RSS through Keryx's real ingestion parser and verifies
that each full article survives ingestion. It also refuses a stale checked-in feed.
No environment file, API key, database or payment connection is needed.

Before registering the source, run:

```bash
node --import tsx scripts/build-engineering-feed.mts --check-remote
```

This read-only preflight checks the local feed first, then compares the published GitHub
RSS with it using a bounded network request. It fails if publication is stale or unavailable.
It does not overwrite files, claim feed ownership, register a source or make a payment.

The feed URL after pushing is:
https://raw.githubusercontent.com/tang-vu/keryx/main/docs/engineering/feed.xml

## Publish through the existing creator flow

1. Choose the publisher's own wallet and use Keryx's normal source registration flow.
2. To prove control, add that wallet's `keryx-verify:0x...` token to the channel description
   in the feed builder, regenerate and push. Never use a buyer's address by assumption.
3. Register the feed with the name **Keryx Engineering (first-party)**. Complete the normal
   wallet and feed-ownership checks. SourceRegistry remains payout authority.
4. Verify that the article previews report full-text delivery and the intended source
   owns the listing before starting a bounded, owner-operated testnet pilot.

Registration at `https://keryx.cc/register` uses a signed SIWE session. With the registry
configured, the API prepares metadata and transaction parameters; the connected owner
wallet must sign the registry transaction. A supplied wallet field cannot replace the
session wallet. After indexing, verify RSS ownership from the same wallet session.
Do not interpret API preparation alone as an on-chain registered source.

The owner requested a dedicated Arc-testnet publisher wallet, now identified in the feed
by `keryx-verify:0x6644A7C63C559454e77D5834554DCa3a60fcFDA2`. Publishing this token
does not by itself complete registry registration. A later publisher-signed content manifest is a separate feature; RSS delivery
depth alone is not a cryptographic publisher signature.

For revisions, add a new dated article and feed entry rather than rewriting a published
body. Feed refresh deduplicates by article URL, so an edit at an existing URL is not
automatically imported as a new item. Existing paid receipts must retain their meaning.

Suggested validation questions:
- How does Keryx distinguish access tolls from citation rewards, and which evidence checks gate rewards?
- How can a Keryx buyer recover a job after losing the submission response without paying again?

Evaluate these against the full articles with exact-quote checks. Report model-only
evaluation separately from a paid end-to-end pilot, and all first-party use separately
from external adoption.

See [the September 8 evaluation](./evaluation-2026-09-08.md) for the actual partial
results and remaining model/quotation failures. This kit is not a claim of pilot success.

## Reproduce the quote-selection experiment

`node --import tsx scripts/eval-quote-selection.mts --check` verifies, without API calls,
that the journal-before-signing sentence survives RSS ingestion, passage selection and
the quote menu. The default invocation also performs only this fixture check.

For an opt-in live comparison, set `KERYX_LLM_MODEL` and `KERYX_SYNTHESIS_MODEL` to
`deepseek-v4-flash` and run:

```bash
node --import tsx --env-file=.env.local scripts/eval-quote-selection.mts --live
```

This performs three interleaved runs each of the production prompt and an experimental
evidence-first prompt, up to 18 model requests. It uses the direct configured DeepSeek
engine without fallback, database access or payment calls. It incurs model API usage.
Original proposal scores, reviewed evidence and final ledger coverage are saved to a
timestamped file under ignored `.artifacts/evals/`. Completed rows survive a later error.
The expected-quote flag checks one known sentence, not overall answer correctness.
The experimental prompt does not change production behavior; these small repeated runs
are diagnostics, not a quality pass/fail gate or an independent factual benchmark.

For fixed question/quote pairs that isolate the reviewer from synthesis selection, use
`node --import tsx scripts/eval-evidence-review.mts --check`. Adding `--live` instead
of `--check`, with the same environment/model setup above, runs six reviewer requests:
three each against the frozen v0.22.7 prompt and the current prompt. The 18 manually
labelled pairs include direct/partial support, wrong timing, absent mechanisms,
hypothetical behavior and instruction injection. Reports retain scores and model review
output under `.artifacts/evals/`; model errors fail rather than using fallback. Labels
and thresholds are diagnostic expectations, not proof of overall answer quality.

`node --import tsx scripts/eval-research-boundaries.mts --check` validates five broader
fixtures without model use. With `--live` and the same environment setup, it evaluates
receipt binding/history, explicit negative answers about coverage/finality, absent SQL
details, a title-only source and empty input (up to 15 direct model requests). It saves
assessment, prose, evidence and coverage under `.artifacts/evals/`, and exits nonzero
on a model error or an unexpected coverage boundary. Expected negative answers are
answerable; absent evidence must not authorize rewards. Passing thresholds does not
independently verify prose correctness, payment behavior or external adoption.
