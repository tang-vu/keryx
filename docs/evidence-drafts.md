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
   rewritten. Editing around a claim keeps its annotation and assessment, shifting
   the UTF-16 offsets when needed. An edit intersecting a claim clears that claim's
   annotation and assessment; the selection prompt highlights that you should
   select the changed text again. Other claims, themes and retained reports stay
   in place. If the browser cannot locate an edit unambiguously (for example,
   replacing repeated prose without an input selection), affected annotations
   are cleared instead of moved to another occurrence.
4. An excerpt match leaves semantic assessment pending. You may record your own
   named supported, partly-supported or not-found assessment. It remains explicitly
   user supplied. Missing retained source evidence always withholds that judgment.
   A not-found assessment is your own observation, never an exhaustive Keryx search.
5. Choose **Assemble retained contributions** to append editable literal quotations
   grouped by the original research targets, or group retained quotations manually.
   Existing themes and edits remain. **Regenerate this theme from selected excerpts**
   replaces only that theme's sentences, preserving its title, notes and other themes.
   Assembly does not infer agreement, disagreement or gaps. Author notes remain
   visibly unverified; write comparisons only after reviewing their cited excerpts.
6. Optionally write the section one sentence at a time with **Add statement**.
   Choose what the sentence does (one paper's contribution, agreement,
   disagreement or a gap), tick the papers it names and tick the retained excerpt
   it relies on for each. A paper without a retained excerpt cannot be ticked. A
   sentence that is still incomplete is shown as not exported yet and stays out
   of every download; the rest of the draft exports normally.
7. Download Markdown/LaTeX and its matching BibTeX/RIS. LaTeX uses `biblatex`,
   `\addbibresource{references.bib}`, `\autocite` and `\printbibliography`. Markdown
   uses the same stable citation keys and includes an explicit reference list.
   The RIS library contains exactly the cited records, although RIS importers need
   not preserve citation keys. Download private draft JSON to retain exported
   draft inputs, selected excerpts and assessments.
8. To resume later, open **Continue a saved draft** and choose that JSON backup.
   Review its title, counts and passage preview. **Save current draft first**
   downloads the current valid draft before replacement. Choose **Restore in this
   tab** to continue editing, then download a new backup before leaving. The
   backup's Include selection is used in this tab only; your saved bibliography
   is unchanged. Cancelled or invalid files leave the current draft unchanged.
   If you edit while a file is opening or after its preview appears, choose the
   file again to review it against the latest draft before replacement.

Continuing a restored draft keeps its existing claim spans, selected excerpts,
assessments and themes when you add new rows. New claims and themes remain
independent of the restored rows, including after saving and reopening again.

Use **Remove this claim** to discard one selected span and its recorded assessment
without changing the original passage or other claims. **Remove this theme**
discards only that theme's notes, statements and excerpt selections. Both ask for
confirmation; canceling keeps the current draft. Other rows, including unfinished
statements, stay in place. Retained source reports are kept, so their excerpts
remain available to other rows. Reference downloads follow the remaining themes
and exported statements; removing the last citation removes its reference too.
You can remove every claim/theme or free a slot at the editor limits, then add
new rows without clearing the rest of your work. Download a new private backup
to retain these deliberate changes.

Passage, report JSON, assessments and theme edits remain in tab memory; no upload,
public history, localStorage draft write or background request is performed by
this editor. The existing bibliography stays in its existing browser store.
Reload/navigation loses the in-memory draft; reopening a downloaded backup is
explicit, with no automatic save or recovery. Empty unfinished statement rows,
the unimported report JSON field and the reviewer input are not backup contents.
Restoring replaces the current draft's passage, imported reports, assessments and
themes. Downloads are a deliberate retention choice and should be kept private.
The browser profile and same-origin scripts can
access editor contents; no protection against a compromised origin is claimed.

After an edit, the editor requests the browser's native confirmation before a
reload, tab close or other full-document navigation. Cancel keeps the tab's current
work. Requesting a valid private JSON download makes those exported inputs the
retained baseline; later edits warn again, and reverting to that baseline removes
the warning. Restoring a file starts from its retained baseline. Markdown, LaTeX,
BibTeX and RIS downloads do not save the editable draft. Unfinished statement rows,
unimported report JSON and the reviewer input still warn after a JSON download,
because they are absent from that file. A failed download request does not clear
the warning. Verify the browser actually saved the requested file before leaving.

The browser supplies the confirmation text and decides whether to show it after
user interaction. This is a best-effort safeguard: same-document app navigation,
browser/process crashes and mobile app-manager shutdown are not protected. Keep
downloading private backups deliberately; this safeguard adds no storage, upload
or automatic recovery. See the browser's
[beforeunload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event#usage_notes).

The browser accepts existing version-1 private draft JSON, with a 256 KiB file
limit to allow formatted JSON around the existing 64 KiB compact packet limit.
Invalid UTF-8, invalid packets and invalid evidence selections are refused before
replacement. Opening a backup projects its Include records and drops screening
notes, matching the editor's existing workspace projection. An imported assembly
operation is removed rather than replayed. Restoring does not authenticate report
origin, promote stale assessments or make a provider, model or payment request.

## Shared contract and evidence boundaries

`lib/research/evidence-draft.ts` validates a version-1 `private-evidence-draft`
packet: a saved literature workspace, projected retained reports, original passage,
manual claim spans and themes. Claim offsets count UTF-16 code units in the unchanged
passage. Both the whole passage and each selected claim must be well-formed UTF-16:
either boundary splitting a surrogate pair is rejected rather than repaired.
Complete Unicode scalars remain unchanged; grapheme-cluster boundaries are not
required. Each selected excerpt requires an Include record,
an exact item URL/source/item/content-version/marker match to one retained citation,
the original research claim/index and a qualified bounded quote. Missing version,
unqualified records, ambiguous duplicate markers, synthetic markers and known seed
fingerprints are withheld. Bibliography, matching titles and alternate versions
cannot supply evidence. A canonical `https://arxiv.org/pdf/<id>v<version>` read
URL (with an optional `.pdf` suffix) may map to the saved canonical `/abs/` record
only when its explicit arXiv identifier and version match. Citation and evidence
rows must still agree literally on the original source, item, read URL, content
version and marker. Unversioned URLs, HTML, query/fragment variants, redirects and
other repositories retain the existing exact-URL rule. Metadata links and titles
never supply this mapping.

A mapped excerpt adds `readUrl` containing its original PDF URL; `paperUrl` stays
the saved bibliography record. Both URL identities bind its excerpt identifier
and any user assessment. Markdown and LaTeX retain the read URL beside the quote;
BibTeX/RIS keep one matching saved reference. Existing exact-URL excerpts keep
their original shape, identifiers and assessment bindings. Private draft backups
can retain the optional assessment `readUrl`; older clients may refuse those new
mapped assessments. Restore them with a client supporting this mapping.

This mapping belongs to the caller-supplied report transformation shared by the
editor, API and MCP. The authenticated completed-private-read selector keeps its
existing literal original-URL contract; no private lookup, stored result or
payment identity is rewritten or broadened by this adapter.

Imported reports are caller supplied. Schema checks and exact matching do not
authenticate their origin or prove the source was read, the quote is verbatim in
the original, or any payment settled. Existing server-side evidence eligibility
flags are a retained-record filter, not semantic entailment. Nonsecurity stable
IDs identify rows; literal row bytes additionally bind user assessments. Changed
claim text, references, selected excerpts or row bytes invalidate an assessment.
Reviewer names and timestamps are assertions, not verified identity or expert review.

No usable retained excerpt alone says nothing about original access. Optional
`readingStatuses` records the caller's explicit `unread` or `unavailable` observation
and reason for a unique exact Include URL. These papers export separately and are
never described or cited. Records without an observation stay in the unknown
retention-gap list. Contradictions with usable retained evidence refuse. The legacy
v1 `unread` result remains the combined no-excerpt compatibility list; the new
`reading.unread`, `reading.unavailable` and `reading.unknown` lists distinguish
observations honestly. Existing BUY/SKIP/CACHE reasons, source purchases and creator
rewards remain in the original report. This transformation does not rerun research
or change receipt/payment authority. **Prepare reading request in a new tab**
deliberately opens the existing editable budgeted reader; submission and importing
its resulting report remain separate user actions.

Optional `assembly: {mode: "append"}` appends extractive contribution themes.
`assembly: {mode: "regenerate", themeId: "…"}` replaces one theme's sentences from
its 1–24 selected retained excerpts. Both enforce the same packet and theme bounds.
An assembly response includes `draft.editableRequest` with the operation removed,
so subsequent edits need not trigger regeneration again. API and both MCP surfaces
reuse this zero-I/O behavior. See [candidate controls and remaining gates](engineering/related-work283-completion-2026-10-12.md).

The related-work reference set derives only from selected theme excerpt URLs and
the excerpts of exported statements. Multiple themes using one exact record produce
one reference; different exact versions keep different stable keys. Unread entries
have no citation/reference entry. Markdown/LaTeX escape author/provider text and
retain excerpt anchors/labels; an excerpt quoted in several themes is anchored once.

## Statements

A theme may carry up to 24 `statements`. Each is one author-written sentence with a
draft-unique `id`, a `kind`, `text` (600 characters), up to 8 exact Include
`paperUrls` and up to 16 `excerptIds`. `lib/research/related-work-statements.ts`
resolves each one to a status:

| Status | Rule | Export |
| --- | --- | --- |
| `excerpt-bound` | Every named paper has at least one selected retained excerpt from that exact record and version. A contribution names exactly one paper; agreement and disagreement name at least two; a gap may name any number. | The sentence, a citation for every named paper and a link to each selected excerpt, which is quoted in the same theme. |
| `author-gap` | A gap that names no paper. | The sentence, labelled as author-stated, citing no paper and unverified. |
| `withheld` | The paper count does not fit the kind (`paper-count`), or a named paper has no selected retained excerpt (`paper-without-selected-excerpt`, with `missingPaperUrls`). | Only a count of withheld statements. The text, its citations and its references are omitted. |

A selected excerpt that is unknown, changed, from another version or from a paper
the statement does not name refuses the whole request, exactly as theme and claim
selections do. An Include paper with no retained excerpt therefore cannot be
described by a statement: it stays in the separate retention-gap list.

The binding is structural. Keryx checks that the sentence names a paper it holds a
retained excerpt for and that the export cites and links it. It does not read the
sentence, and it does not decide whether the excerpt supports the wording. Nothing
stops an author from naming a paper in free text without selecting it; the author
note and an author-stated gap are labelled unverified for that reason. No model
writes or rewrites any statement. The browser editor keeps a sentence with no text
in tab memory only and leaves it out of the packet and the private draft JSON.

## Citation and reference correspondence

`lib/research/evidence-draft-parity.ts` re-reads the four finished exports before
they are returned. Every key cited in the Markdown and LaTeX bodies must have
exactly one BibTeX entry, one Markdown reference line and one RIS record for the
same exact URL, and no entry may exist without a citation. Any difference refuses
the export. RIS has no citation-key field, so its records are matched by record
URL. Markdown escapes `@` in author and provider text, so that text cannot form a
Pandoc citation key.

The guard compares each Markdown reference and each BibTeX entry's key-to-URL
association with the canonical draft reference, including the formatter's escaped
BibTeX URL bytes. Substituted or swapped URLs, duplicate or missing URL fields and
unexpected records refuse the export; matching key and URL sets alone do not pass.
This checks export identity, not whether an excerpt supports an author's statement.

New static browser labels, accessibility text, metadata and status messages use
`locales/en/evidence-drafts.json` with named interpolation through the typed source
import. This is English source preparation only; no locale is activated and no
human translation/trust-copy approval is implied. The existing shared contract
notice remains separately reusable by API/MCP. The combined issue 272 authoring
guard accepts this source without rewriting its historical baseline.

## API, MCP and other surfaces

| Surface | Source behavior and role |
| --- | --- |
| Web | `/literature/drafts` assembles locally from saved Include records and explicitly imported reports, or resumes a reviewed private JSON backup using its tab-only Include selection. No automatic server call or bibliography overwrite. |
| API | `POST /api/research/evidence-draft` accepts the same packet, with a verified export-scoped API key or active same-origin web session. Authentication is checked before private body reading. Existing authentication access includes key last-used bookkeeping in ordinary adapters; the new draft transformation makes no DB, provider, payment or file calls and writes no draft/query/history/payment data. Actual streamed bytes and deadline are bounded; fixed errors never echo passages. Every response is private/no-store. |
| Remote MCP | `evidence_draft` is a stateless pure transformation of caller-supplied inputs. It retrieves no owned/private record and grants no new authority. Client/host message retention is outside Keryx's deletion control. |
| Stdio MCP / CLI clients | The same local `evidence_draft` tool is registered in the stdio server. It makes no HTTP/wallet call; it can process caller-retained data offline. Repository CLI may use the authenticated JSON API. No autonomous drafting command is added. |
| Desktop | The existing hosted web workflow can be opened; no native task, bridge, signer or persistence contract is added. No installer upgrade is claimed. |
| Extension / bots / OpenAI / A2A | Existing research and report-link roles remain. They do not automatically submit private passages or run claim assessments. No new bot command, message ingestion or paid job type. |

Cookie requests must carry the exact public Origin selected by server-controlled
`BASE_URL`, with `Sec-Fetch-Site: same-origin` when that header is present. Missing,
foreign or malformed origins and invalid deployment origins fail before private
body reading. Neither Next's internal request URL nor caller-controlled Host or
forwarded headers selects that authority. The API-key path remains separate.

Application/remote/stdio identities must be reconciled once the independent
production source window closes. This draft has no version bump, publication,
merge or deployment authorization beyond the current operational hold. A candidate
tool registration is not evidence of installed/published client delivery.

## Evaluation scorer

`npm run eval:related-work -- <evaluation.json>` scores drafts offline. It reads
one local JSON file and prints one JSON report. It makes no provider, database,
wallet or network call. The version-1 `related-work-evaluation` packet holds up to
50 reviews, each with:

- `id` and `referenceOrigin`: `expert-written` or `synthetic-fixture`;
- `expertWorks`: the works cited by the reference section, each an exact `url`,
  a `doi`, or both;
- `draft`: a version-1 `private-evidence-draft` packet;
- `judgments`: a reviewer's `supported` or `unsupported` verdict for a statement
  that is exported with a citation, with the reviewer's name.

For each review it reports coverage (expert works the draft cites, matched by
exact URL or exact normalized DOI and never by title), draft references outside
the expert list, statement counts by status, and the unsupported-statement rate
over the judged statements. The aggregate covers `expert-written` reviews only and
is `measured` only when every one of them has every citing statement judged;
otherwise it is `not-measured`. Synthetic fixtures are scored for regression tests
and excluded from the aggregate.

The scorer restates what it is given. It does not verify that a reference section
was written by an expert, who the reviewer is, or that a judgment is right. No
expert-written review set has been collected and no result has been measured. The
repository tests use synthetic fixtures only.

## Remaining issue and release gates

The separate [private draft check](draft-check.md) now covers automatic sentence
spans, reference-list reading, citation-marker binding and a deterministic wording
comparison against caller-supplied source text for issue 282. It does not change
this manual contract and does not read cited works.

Automatic claim extraction/reference resolution, exact-original read integration
under existing budgets/BUY/SKIP/CACHE/reward rules, automated support review with
retained quote neighborhoods, mismatch explanations and separate suggested sources
remain open for issue 282. Issue 283 has author-written statements with enforced
citation and excerpt binding, a verified one-to-one reference set and an offline
scorer. It still needs a set of reviews with expert-written reference sections,
reviewer judgments of the statements and the resulting coverage and
unsupported-statement rate. Model-assisted themes/contribution/agreement/gap prose,
agent-proposed candidates within a stated budget and normal bounded reading from
this workflow also remain open; they need provider calls and spending that this
source does not start. No borrowed metric from issue 287 or
synthetic test is semantic acceptance or user usefulness.

Release also requires independent source/security review, both TypeScript graphs,
focused core/auth/MCP regressions, built Next routing and browser interactions,
responsive checks, packaged stdio consumer checks and all applicable hosted CI.
After operational closure, reconcile versions/distribution, merge under actual
aggregate/domain success, deploy current main, verify health and publish the normal
product update. Independent researcher acceptance remains unmeasured.
