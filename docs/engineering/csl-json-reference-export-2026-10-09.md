# CSL-JSON reference exports — October 9, 2026

This source candidate adds a downloadable CSL-JSON array to recorded research
citations, original-page bibliographies and the browser's saved-paper workspace.
It addresses the file-export portion of issue285. Zotero account authorization,
idempotent library synchronization and private revocable `.bib` URLs remain open.
There is no account connection, upload, enrichment request or payment in an export.

## Recorded metadata and identity

The output follows the [CSL input data schema](https://github.com/citation-style-language/schema/blob/master/schemas/input/csl-data.json).
It uses `id`, `citation-key`, `type`, `title`, `URL` and available bibliographic
fields. Recorded journal articles, conference papers and preprints retain their
types; a preprint is `manuscript`, without a peer-review assertion. Publication
dates retain their observed year/month/day precision. Invalid calendar dates are
omitted rather than normalized. Observed structured names remain structured;
literal contributor names are not split into guessed given/family components.

Research references use the existing BibTeX key over exact source, article, URL
and content version. Saved-paper references use a stable key over their exact
landing URL. Reordering or filtering does not change those keys; separate arXiv
versions stay separate. Saved metadata deduplicates exact URLs using their first
retained snapshot. DOI aliases across repositories are not silently merged.
These nonsecurity identifiers do not authenticate sources or authorize payment.

Missing metadata stays absent. Provenance notes preserve observed read limits,
incomplete contributor lists, unknown peer review and synthetic-demo labels.
Saved bibliography notes explicitly retain their metadata-only status. Personal
workspace notes, screening decisions and the private review question do not enter
the reference file. Invalid or oversized paper lists are refused as a whole.

JSON strings preserve literal metadata without creating extra records. The file
is downloaded as `application/json`; the browser does not render its metadata as
HTML. [Zotero's CSL JSON translator](https://github.com/zotero/translators/blob/master/CSL%20JSON.js)
accepts JSON-array input with recognized CSL types. File validity and actual
Zotero desktop import are separate acceptance claims.

## Saved receipts and supported surfaces

| Surface | Change and boundary |
| --- | --- |
| Web/chat/embed/archived dispatch | CSL-JSON download from the shared recorded-citation formatter; article omission counts stay visible. |
| Original-page bibliography | Separate metadata-only download from the accepted paper record. Stored bibliography text and BibTeX/RIS snapshots stay unchanged. |
| Browser literature workspace | Download only the papers shown by the current screening filter; stable CSL keys and metadata-only provenance. |
| Hosted API/A2A/OpenAI/remote MCP | Derived `researchExports.cslJson` includes `content`, `count`, `omitted`; derived `bibliographyExports.cslJson` includes `content`, `count`. |
| Repository Operator CLI | Explicit `brief --format csl-json` reads the integrity-checked original-task-bound saved receipt and writes a private file using the existing exclusive publication path. |
| Desktop | Helper shares the checked formatter; renderer and native save dialog offer a JSON download. New installer/package acceptance and publication are required. |
| Caller-funded stdio MCP | Forwards optional server export fields; old paid response snapshots are not rewritten. Type-only field additions do not introduce a new formatter or signer. |
| Extension and bots | Existing hosted/page/answer roles; no reference-manager account adapter or new download command. |

`bibliography` remains the original validated stored result. Its stored export
object is not extended, and the receipt projection is not changed to inject new
fields into old records. New derived exports are separate. Checked private export
formatting does not alter receipt bytes, hashes, seller-reported settlement or
native inspection authority.

## Acceptance and release gates

Focused formatter, transport, calendar, browser-download and saved Operator tests
must pass, with application and desktop TypeScript checks. The production Next
build and applicable desktop/native packaging checks remain release gates.
Publication and deployed-source readback are required before claiming delivery;
an owner-installed desktop upgrade is a separate observation.

This file records source behavior and required checks, not completed production,
Zotero application or account-sync acceptance. Issue285 stays open for its
remaining integration criteria.
