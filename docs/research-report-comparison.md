# Compare saved research reports

Use `/research/compare` to inspect what changed between two saved research
receipts. Download **Receipt JSON** from each saved report; its receipt panel links
to the comparison workspace. Choose the before/after order, verify both files,
then inspect retained excerpts, source versions and reading context side by side.

Files remain in browser memory. This tool does not upload, persist, fetch sources,
run a model, start research or purchase content. Downloaded comparisons contain
report text; the user controls where those files go. Questions, answers and
excerpts stay literal, without translation or active links from imported URLs.
Changing a file or target match clears the previous result immediately; late
asynchronous verification cannot restore it.

## Meaning and limits

Both inputs must be UTF-8 JSON using the existing
`urn:keryx:research-receipt:1` schema and matching `sha256` / `keryx-json-v1`
payload checksums. Every payload field is checked, including fields omitted from
the comparison. A checksum checks consistency with the supplied digest. It does
not authenticate a publisher, prove factual support, verify settlement or establish
that a later report improved. Input limits are 512 KiB each, 256 targets, and
bounded JSON depth/width/traversal. Oversized or unsupported inputs are refused
instead of truncated.

Only unique identical target text is paired automatically. Duplicate or renamed
targets remain unmatched until the user pairs them. Explicit pairs are one-to-one
and recorded as `user-selected`; this does not prove semantic equivalence. An
explicit empty match list leaves all targets unmatched. IDs, filenames and
timestamps do not determine order.

Inspectable excerpts require a nonempty bounded quote, a retained qualification
flag (or an illustrative label), and exact citation marker/source/item/URL/version
binding inside their own receipt. Cross-report identity uses the exact source ID,
item ID, URL, version and quote; marker renumbering is ignored. Reading context
compares retained extraction, clipping, validated PDF page/HTML section scope,
normalized/body hashes, delivery kind, scholarly scope, source name and title.
Retrieval time alone does not count as a change; both times remain exported.
Conflicting PDF clipping flags remain explicit.

Missing historical ledgers and malformed optional rows remain unknown/incomplete.
Valid retained rows can still be inspected without inferring additions or losses.
Unmatched targets stay separate from excerpt-change totals. Counts refer to
retained rows, including duplicates, rather than independent sources. Demo rows
stay illustrative. Literal question/answer differences carry no quality score.

## Portable outputs

All exports bind both payload checksums, caller-selected order, availability,
target matching origin and retained context. JSON uses
`keryx-report-comparison-v1`: a filtered comparison artifact, not a new receipt
or a replacement for either original. Unrelated financial, credential and unknown
payload fields are omitted. Markdown keeps source content in dynamically sized
literal fences. CSV quotes every cell and prefixes formula-like text, including
invisible prefixes, with an apostrophe. Use JSON or Markdown to preserve original
strings without that CSV display guard. Missing values stay unknown.

## Local CLI

From the checkout with pinned dependencies:

```powershell
node --import tsx scripts/compare-research.mts --before before.json --after after.json
node --import tsx scripts/compare-research.mts --before before.json --after after.json --format markdown --output comparison.md
```

Default output is JSON on stdout. `--format` accepts `json`, `markdown` or `csv`.
`--output` creates a new file exclusively and refuses an existing path. Local
files use bounded reads and fatal UTF-8 decoding. No environment file is loaded.
Errors contain fixed codes, without private report text or OS paths.

For explicit pairs, use `--matches pairs.json` containing at most 256 pairs:

```json
[{"beforeClaimIndex":0,"afterClaimIndex":1}]
```

Indices are recorded zero-based claim indices. Duplicate, nonexistent or
out-of-range indices are rejected. `[]` intentionally selects no pairs.

## Supported surface roles

| Surface | Role |
| --- | --- |
| Web / desktop's hosted web workspace | Local files at `/research/compare`; discovery from saved-report receipt panels. Desktop consumes this hosted route in its existing role. |
| Repository CLI | Explicit local files, same engine and JSON/Markdown/CSV exports. |
| Local stdio MCP | `compare_saved_research({before, after, matches?})` using receipt JSON strings. The MCP client may retain input/result history. |
| API / remote MCP | Existing receipt downloads hand off to the local tool. No new upload/comparison endpoint. |
| Extension / bots | Existing saved-report/receipt links hand off to web or CLI. No comparison inside these adapters is claimed. |

Acceptance includes focused failure tests, actual Chromium files/downloads and
async races, app/ops typechecks, production build and required PR/domain/platform
CI. The browser test runs in the production lane against generated product CSS.
The built stdio package is tested through its actual protocol. Source acceptance
does not establish production delivery; ROOT/Circle owns the coordinated release.
