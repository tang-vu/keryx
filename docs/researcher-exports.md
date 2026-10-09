# Researcher exports

The [private synced bibliography source candidate](engineering/private-synced-bib-2026-10-09.md)
adds explicit saved-paper snapshot links on supported ordinary SQLite deployments.
It is separate from the downloaded recorded-reading exports below; production
enablement and external writing-tool acceptance remain open.

Completed readings on the web, including archived dispatches, offer two complementary
ways to reuse recorded research. These exports run in the browser from the reading already
on screen; they make no enrichment request or payment and do not upload to a reference manager.

## References for papers and reference managers

Under **Reference export**, download BibTeX (`.bib`) or RIS (`.ris`). Import either file
into Zotero through **File → Import**. Ordinary web records use RIS `WEB` and BibTeX
`@misc`. The files contain recorded article titles, links, available publication dates
and a provenance note identifying the source and recorded content version.
Bound-to-read [scholarly metadata](scholarly-research.md) also includes supplied authors,
DOI, journal, volume, issue and pages. Journal records use `JOUR` / `@article`; preprints
use `MANSCPT` / `@misc`, with exact arXiv versions and explicit read limitations.
The pinned Zotero RIS parser maps `MANSCPT` to a manuscript; its unsupported `UNPB`
tag falls back to a journal article. The provenance note still identifies the
record as a preprint and keeps peer review unknown. RIS notes encode markup as
literal text. A scholarly source name is retained in that note, never substituted
for a missing journal. See [compatibility checks and limits](engineering/reference-export-2026-10-07.md).

Only cited articles appear, not every discovered or purchased source. A citation without
a usable HTTP(S) article link or title is omitted and the reading displays the omitted count.
Keryx does not replace an unknown article with a publication homepage. Duplicate exact article
identities are collapsed within a file; different item identities or content versions remain separate.

Review the imported metadata before citing it in a paper. Registered publication names are not
necessarily article authors. These exports do not infer authors, DOI, journal, peer-review status,
volume or pages. Metadata comes only from an observed provider snapshot tied to that
run's read document; older archives are not silently enriched. Provider publication
type does not prove peer review or author distribution rights. The export itself
does not search for literature or synchronize a Zotero account.

## Evidence for technical and market research

Expand **Research evidence matrix** to compare each recorded research target with cited sources.
Inspect the recorded answer-qualified excerpts in the cells and download **evidence CSV** for a
spreadsheet or research brief. CSV includes article identity and content version when recorded,
and explicit rows for claims without inspectable excerpts. Formula-like cells are neutralized
for spreadsheet import; the on-screen excerpt remains the exact stored text.

Public web references and creator sources both appear when cited. Public evidence can qualify
for the answer without qualifying for a creator payment; the matrix does not grant payout authority.

The matrix only displays bounded excerpts matching the cited source and article version. It
does not turn agent confidence or coverage into measured accuracy. A missing excerpt means an
inspection gap, not proof that the claim is false or disputed. Older dispatches may have no
claim or evidence ledger; the interface labels those missing records explicitly.

New evidence-bearing completions use an explicitly extractive result: only qualifying
source quotations are delivered, and complete synthesis is unverified. Model-proposed
target labels are unverified topics, not established conclusions; support and coverage
are recorded estimates, not entailment or truth checks. Even a source with an admitted
excerpt cannot support every assertion that a draft attaches to its marker. Reports
and portable receipts preserve the exact finalized answer. BibTeX/RIS include retained
article citations; evidence CSV includes retained qualified excerpts and target gaps.
The stable CSV `claim` field carries the recorded research target, not a certified
factual claim. These exports do not promote a withheld assertion or initiate another
purchase. A paid access toll remains a debit when its source supplies no qualifying
quote, while an admitted creator excerpt keeps its existing reward eligibility.
Archived answer bytes retain their original meaning and are not retroactively certified.
The 240-character bound applies to the raw trimmed stored excerpt and its normalized
match form. Within-bound multiline quote bytes remain intact in evidence/receipt/CSV
data; Markdown report topics and appended excerpts are escaped quoted presentation.

Neither references nor the matrix are settlement evidence. For the complete question, answer,
decisions, evidence and classified creator payment states, retain the separate
[portable research receipt](research-receipts.md).

## Other supported surfaces

Remote MCP `research`, OpenAI responses in the `keryx` extension, and paid A2A results expose the same recorded `researchExports` (`bibtex`, `ris`, `evidenceCsv`) and article identity. The caller-funded stdio MCP returns the result as structured content as well as text. No export initiates another research request.

The Operator CLI retains the stable raw inspection view with `result`, or publish a new private file with `brief --format bibtex|ris|evidence-csv --state <task> --file <destination>`; omit `--format` for a Markdown brief. The desktop offers BibTeX, RIS and evidence CSV through native save dialogs. Each rechecks receipt integrity and original task binding, keeps payment seller-reported, and refuses an existing destination. Older receipts can have no usable article identity or claim ledger. Exports never start discovery. Operator storage remains private locally, while its deliberate buyer purchase uses the public `/api/agent/ask` endpoint and its configured public web/exact-DOI discovery; this is distinct from the isolated private-research endpoint.

Transport correction: `creatorsPaid` is null when the response cannot prove a distinct settled creator count. `creatorRewardAllocations` counts non-public sources with positive planned citation rewards; `creatorsReferenced` counts distinct cited source identities. Neither count is settlement evidence. Clients must accept the nullable field.

The default Operator Markdown brief keeps its existing answer and cited-source view. Direct BibTeX/RIS/CSV requests use a separate checked application projection over the same receipt bytes; they do not change the raw TypeScript/native inspection contract or migrate export formatting into Rust.
