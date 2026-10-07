# PDF evidence boundaries

Application 0.27.19 candidate, October 7, 2026. This fixes structural sentence
boundaries in the shared research engine; it is not acceptance of complete paper
comparisons, manuscript reading order or independently useful answers.

## Reproduction and correction

A synthetic line-wrapped source demonstrated that `Intl.Segmenter` treated the
suffix after a physical PDF line break as a complete sentence. Both the strict
quote menu and evidence ledger accepted that suffix with its literal offsets.
Context nomination also treated each physical PDF line as a separate block,
discarding sentence prefixes and adjacent qualifications in long documents.

Only an observed `webProvenance.extraction: "pdf"` activates the correction.
A title, URL extension or bibliographic record cannot activate it. A shared
boundary view replaces each CR and LF separately with one space, preserving
every UTF-16 position. Boundary computation uses that view; all passages, quotes,
review context, hashes and stored source text use exact original substrings.
The strict quote menu consumes accepted source spans without segmenting their
original line breaks again. PDF nomination and review context use contiguous
sentence windows; physical lines remain available for existing unique heading
hints, which do not verify PDF destinations or complete sections.

The 200,000-character scan, 600-character nomination window, 2,000-character
generation context, 240-character quote and 1,200-character review context caps
remain intact. Separate selected passages are never joined across a gap.
Truncation, scan cuts, malformed Unicode and source identity remain visible.
HTML and other source formats retain their previous boundary behavior.

## Validation and limits

Synthetic regressions cover LF/CR/CRLF, original quote lengths 239/240/241,
repeated quotes with distinct offsets, emoji and malformed Unicode, scan and
extraction cuts, late sentence selection, nearby caveats, unique heading hints,
review input and ledger rejection of a high-support sentence suffix. Existing
span, menu, context, review, delivery and orchestrator tests remain release checks.

An offline replay uses the previously captured exact public PDF texts for
`2606.02668v1` and `2607.13716v1` and their official metadata. It verifies original
body hashes and offsets without new publisher, model, database or payment calls.
The second capture remains explicitly truncated. More selectable structural
quotes do not establish target coverage, correct findings or usefulness.

Physical PDF order, columns, page furniture, headings and ambiguous punctuation
remain extraction/segmentation risks. Flattened boundaries cannot certify
semantic independence or retention of every qualification. Existing reviewed
sentence-cited delivery, Low confidence, explicit gaps and excerpt fallback
remain in force; the decision brief remains disabled.

## Authority and surfaces

This shared code reaches web/SSE, stored answers, public/private APIs, A2A,
OpenAI-compatible research, remote/stdio MCP, repository CLI, desktop forwarding,
extensions and bots without new adapter or result fields. Engines using the
shared heuristic receive the same span correction. Client packages contain no
separate PDF-boundary implementation. Hosted delivery and installed versions
still require the coordinated release checks.

Literal source binding, final-URL/version authority, independent evidence review,
ledger support thresholds and public-reference exclusion from creator rewards
remain unchanged. No settlement, signer, custody, reservation, allowance, retry
or scheduler authority is added. A read or lexical quote option is not a payment
receipt, complete research result or traction.
