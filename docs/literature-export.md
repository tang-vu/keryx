# Export saved literature references offline

Download the private JSON backup from the literature workspace, then explicitly
select that file and a reference format. This source-checkout CLI does not load
environment files, use an account or wallet, or fetch metadata:

```powershell
node --import tsx scripts/export-literature.mts --input library.json --format ris --screening include --output included.ris
```

Formats are `bibtex`, `ris` and `csl-json`. Omit `--screening` to export all saved
papers, or choose `unscreened`, `include`, `exclude` or `undecided`. Saved order,
exact versions and recorded metadata provenance are retained. An empty selection
produces an empty reference file (`[]` for CSL-JSON).

To export specific papers, supply `--selection selected-urls.json`. The file is a
JSON array of at most 50 unique exact saved landing URLs, in desired export order:

```json
["https://arxiv.org/abs/2401.00001v2", "https://arxiv.org/abs/2401.00001v1"]
```

```powershell
node --import tsx scripts/export-literature.mts --input library.json --format csl-json --selection selected-urls.json --output selected.json
```

The selection file must be regular UTF-8, optionally with BOM, at most 64 KiB
including BOM and whitespace. Missing, changed-version or duplicate URLs refuse
the entire export. URLs are not normalized or fetched. `[]` explicitly exports
no papers; omitting the option keeps the existing saved order. `--screening`
further filters the selected papers without reordering them. The complete backup,
including unselected reference metadata, is validated before output is created.

The complete version-1 personal-bibliography backup is validated before filtering.
Input must be a regular UTF-8 file, optionally with BOM, at most 1 MiB; malformed
encoding and oversized input are refused. `--output` creates a new file and never
overwrites an existing file, including the input. Without it, only reference
content is written to stdout. Errors omit private input paths and contents.

The local stdio MCP tool `export_saved_literature` takes the same backup as a
`backup` JSON string, an explicit `format`, optional `screening`, and optional
`paperUrls` containing the same ordered exact-URL array. It returns
`format`, `scope: "bibliography-only"`, `count` and `content`, without file access
or network calls. MCP clients may retain the entire supplied backup, including
private notes; use the browser workspace when those bytes should stay there.

Neither interface emits the private review title, question, screening decisions
or notes. References contain saved bibliographic metadata only, with the existing
unknown peer-review and withdrawal status disclosures. An export establishes no
new source observation, paper reading, factual support, citation or settlement.
The browser and its desktop-hosted view retain their existing exports. Hosted
HTTP MCP, API, extension and bots do not receive private backups automatically.
