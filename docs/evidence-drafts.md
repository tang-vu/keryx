# Private retained-evidence drafts

This source candidate is a manual evidence-drafting increment for issues 282 and
283. It is not an automatic draft verifier or a model-written related-work section.
Expert reference reviews and semantic false-supported/unsupported-statement rates
have not been measured. Neither issue's full acceptance is established.

## Browser workflow

1. In `/literature`, save exact records and mark the papers **Include**.
2. Choose **Build a retained-evidence draft**. Import a retained Keryx report JSON
   returned by API/MCP, containing `id` (or `queryId`), `subClaims`, `citations` and
   `evidence`. The editor accepts up to eight reports within a 64 KiB total packet.
3. Paste your original passage. Select a claim's exact text and add that span.
   Choose its exact cited paper and select retained excerpts. No statement is
   rewritten. Changing passage bytes clears its former spans and assessments.
4. An excerpt match leaves semantic assessment pending. You may record your own
   named supported, partly-supported or not-found assessment. It remains explicitly
   user supplied. Missing retained source evidence always withholds that judgment.
   A not-found assessment is your own observation, never an exhaustive Keryx search.
5. Group retained quotations into themes and edit your synthesis notes separately.
   Selecting/clearing one theme never overwrites another theme's notes. The exporter
   characterises papers only through quotations; author notes remain visibly
   unverified. It does not automatically invent themes, contributions or gaps.
6. Download Markdown/LaTeX and its matching BibTeX/RIS. LaTeX uses `biblatex`,
   `\addbibresource{references.bib}`, `\autocite` and `\printbibliography`. Markdown
   uses the same stable citation keys and includes an explicit reference list.
   The RIS library contains exactly the cited records, although RIS importers need
   not preserve citation keys. Download private draft JSON to retain claim inputs
   and assessments; this version has no draft-backup restore editor.

Passage, report JSON, assessments and theme edits remain in tab memory; no upload,
public history, localStorage draft write or background request is performed by
this editor. The existing bibliography stays in its existing browser store.
Reload/navigation loses the in-memory draft. Downloads are a deliberate retention
choice and should be kept private. The browser profile and same-origin scripts can
access editor contents; no protection against a compromised origin is claimed.

## Shared contract and evidence boundaries

`lib/research/evidence-draft.ts` validates a version-1 `private-evidence-draft`
packet: a saved literature workspace, projected retained reports, original passage,
manual claim spans and themes. Each selected excerpt requires an Include record,
an exact item URL/source/item/content-version/marker match to one retained citation,
the original research claim/index and a qualified bounded quote. Missing version,
unqualified records, ambiguous duplicate markers, synthetic markers and known seed
fingerprints are withheld. Bibliography, matching titles and alternate versions
cannot supply evidence. No alias or redirect resolution is performed: use the exact
saved record URL in the retained read. Reports with a PDF read URL rather than the
saved landing URL need a future reviewed identity adapter, not title matching.

Imported reports are caller supplied. Schema checks and exact matching do not
authenticate their origin or prove the source was read, the quote is verbatim in
the original, or any payment settled. Existing server-side evidence eligibility
flags are a retained-record filter, not semantic entailment. Nonsecurity stable
IDs identify rows; literal row bytes additionally bind user assessments. Changed
claim text, references, selected excerpts or row bytes invalidate an assessment.
Reviewer names and timestamps are assertions, not verified identity or expert review.

Unavailable here means no usable retained excerpt for that exact record. It does
not assert the original publisher is down or that the paper was never read.
Unread/unavailable originals cannot be distinguished from this packet alone and
remain together in the explicitly labelled retention-gap list. Existing BUY/SKIP/
CACHE reasons, source purchases and creator rewards remain in the original report.
This transformation does not rerun research or change receipt/payment authority.

The related-work reference set derives only from selected theme excerpt URLs.
Multiple themes using one exact record produce one reference; different exact
versions keep different stable keys. Unread entries have no citation/reference
entry. Markdown/LaTeX escape author/provider text and retain excerpt anchors/labels.

New static browser labels, accessibility text, metadata and status messages use
`locales/en/evidence-drafts.json` with named interpolation through the typed source
import. This is English source preparation only; no locale is activated and no
human translation/trust-copy approval is implied. The existing shared contract
notice remains separately reusable by API/MCP. The combined issue 272 authoring
guard accepts this source without rewriting its historical baseline.

## API, MCP and other surfaces

| Surface | Source behavior and role |
| --- | --- |
| Web | `/literature/drafts` assembles locally from the saved Include records and explicitly imported reports. No automatic server call. |
| API | `POST /api/research/evidence-draft` accepts the same packet, with a verified export-scoped API key or active same-origin web session. Authentication is checked before private body reading. Existing authentication access includes key last-used bookkeeping in ordinary adapters; the new draft transformation makes no DB, provider, payment or file calls and writes no draft/query/history/payment data. Actual streamed bytes and deadline are bounded; fixed errors never echo passages. Every response is private/no-store. |
| Remote MCP | `evidence_draft` is a stateless pure transformation of caller-supplied inputs. It retrieves no owned/private record and grants no new authority. Client/host message retention is outside Keryx's deletion control. |
| Stdio MCP / CLI clients | The same local `evidence_draft` tool is registered in the stdio server. It makes no HTTP/wallet call; it can process caller-retained data offline. Repository CLI may use the authenticated JSON API. No autonomous drafting command is added. |
| Desktop | The existing hosted web workflow can be opened; no native task, bridge, signer or persistence contract is added. No installer upgrade is claimed. |
| Extension / bots / OpenAI / A2A | Existing research and report-link roles remain. They do not automatically submit private passages or run claim assessments. No new bot command, message ingestion or paid job type. |

Application/remote/stdio identities must be reconciled once the independent
production source window closes. This draft has no version bump, publication,
merge or deployment authorization beyond the current operational hold. A candidate
tool registration is not evidence of installed/published client delivery.

## Remaining issue and release gates

Automatic claim extraction/reference resolution, exact-original read integration
under existing budgets/BUY/SKIP/CACHE/reward rules, automated support review with
retained quote neighborhoods, mismatch explanations and separate suggested sources
remain open for issue 282. Issue 283 still needs model-assisted themes/contribution/
agreement/gap prose with independently reviewed sentence evidence, expert review
coverage and unsupported-statement metrics. No borrowed metric from issue 287 or
synthetic test is semantic acceptance or user usefulness.

Release also requires independent source/security review, both TypeScript graphs,
focused core/auth/MCP regressions, built Next routing and browser interactions,
responsive checks, packaged stdio consumer checks and all applicable hosted CI.
After operational closure, reconcile versions/distribution, merge under actual
aggregate/domain success, deploy current main, verify health and publish the normal
product update. Independent researcher acceptance remains unmeasured.
