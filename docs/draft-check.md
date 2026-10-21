# Private draft check

Source candidate for issue 282. Paste a passage and its reference list, supply the
source text you hold, and get one result per cited sentence. Each result quotes the
supplied text exactly or states that no supporting passage was found.

This is a deterministic wording comparison (`method: "lexical-overlap-v2"`). It is
not semantic entailment, model review or expert review, and it does not read the
cited works itself. Issue 282 is not complete; see [what remains open](#what-remains-open).

## What it does

1. **Reads the reference list** as BibTeX, RIS, or one DOI, `https` link or formatted
   reference per line (at most 64). Each reference gets a key (citation key, RIS `ID`,
   or `ref<N>`), its list position, and a status:
   - `identified`: a syntactically valid DOI or `https` link was written;
   - `described`: a title or author and year, but no DOI or link;
   - `unresolved`: nothing usable, an unterminated entry, or a duplicate key.

   Nothing is looked up. `identified` does not mean the DOI or link resolves.
   Bare DOIs beginning `10.` are preserved; list numbering requires whitespace
   after a written number and dot/parenthesis, or an unambiguous bracket label.
   Every occurrence of a duplicate key is unresolved; the first work is never chosen
   as a default. Duplicate display labels cannot collide with another written key.
2. **Splits the passage** into sentences with exact UTF-16 offsets. A sentence is
   never reworded, repaired or merged with other prose. A caller may instead pass its
   own ordered, non-overlapping spans. More than 128 sentences is refused, not truncated.
3. **Binds citation markers** in each sentence to references:
   `[3]`, `[1, 4-6]`, `\cite{key}` (and `\citep`, `\autocite`, …), `[@key]`,
   `Smith et al. (2020)` and `(Smith, 2020; Lee and Park, 2019)`. Numeric markers
   follow list order. Author-year markers need the first author's family name and the
   year to match exactly one reference; a different year is reported, never guessed.
   A marker may cite all 64 references; keys and author-year entries are not silently
   truncated after the sixteenth citation.
4. **Compares the sentence with the supplied text** of each cited reference and
   returns a verdict per citation and one per sentence.

## Verdicts

| Verdict | Meaning | Evidence state |
| --- | --- | --- |
| `supported` | One passage contains at least 80% of the sentence's content words (the sentence has at least three) and every figure, with the same negation, no listed opposite term and no tentative wording the sentence lacks. | `verbatim-excerpt` |
| `partly-supported` | A passage contains at least half of the content words. Unmatched words and figures are listed. | `verbatim-excerpt` |
| `not-found` | No such passage in the **supplied** text. Words found nowhere in it are listed. A near passage that differs in negation, an opposite term or a figure is shown separately as `closest` and is never counted as support. | `no-supporting-passage-found` |
| `source-unavailable` | No text was supplied for the cited reference, the reference entry is unresolved, or the citation matches no reference, several references, or the right author with another year. | `source-unavailable` |
| `not-checked` (sentence only) | The sentence has no citation, or is written in a script without word spacing (Chinese, Japanese, Thai, Lao, Khmer, Burmese), which this method cannot compare. | — |

Rules that hold for every result:

- A `supported` or `partly-supported` citation always carries an excerpt that is an
  exact slice of the supplied text, with its offsets. All other citations carry no
  excerpt and say so through `evidence`.
- A source without supplied text is `source-unavailable`. It is never `not-found`.
- For a sentence citing several works, the sentence verdict is the best citation
  verdict. If no cited work supports it and any cited work is unavailable, the
  sentence is `source-unavailable`, because the unread work may support it.
- `not-found` means "not found in the supplied text". Each source is declared
  `full-text` or `partial` by the caller and that declaration is returned with the
  citation.
- The cited author's name and the marker are excluded from the comparison.
- Optional `sources[].identity` carries `sourceId`, `itemId`, `itemUrl` and
  `contentVersion`, plus optional DOI/body hash. Each returned excerpt or negative
  check retains this exact identity and its offsets. These fields are caller
  assertions, not authenticated origin, completeness or settlement evidence.
  A DOI must match the recorded DOI, or a written link must match the exact recorded
  document URL (fragments are ignored). Another work or an unresolvable binding
  stays unavailable, even when its wording matches perfectly. Synthetic identities
  and known demo fingerprints cannot support a citation.
- A version-bound **partial** read with no supporting passage yields unavailable:
  the unread remainder cannot become a negative verdict for the work. Legacy
  unversioned text checks retain their explicitly text-scoped `not-found` behavior.
- Reversed operands around written `outperform`, `exceed`, `surpass`, `beat`, or
  comparative `… than …` patterns are withheld. This bounded wording guard is not
  a general grammar or semantic classifier.
- When either passage has multiple explicit percentages, distinct words in simple
  percentage clauses must uniquely bind each claimed population to the same value,
  without reusing one source clause for several claimed populations. Equal values
  alone cannot establish that binding. Swapping
  women/men's 60%/40% yields no lexical support; a version-bound partial read stays
  unavailable. Ambiguous clause associations withhold `supported`. This guard
  does not parse general population roles, implicit lists or semantic entailment.
- Optional `suggestions` supplies at most eight alternative read bodies, each
  with an exact URL/title/version identity. Matching excerpts appear in a separate
  `claims[].suggestions` list. They never rewrite claims, repair written citations,
  increase the supported summary, or authorize a creator reward.

## Flags

- `reference-unresolved`: a listed reference could not be identified.
- `citation-unresolved`: a marker matches no reference, several, or another year.
- `possible-different-work`: the text names an author directly before a numeric or
  key marker (`Jones et al. [3]`) who is not an author of the cited reference.
- `reference-not-cited`: a listed reference is not cited in the passage.
- `source-different-work`: supplied version metadata identifies another work;
  the written citation remains unavailable.

## Measured behaviour on the fixed set

`lib/research/fixtures/draft-check-evaluation.ts` holds 50 single-sentence cases:
18 labelled supported, 6 partly supported and 26 not supported. All text is synthetic
and labelled by the author of the set. All 50 are now development cases: v2 was
adjusted against the three recorded role-reversal failures, including a case in
the second batch. None is claimed as held out. No expert labelled it and no real
paper is represented. The fixture's bytes and labels were not changed for v2.
`lib/research/draft-check-evaluation.test.ts` pins these figures.

| Labelled | Returned supported | Returned partly supported | Returned not found |
| --- | --- | --- | --- |
| supported (18) | 15 | 0 | 3 |
| partly supported (6) | 0 | 6 | 0 |
| not supported (26) | 0 | 5 | 21 |

- **False "supported" rate: 0 of 32 (0%)** of the cases not labelled supported,
  measured by the executable fixed-set check for v2. The previous v1 result was
  3/32 (9.4%); all three role reversals remain in the set and now return `not-found`.
- Exact label agreement is 42/50 (84%).
- 3 of 18 supported cases were returned `not-found`. All three are paraphrases that
  share no vocabulary with the source.
- 5 of 26 unsupported cases were returned `partly-supported` (a different population,
  a tentative source, or a source that mentions the topic without the claim).
- With no source text supplied, all 50 cases return `source-unavailable`.

These figures describe this method on this set only. They are not an estimate for
real drafts, other languages or other fields. The method folds English suffixes and
uses English negation, hedging and opposite-term lists.

## Contract

`lib/research/draft-check.ts` validates the version-1 `private-draft-check` packet:

```json
{
  "version": 1,
  "scope": "private-draft-check",
  "passage": "Retrieval improves accuracy [1].",
  "references": { "format": "list", "text": "https://doi.org/10.5555/example" },
  "sources": [{ "reference": "ref1", "coverage": "partial", "text": "…" }]
}
```

Limits: 65536 UTF-8 bytes in total, passage 12000 characters, reference text 24000
characters, 64 references, 32 source texts of at most 40000 characters each, 128
sentences. Unknown fields, source text for a reference that is not in the list,
duplicate source text and malformed UTF-16 are refused. The result returns parsed
references, claims with spans, per-citation checks, flags and a summary. Supplied
source text is not echoed beyond its excerpts.

Text naming a duplicate reference key is refused because its work cannot be bound
unambiguously. Supplying text for an unreadable or otherwise unresolved entry does
not repair that entry: its citation remains `source-unavailable`, with no excerpt.

Supplied text is caller asserted. The check does not establish that it is the cited
work, that it is complete, or that it was lawfully obtained.

## Privacy

The API/MCP check is stateless. It writes no draft, query, history, archive, payment
or analytics record and starts no model call, source fetch, purchase or reward. The
browser page compares in the tab and makes no request. Nothing is saved by default.
An explicit device save lets the user choose one hour, one day or one week of
restore eligibility. Input is stored in this origin's browser local storage and
is accessible to the browser and same-origin scripts. Expiry refuses restore and
removes the save on the next restore attempt; it does not schedule background
physical deletion while the page is closed. Browser backups follow browser policy.
Separate controls clear the tab or delete the device save. Private input files
can also be deliberately downloaded/restored; their retention belongs to the user.
Saved input is bounded and validated before replacement, writes/deletes are read
back, and cooperating tabs serialize deliberate actions with Web Locks. Restore
recomputes the current method's results, rather than trusting saved verdicts.
File restores and device restores waiting for a Web Lock apply only while the
initiating editor action is current. Choosing another file or device restore,
editing, running a new check, clearing the tab or leaving the editor discards
the pending replacement and its late errors. An empty file selection or dismissing
the file picker also cancels an earlier file read. Start the restore again if you
still want to replace the latest text. Device Save and Delete retain their explicit storage-only roles;
discarding a stale restore does not delete the device save.
API responses are `private, no-store`, authentication
is checked before the body is read, and fixed errors never echo the passage. An MCP
client may keep its own tool messages; that retention is outside Keryx's control.

## Surfaces

| Surface | Behaviour and role |
| --- | --- |
| Web | `/literature/check`, linked from `/literature`. Runs the shared contract in the browser; explicit local input/file retention and separate suggestions. No server call. Not indexed. |
| API | `POST /api/research/draft-check` with an export-scoped API key or an active same-origin web session, the same authorization as the evidence-draft route. Returns `{ check }`. Listed in OpenAPI as `checkPrivateDraft`. |
| Remote MCP | `draft_check(check)`, the same pure handler. Retrieves no private record and grants no authority. |
| Stdio MCP | The same local `draft_check` tool; no HTTP or wallet call. |
| Repository CLI | No command. Use the API or the stdio tool. |
| Desktop | The hosted page can be opened. No native task, bridge or persistence is added. |
| Extension / bots / OpenAI / A2A | Unchanged. They do not submit private passages or run this check. |

Tool registration in source is not evidence of a published package or deployed
server. Application, remote and stdio version identities, package publication and
deployment are coordinated release steps and are not part of this change.

## What remains open

For issue 282:

- **Reading the cited sources.** Keryx does not fetch, buy or cache the cited works
  for a draft check, so BUY/SKIP/CACHE decisions, budgets and creator rewards do not
  apply here. `draftSourcesFromReads` now adapts an owner-admitted private run's
  completed `GatheredContent` bodies into exact version/DOI/URL-bound partial reads.
  It never substitutes payment decisions, metadata, public history or current cache
  bodies for completed reads, and withholds ambiguous versions. It is a pure adapter,
  **not wired to the executor**. The existing 276/301 owners retain `run-agent.ts`;
  root's shared-path partition, private execution integration/payment review and
  authorized live trial remain open. BUY/SKIP/CACHE/reward authority is unchanged.
- **Reference resolution.** DOIs and links are not resolved, and a citation is not
  looked up here. Supplied completed-read identities are now checked against written
  DOI/URL locators; an authenticated resolver/executor connection remains open.
- **Semantic verdicts.** General role assignment, paraphrase, scope and causal strength are
  outside a wording comparison. A reviewed model or human assessment is needed, with
  its own false-supported measurement.
- **Evaluation.** The fixed set is synthetic and author-labelled. Expert-labelled
  passages from real papers and a held-out set remain to be built.
- **Suggested better-supported sources.** Supplied alternatives now produce separate
  wording suggestions. Automatic discovery and semantic ranking are not implemented.
- **Chosen retention.** Explicit browser-local retention is implemented. A hosted
  owner-private saved draft with enforced deletion remains a separate storage gate.
- A built-app browser run and responsive check of `/literature/check` are not recorded.
