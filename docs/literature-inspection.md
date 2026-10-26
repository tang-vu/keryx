# Inspect a saved literature backup offline

Use a downloaded version-1 personal-bibliography JSON backup to review saved
screening progress and metadata coverage without opening a research job:

```powershell
node --import tsx scripts/inspect-literature.mts --input library.json
node --import tsx scripts/inspect-literature.mts --input library.json --output new-summary.json
```

The command validates the complete backup and reference metadata, then returns
JSON with format `keryx-literature-inspection-v1` and scope
`personal-bibliography-summary`. It includes:

- Total saved records, with distinct exact paper versions counted separately.
- Counts for the four personal screening states and supported repositories.
- Counts of recorded publication kinds, including unknown kinds.
- Overlapping counts for absent author names, incomplete contributor lists,
  unrecorded publication years, DOI and venue fields.

Missing fields remain unknown; missing DOI or venue metadata does not establish
that no DOI or venue exists. Recorded publication kinds and personal screening
are caller-supplied data, not quality scores or evidence of peer review. Separate
versions may describe the same underlying study. No paper is fetched, read or
checked for current withdrawal status, and no settlement is verified.

The result omits the private review title, question, notes, paper titles, authors,
identifiers, URLs and saved timestamps. Keep the original backup: the summary
cannot restore it or authenticate its publisher.

## Compare two snapshots

Pass the before snapshot as `--baseline`; `--input` is the after snapshot:

```powershell
node --import tsx scripts/inspect-literature.mts --input current.json --baseline previous.json --output new-comparison.json
```

The existing inspection fields still describe `--input`. An additional
`comparison` object with format `keryx-literature-comparison-v1` reports before/
after record counts, additions, removals, retained records, and changes to:

- Validated bibliographic metadata, excluding its observation timestamp.
- Recorded `metadataObservedAt` and `savedAt` values separately.
- Personal screening and note values on retained records.
- Relative order of retained URLs and the private review focus.

Records match by exact saved URL. A different arXiv version or renamed URL is an
addition/removal, even if its title or DOI is the same. Field-change counts apply
only to retained records and may overlap. Inserting/removing records alone does
not change their retained relative order. JSON property order is irrelevant;
metadata uses the existing backup schema's normalization, while private focus,
notes and recorded timestamp strings compare literally. Timestamps do not select
before/after order or establish when a change actually happened.

Both snapshots validate completely before any result or output file is produced.
Each is independently limited to 1 MiB of original UTF-8 bytes, including BOM.
A valid empty baseline reports all current records as additions; an empty file or
malformed baseline is refused. Neither file is modified, and `--output` also
refuses to overwrite the baseline. The comparison contains no individual URLs,
titles, names, note text or review-focus values. Its change counts can still be
personal information. Keep both originals; the result is no authenticity,
research-quality, reading or settlement proof.

For local stdio MCP, supply optional `baselineBackup` alongside `backup`; both
are explicit JSON strings, with the same before/after roles. Omitting the baseline
preserves the original single-backup output without a `comparison` field. MCP
clients may retain both complete supplied backups despite the redacted result.

Input must be a regular UTF-8 file, optionally with BOM, at most 1 MiB including
BOM and whitespace. Oversized, malformed or nonregular inputs are refused before
output creation. File reads and validation are shared with reference export;
Unix FIFOs do not wait for a writer. The CLI loads no environment file, account,
wallet, model or network client. Errors omit private paths and input text.
`--output` creates a new file exclusively, using mode `0600` on platforms that
apply Unix modes, and refuses an existing path including the input itself.

The local stdio MCP tool `inspect_saved_literature({backup})` accepts the same
bounded backup as an explicit JSON string and returns the same aggregate object.
It is read-only, idempotent and closed-world, with no file, network, model, wallet
or payment I/O. MCP clients may retain the complete supplied backup, including
private notes, despite the aggregate output. Use the browser's local workspace
and backup controls when those bytes should remain in browser memory.

Existing web/desktop-hosted library controls, reference exports and the backup
schema are unchanged. API, hosted HTTP MCP, extension and bots do not receive
private backups automatically. Source acceptance requires focused regressions,
actual built stdio checks and full applicable PR/platform CI; runtime delivery
remains with the existing ROOT/Circle release owner.
