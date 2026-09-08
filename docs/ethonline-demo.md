# ETHOnline 2026 demo rehearsal

Prepared against `d80de4d` / v0.22.9. This is a proposed three-minute recording,
not an asserted event video requirement or a completed recording. Publisher onboarding
is now complete (see the registration evidence in `docs/engineering/`); the paid
first-party corpus scene still requires a verified paid job.

## Opening pitch

> Keryx turns a research question and a USDC budget into an inspectable agent job.
> It decides which sources to read, pays access tolls, writes a cited answer, and
> allocates creator rewards only through its evidence gates. During ETHOnline we
> added a buyer workspace and an independent buyer client, then used failed pilots
> to improve question interpretation, quote selection and evidence review.

## Recording sequence

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:25 | `/research`, Quick package, question and creator cap | The displayed total includes service fee and creator cap; this workspace prepares the request rather than signing a purchase. |
| 0:25–0:50 | Downloaded request and unsigned buyer `quote` result | The buyer pins a trusted payee and an all-in limit before signing. Quote success is not payment or a started job. |
| 0:50–1:20 | A verified testnet purchase, then `resume` using its original journal | The journal is written before submission. Recovery polls the same job without signing again. Only show this scene once actually verified. |
| 1:20–2:05 | Completed result, agent decisions and evidence on the available result/receipt surface | Explain a real BUY/SKIP/CACHE decision from this run and a quote linked to its research target. Do not invent a decision absent from the run. |
| 2:05–2:35 | Quality and creator accounting in `/research`; CLI receipt verification | Completion, evidence coverage and settlement are separate. Show actual settled/pending/unknown values. |
| 2:35–3:00 | Continuity delta and limitation | Workspace, buyer recovery and research-quality changes are event work; the existing payment rails predate ETHOnline. First-party tests are not external adoption. |

Suggested question after the Engineering source is onboarded:

> How can a Keryx buyer recover a job after losing the submission response without paying again?

Use the actual result, including gaps. A recording of a model-only evaluation must be
captioned **First-party model evaluation — no purchase or settlement**. If onboarding
is still pending, use request preparation plus the existing verified pilot result,
and explain its insufficient coverage. Do not splice a successful model-only answer
into a paid job's result or imply that it came from that purchase.

## Rehearsal commands

Start from the repository root. The buyer key belongs only in the private environment
file described in [buyer-agent.md](./buyer-agent.md); the npm script loads that file.
Download `request.json` from the workspace into an existing private `.buyer-jobs` folder.
Choose a fresh private job directory for a new purchase. Replace the payee placeholder
with the independently verified public treasury address. The cap below is an example;
use the live quote to decide whether the requested job fits it.

```bash
# Unsigned: does not start research or pay.
npm run buyer -- quote --request .buyer-jobs/request.json --payee 0xYOUR_VERIFIED_KERYX_PAYEE --max-total 0.10

# Paid Arc-testnet purchase: run once, only when ready for this pilot.
npm run buyer -- buy --request .buyer-jobs/request.json --payee 0xYOUR_VERIFIED_KERYX_PAYEE --max-total 0.10 --state .buyer-jobs/ethonline-demo-1

# Recovery: same journal, GET-only; do not buy again to recover.
npm run buyer -- resume --state .buyer-jobs/ethonline-demo-1 --watch
```

Confirm the journal exists before interrupting a buyer process for a recovery scene.
If submission state is uncertain, preserve the journal and follow the buyer runbook;
do not force a second purchase to make the recording appear successful.

## Architecture to show

```mermaid
flowchart LR
  Workspace[Buyer workspace: price and request] --> Buyer[Buyer CLI: cap, journal, signature]
  Buyer --> API[Paid async API: service payment and durable order]
  API --> Worker[Research worker]
  Worker --> Agent[Discover and decide BUY / SKIP / CACHE]
  Agent --> Access[Source content and access tolls]
  Access --> Evidence[Synthesis, relevance review and evidence ledger]
  Evidence --> Rewards[Weighted creator reward attempts]
  Rewards --> Receipt[Answer, quality and settlement receipt]
  Receipt --> Poll[Buyer GET recovery and receipt verification]
  Poll --> View[Workspace result view]
```

The buyer's service payment and the worker's downstream creator payments are different
legs. Review scores are model assessments; the ledger checks exact evidence links and
limits reward eligibility. SourceRegistry remains payout authority when available.
See [the paid API contract](./a2a-paid-research-v2.md) for the full trust boundaries.

## Evidence and recording checklist

- Confirm `/api/health` reports the intended release before recording; keep the
  actual commit and timestamp in rehearsal notes.
- Run `node --import tsx scripts/build-engineering-feed.mts --check-remote` before
  registering the first-party source. Verify the chosen owner, registry listing and
  full-text previews before buying a new source-backed pilot.
- Record the live quote and all-in cap; do not present an example cap as a price promise.
- Show the CLI's actual verification outcome. Digest consistency does not establish
  answer truth or independently confirm Circle settlement.
- Keep keys, environment files, journal contents and bearer job identifiers out of
  the recording. Crop or blur their display; do not alter a receipt and claim its
  original digest verifies the altered copy.
- Distinguish testnet from mainnet, owner-operated pilots from external customers,
  and seller-reported settlement from independent chain finality.
- Keep actual answer gaps and payment ambiguity visible. An unused creator reserve
  under the fixed-price package is not an automatic refund.

## Closing narration

> The result is more than generated text: it includes what the agent chose to read,
> which evidence supports the answer, and what happened to creator payments. Our
> early paid pilots exposed real research failures. The current checks improve those
> cases, but broader reliability and external-user validation remain work to do.

Event history: [continuity build log](./ethonline-2026.md). Reproducible quality
checks and their limitations: [dated evaluation](./engineering/evaluation-2026-09-08.md).
