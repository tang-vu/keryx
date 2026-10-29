# Recorded language on live research answers

The completed live conversation rendered every answer with `lang="und"`, even
when the final retained language packet was valid and the same saved report used
the recorded language. `ResearchTurn` omitted the existing `AnswerCard` prop.
This prevents assistive readers from selecting the recorded prose language in
the live view.

Pass `recordedAnswerLanguage(state.run)` through that existing prop. The reader
already validates the closed terminal-packet schema, canonical supported language
and exact final-answer digest. Neither the interface preference nor the question
supplies evidence. Missing, duplicate, malformed, future or byte-mismatched
packets remain unknown. The existing answer projection also drops the language
when synthetic-evidence demotion changes the displayed prose.

The server producer, finalizer, SSE transport, browser state lifecycle, signing,
source decisions, financial aggregation and saved-report path keep their existing
authority. This change does not translate or rewrite questions, answers, original
quotations, citation markers or receipts. Language metadata remains a description
of recorded generated prose, not a human approval or an authentication claim.

Acceptance covers the actual live renderer for all eleven canonical languages
under a different selected interface, the strict unknown cases and the existing
synthetic projection. A real Chromium fixture mounts the locale/copy providers,
language selector, `useAskStream`, `ResearchTurn`, `AnswerCard` and `AnswerMarkdown`.
It consumes two synthetic zero-budget SSE completions: a valid Japanese/Hindi
record, followed by a changed answer with its stale packet. Switching the
interface preserves the first language; the changed bytes become unknown.
Phone and desktop controls preserve the original question and saved link.

The browser fixture explicitly returns a signed-out auth response and bounded
feedback counts. Its only POST is the intercepted synthetic `/api/ask` response;
all external, signing, funding and other requests fail the fixture. It never
invokes an actual server, supplier, wallet or payment. Eight frames are retained
in a `live-answer-language` subdirectory of the existing unit screenshot capture,
preserving the parent guidance frames at their established root paths.

Full exact-head `build-and-test` and applicable domain/platform checks remain
required. PR756 must merge first; the focused child source is transplanted onto
its accepted squash tree before an independent PR. ROOT/Circle retains the
separate coordinated runtime/publication batch and all original, payment,
custody and prepared-cutover gates. Source acceptance is not runtime delivery.
