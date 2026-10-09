# Literature workspace

The [retained-evidence draft source candidate](evidence-drafts.md) adds a manual
tab-memory workflow at `/literature/drafts`: Include records plus explicitly imported
Keryx excerpt ledgers, exact claim spans, named user assessments and quote-based
related-work themes with matching references. Imported origin, semantic support
and model-written synthesis remain unverified; full issues 282/283 acceptance and
deployment are separate gates. No automatic paper read, upload or payment occurs.

`/literature` adds a personal shortlist to the research-paper library. Use it to
screen papers against a review question, keep your reasons and prepare a comparison.
The candidate is not production delivery or evidence of independent demand.

## Working with a review

1. In **Sources → Research papers**, choose **Save to literature workspace**.
   Starter and explicitly searched repository records use the same save action.
   A grouped work exposes its individual records so you can choose an exact version.
2. Open the workspace and save a review title and question/inclusion criteria.
3. Record **To screen**, **Include**, **Exclude** or **Undecided** and your own notes.
   Save explicitly. These are personal decisions, not agent verification or claims
   that a paper has been read. Filter the list without discarding an open draft.
4. Select two papers and choose **Prepare comparison**. This opens an editable Deep
   question with the saved review question and both exact links. Notes and screening
   decisions are omitted. Review the question and visible budget before submitting.
   The selected pair stays visible across screening filters, with exact record links,
   arXiv versions and an outside-filter label. Remove either paper individually.
   **Review prepared question** shows exactly the draft that will open, using the
   saved focus rather than unsaved edits in the focus form.
   Existing research availability, model/search costs, original-reading and payment
   limits apply. Preparing a draft makes no research request.

An exact paper link can still be unreadable. The shared reader rejects OpenReview's
browser-verification redirect as `publisher-verification-required`, rather than
using its instructions as paper evidence. Recovery asks for an accessible original
of the same document/version. Recovery is guidance only; existing bounded run
reevaluation retains its policy. The guard adds no sign-in, verification bypass or
saved-PDF substitution; imported links do not prove paper identity.
This guard covers the observed OpenReview `/challenge` route, not every publisher
access page. A two-paper draft does not prove that either original can be read.

The list holds up to 50 exact paper records, one review focus and 2,000 characters
of notes per record. Different arXiv versions remain separate. Re-saving an exact
landing URL retains its first metadata snapshot and existing notes; mutable work
group IDs and matching titles do not replace an identity.

## Storage and portability

No account is required. The list, review focus and notes stay in localStorage on
this browser and origin; there is no cloud sync or automatic upload. The site and
anyone controlling this browser profile can access them. Avoid sensitive notes on
a shared browser. Clearing browser data or changing devices can lose this list.

Download **screening CSV** for the full saved list, including excluded papers,
personal notes, exact links/versions, contributor limitations and metadata provenance.
Formula-like cells are neutralized for spreadsheet import; stored notes stay literal.
This is a screening list, not the answer's evidence matrix or a settlement receipt.

Choose a screening filter, then **Download shown references (RIS)** to move that
subset into a reference manager. The visible count is the export scope; comparison
checkboxes do not change it. Only saved bibliography metadata is exported, with
exact URLs/arXiv versions, supplied names/year/DOI/venue and a provenance note.
Your review focus, screening labels and personal notes are omitted. Select **All
saved papers** for the full bibliography. This file is separate from CSV and JSON.

Import through your reference manager's file import. The exporter uses the types
recognized by [Zotero's RIS translator](https://github.com/zotero/translators/blob/c7551c1a4d5b9623273119c7fbadf8735731dc92/RIS.js):
preprint as manuscript, observed conference/journal as their matching types and
unknown publication type as a web record with the unknown status retained in its
note. Publication type never verifies peer review. Incomplete author lists remain
explicit; missing data is omitted. Review the imported title, author names, venue
and version before academic use. No attachment, enrichment or synchronization is
requested. A pinned translator check covers synthetic type/identity/author/year/note
handling under a minimal host; Zotero application acceptance remains open.

Download **JSON backup** before moving devices or clearing data. Restore accepts a
strict version-1 personal-bibliography file, up to 1 MiB. The preview precedes an
explicit replacement of the entire current list, focus and notes; it does not merge.
Imported metadata is not revalidated against repositories. Invalid/future/duplicate
records and extra read/payment fields are refused without replacing existing data.
Unreadable stored data is kept and can be downloaded before an explicit replacement
or clear. Quota/readback failures never report a verified save.

All cooperating tabs serialize mutations with an exclusive [Web Lock](https://www.w3.org/TR/web-locks/).
Browsers without that API refuse writes and retain the stored backup. Unsaved edits
remain in their editor when another tab changes the saved fields; the interface
asks the user to load the saved version before overwriting it. A deliberate restore
or clear replaces local editors. Filters keep editors mounted. Locks coordinate
application writes; they do not defend against compromised same-origin scripts or
external browser-data deletion.

## Surfaces and release gates

This is a browser workflow. Web navigation, Sources cards and ordinary nonautomatic
question prefill change; editable drafts retain the existing 2,000-character form
limit. Legacy `run=1` links retain their 500-character limit and behavior. Public and
private research APIs, remote/stdio MCP, CLI, desktop, extensions and bots retain
their roles and response structures. They do not receive or synchronize this local
list. The shared reader's fixed OpenReview failure and recovery text apply to all
research callers; answer-bearing adapters and receipts retain the failure. The
refused original is excluded from citation/evidence exports; successful reads in
the same run remain exportable. With no usable reads, exports contain no cited or
quoted source.
Desktop, extension and bot client packages need no reader implementation changes;
verify their published versions at release.
Existing cited-reference BibTeX/RIS and evidence exports remain separate.
No schema, payment authority, custody, budget or scheduler changes.

Release requires focused model/store/UI regressions, both TypeScript projects,
lint, built Next navigation, readable action contrast and responsive screenshots,
independent review and CI.
The operational owner's paid-original transition retains its serialized source gate;
do not merge/deploy while that gate is unresolved. Reconcile the app version at merge,
then verify the deployed commit and publish the authorized product update.

Usefulness validation remains open: ask an independent literature-review participant
to screen their own five papers, explain inclusion/exclusion, reopen the list and use
the export in their actual workflow. Record corrections, total time including review,
accepted outcome and a participant-initiated return separately. A saved list or a
successful synthetic test is not traction, systematic-review completeness or research
quality. No participant contact or paid research is initiated by this feature.
