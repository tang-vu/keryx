# Recorded report preview callers (#277), October 14

This isolated additive source candidate completes the remaining per-record head
and OG caller selection on main `a003fd3e72944aa5c7750ffee417a430459860a4`.
It follows merged PR431's provenance/privacy consumers and does not close
[original issue 277](https://github.com/tang-vu/keryx/issues/277).

`recordedReportPreview` imports the existing `recordedAnswerLanguage` reader. Its
only language authority is one accepted terminal generated-prose packet with the
closed en/vi/pt/es enum and a digest matching the immutable final answer bytes.
Both deterministic-renderer and reviewed-statements-and-renderer methods select
the same presentation contract. Absent, conflicting, duplicate, future, malformed,
unsupported and changed-byte packets select English labels and `und` provenance.
Question text, quoted originals, script/font coverage, requested language, provider,
viewer, environment, cookies and headers supply no answer-language evidence.

## Bounded presentation and retained English wording

The source-authored vi/pt/es catalogue covers the report title suffix, citation
singular/plural labels and banknote serial caption. English uses the existing
catalogue unchanged. Metadata changes only citation phrases in the existing source
templates **before** named interpolation. An original question or excerpt containing
those phrases, braces, quotations or non-Latin text remains literal. No question,
answer, citation, confidence reason, original bibliography, receipt or machine field
is rewritten. The helper reads only an already-admitted run's answer/trace; callers
provide the existing presentation data. It performs no storage/provider/auth read.

Presentation language and answer provenance remain separate. Even a known vi/pt/es
answer keeps these existing English fragments: `spent`, `to creators`,
`USDC recorded`, `testnet USDC recorded`, `creator rewards recorded`,
`The question it was paid to answer`, the citation-toll tagline, the social alt,
network/historical labels, `Original bibliographic metadata`, and raw confidence
level plus `confidence`. The current/historical and plain/confidence/bibliography
variant selection, bibliography precedence, recorded citation counts, exact monetary
formatting and UTC date remain unchanged. This is deliberate partial presentation;
it does not claim entirely translated scaffolding or human financial/trust approval.

The ordinary label translations are authored source, not evidence of human review.
The existing #273 human financial/trust terminology gate remains required before
translating the retained financial/confidence phrases. Original #277's human
locale/glossary review and actually published Vietnamese/Chinese interface variants
remain required for their translated public titles/descriptions/captions/structured
data. This candidate neither supplies a Chinese answer-provenance enum nor activates
any global locale: `UiLocale`, `shippedUiLocales`, shell, wallet, signing, fees,
settlement, legal copy and preference negotiation are unchanged. No new approval
requirement is introduced for ordinary labels.

## Public admission and preview boundary

Metadata and OG check explicit public visibility before accessing run, archive,
question, answer, trace/provenance, citations or receipts. Private/unlisted/missing/
unknown/unavailable metadata retains the existing closed, nonindexed, no-referrer
replacement, clearing inherited landing descriptions, canonicals and social metadata.
The image retains its harmless generic output for those same closed inputs.
Public OG data is prepared completely before generic output is replaced, so an
unavailable field cannot leave a partial question or localized caption behind.

Public metadata keeps one `/dispatch/<id>` canonical with empty language/type
alternates. `DC.language` remains the recorded tag or `und`; OG/Twitter share the
selected copy and add no locale aliases, duplicate URLs or locale advertisements.
Page body/JSX is byte-identical outside `generateMetadata`. The OG layout, truncation,
serial algorithm, dimensions, route exports and no-store/noindex headers are retained.
It still awaits `publicPreviewFonts(question)` and uses `publicPreviewFontFamily`;
no font, network fetch or language inference is added.

## Source fixtures and remaining acceptance

New fixtures cover all four languages with both accepted methods, every metadata
variant/count arm, exact micro amounts, UTC/current/historical semantics, bibliography
precedence, unknown/refused provenance, request-only hints, literal interpolation and
input immutability. Actual `generateMetadata` tests check canonical/alternate/social
selection. Actual OG caller tests observe the JSX/constructor boundary with mocked
storage and existing font selector, including awaited fonts, hidden getters and
storage/public-projection refusal. They do not certify PNG glyph layout or producer
language authenticity. All original report-language-metadata assertions are retained.

| Subcriterion | This source candidate | Remaining owner acceptance |
| --- | --- | --- |
| Recorded-language head/OG caller selection | Implemented for en/vi/pt/es with honest English/und fallback | ROOT focused tests/types, peer review and exact-candidate required CI |
| Closed/public boundary and one original canonical | Retained; added getter/refusal/immutability fixtures | Execute affected privacy/provenance surface checks |
| Local preview rendering | Existing font selector, dimensions and await retained | Applicable Next source build and actual glyph/layout evidence for changed labels |
| Original #277 full translated interfaces | Partial ordinary per-record labels only | Existing human locale/glossary and #273 financial/trust gates; real published variants |
| Producer/live and coordinated delivery | No execution or delivery claimed | Existing authorized producer/provenance surface acceptance, serialized merge and batch deploy/readback |

This worker executed no tests, compiler, browser, build, producer, database, provider
or paid/model calls and made no Git writes. ROOT owns changed relevant tests/types,
the applicable Next source CI build and provenance surfaces, independent review,
PR/required CI, serialized merge and release. Applicable runtime surfaces are the
web permalink head and shared OG image; desktop, CLI, remote/stdio MCP, API,
extensions and bots retain their contracts and benefit through the existing public
link after web delivery. No package/version, activation, policy, environment,
custody, spending or original-worktree change is included.
