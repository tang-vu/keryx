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
