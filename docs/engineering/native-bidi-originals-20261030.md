# Bidirectional originals and local preview shaping

An original question, name or quotation may contain Arabic-script text even when
its generated-prose language is unknown or the viewer uses another language.
Previously the answer renderer inherited its host's direction and its quoted
originals had language tags without direction isolation. The six existing public
preview fonts also lacked the Arabic letters in the qualified sample.

Answer reading now gives each unknown answer `dir="auto"` while retaining
`lang="und"`. Currently admitted generated-prose languages all use left-to-right
direction explicitly. Verbatim quote fragments use `bdi`, `lang="und"` and
`dir="auto"`; their original strings, quote offsets and normalization stay exact.
Citation chips, their existing English accessibility labels and technical code
use left-to-right direction. List indentation uses logical start padding. These
changes preserve citation clicks, keyboard focus, HTML escaping and the original
text; visual direction never supplies a language observation or translation.
URLs, angle-delimited literals and brace-delimited identifiers inside an original
also receive nested left-to-right isolation. Adjacent technical tokens stay
together, so the browser does not mirror their delimiters within an Arabic quote.
The tokens are React text children; they are neither interpreted as HTML nor
changed with added directional characters.

The public image helpers select an additional pinned, licensed Noto Sans Arabic
face only for Arabic-script glyphs. They shape these fields with the existing
bounded Sharp/Pango/HarfBuzz pipeline, as already done for Devanagari. The original
alternative text, literal-markup escaping, text/pixel/time limits, complete-field
fit and publication rechecks remain in force. Other scripts retain their existing
text-node path. The font README records the exact upstream commit, release asset,
font and accompanying OFL notice hashes; no new dependency or host font is needed.

Actual browser fixtures exercise unknown Arabic-first text and trusted English or
Russian prose containing Arabic originals at 320/1366 widths, including a host
whose direction disagrees with the answer. They retain quote text, URLs, numeric
USDC strings, code, reference labels and keyboard citation actions. Existing
Russian and compiled answer assertions migrate from a `span` selector to semantic
`bdi` without dropping original-byte or language checks. Public preview fixtures
exercise actual dispatch, creator and wanted routes without creating Arabic
answer-language evidence; the compiled owner-published profile fixture adds pure
and mixed Arabic originals and checks all seven local font traces under an empty
host fontconfig. Existing publication, private-field and shutdown checks remain.

This outcome prepares existing original reading. Arabic ordinary-answer commands,
recorded observations, client translation and full right-to-left UI enrollment
remain separate work. No presentation registry, preference allowlist, payment,
custody, signing or critical financial translation changes here. Full exact-source
CI, platform/domain gates and direct image inspection remain required. Runtime
delivery belongs to the existing ROOT/Circle batch.

The direction treatment follows the W3C guidance for
[inline bidirectional text](https://www.w3.org/International/articles/inline-bidi-markup/index)
and [structural direction](https://www.w3.org/International/questions/qa-html-dir.en.html).
