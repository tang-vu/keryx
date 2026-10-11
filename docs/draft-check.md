# Private draft check

Source candidate for issue 282. Paste a passage and its reference list, supply the
source text you hold, and get one result per cited sentence. Each result quotes the
supplied text exactly or states that no supporting passage was found.

This is a deterministic wording comparison (`method: "lexical-overlap-v1"`). It is
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
2. **Splits the passage** into sentences with exact UTF-16 offsets. A sentence is
   never reworded, repaired or merged with other prose. A caller may instead pass its
   own ordered, non-overlapping spans. More than 128 sentences is refused, not truncated.
3. **Binds citation markers** in each sentence to references:
   `[3]`, `[1, 4-6]`, `\cite{key}` (and `\citep`, `\autocite`, …), `[@key]`,
   `Smith et al. (2020)` and `(Smith, 2020; Lee and Park, 2019)`. Numeric markers
   follow list order. Author-year markers need the first author's family name and the
   year to match exactly one reference; a different year is reported, never guessed.
4. **Compares the sentence with the supplied text** of each cited reference and
   returns a verdict per citation and one per sentence.

## Verdicts

| Verdict | Meaning | Evidence state |
| --- | --- | --- |
| `supported` | One passage contains at least 80% of the sentence's content words (the sentence has at least three) and every figure, with the same negation, no listed opposite term and no tentative wording the sentence lacks. | `verbatim-excerpt` |
| `partly-supported` | A passage contains at least half of the content words. Unmatched words and figures are listed. | `verbatim-excerpt` |
| `not-found` | No such passage in the **supplied** text. Words found nowhere in it are listed. A near passage that differs in negation, an opposite term or a figure is shown separately as `closest` and is never counted as support. | `no-supporting-passage-found` |
| `source-unavailable` | No text was supplied for the cited reference, or the citation matches no reference, several references, or the right author with another year. | `source-unavailable` |
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

## Flags

- `reference-unresolved`: a listed reference could not be identified.
- `citation-unresolved`: a marker matches no reference, several, or another year.
- `possible-different-work`: the text names an author directly before a numeric or
  key marker (`Jones et al. [3]`) who is not an author of the cited reference.
- `reference-not-cited`: a listed reference is not cited in the passage.

## Measured behaviour on the fixed set

`lib/research/fixtures/draft-check-evaluation.ts` holds 50 single-sentence cases:
18 labelled supported, 6 partly supported and 26 not supported. All text is synthetic
and labelled by the author of the set. It is a development set: the first 36 cases
informed the method's rules, the last 14 were written before the final rule change and
were not used to adjust it. No expert labelled it and no real paper is represented.
`lib/research/draft-check-evaluation.test.ts` pins these figures.

| Labelled | Returned supported | Returned partly supported | Returned not found |
| --- | --- | --- | --- |
| supported (18) | 15 | 0 | 3 |
| partly supported (6) | 0 | 6 | 0 |
| not supported (26) | 3 | 5 | 18 |

- **False "supported" rate: 3 of 32 (9.4%)** of the cases not labelled supported.
  All three are role reversals ("A outperformed B" against a source saying "B
  outperformed A"). Word order is not analysed.
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

Supplied text is caller asserted. The check does not establish that it is the cited
work, that it is complete, or that it was lawfully obtained.

## Privacy

The check is stateless. It writes no draft, query, history, archive, payment or
analytics record and starts no model call, source fetch, purchase or reward. The
browser page compares in the tab and makes no request; text is lost on reload unless
the user downloads the result. API responses are `private, no-store`, authentication
is checked before the body is read, and fixed errors never echo the passage. An MCP
client may keep its own tool messages; that retention is outside Keryx's control.

## Surfaces

| Surface | Behaviour and role |
| --- | --- |
| Web | `/literature/check`, linked from `/literature`. Runs the shared contract in the browser; no server call. Not indexed. |
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
  apply here. Connecting the check to the research run, with private handling of the
  passage, needs its own design, payment review and authorized live trial.
- **Reference resolution.** DOIs and links are not resolved, and a citation is not
  compared with the retrieved work's metadata.
- **Semantic verdicts.** Role reversal, paraphrase, scope and causal strength are
  outside a wording comparison. A reviewed model or human assessment is needed, with
  its own false-supported measurement.
- **Evaluation.** The fixed set is synthetic and author-labelled. Expert-labelled
  passages from real papers and a held-out set remain to be built.
- **Suggested better-supported sources** are not produced.
- **Chosen retention.** Nothing is stored at all; there is no opt-in saved draft.
- A built-app browser run and responsive check of `/literature/check` are not recorded.
