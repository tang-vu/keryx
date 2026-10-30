# Arabic ordinary interface preview

Arabic grounded answers and client presentation were introduced in PR #766.
This change adds a separately identified Arabic web interface preview,
`العربية (preview)`, for the entry flow, first-use guide, research conversation,
source library, PDF scope and report reading.

Nine namespaces contain 370 source-bound draft entries. Every draft remains
`machineDraft` with `review: null`. The existing critical-copy and glossary
filters keep unreviewed payment, consent, privacy and legal text in English.
Arabic has no approved payment glossary. The default shipped-locale allowlist
remains English; the web provider explicitly offers this partial preview with
its existing machine-draft notice. This is not a claim of complete translation
or human language approval.

Locale normalization admits Arabic and compatible Arabic-script/region variants.
Incompatible scripts, Persian, Urdu and malformed values do not become Arabic.
Preference precedence and zero-quality header exclusions remain unchanged.
Only the selected UI and shell chunks load. Changing interface language does
not submit research, modify a question, append an answer-language instruction
or attest the language of an answer.

The selected Arabic interface reads right to left. Translated leaf text uses
RTL direction; retained English leaf text uses LTR direction. Questions,
follow-up input, original source titles, descriptions, author names, claims and
excerpts retain unknown language and automatic content direction. The shared
original-text helper isolates literal technical tokens without changing their
text. Source identities, URLs, original export bytes, financial state and
payment authority remain unchanged. Neutral count labels work with every
integer; recorded Arabic answers retain their separate Arabic plural rules.

Actual browser inspection at 320 px exposed a globe overlapping the Arabic
headline. Logical positioning and a direction-isolated inner graphic now keep
the painted SVG clear of the headline. Guide navigation follows RTL direction.
Inspection also exposed English privacy punctuation inheriting RTL direction;
the existing language-aware message leaves now isolate those notices without
changing visibility choices, disabled conditions or callbacks.
Original JSON in request and bibliographic inspection panels explicitly reads
LTR while retaining unknown-language identity and exact original text.
Compiled-page inspection also exposed instruction examples inheriting the
interface direction and an English footer description marked as Arabic.
Each fixed native instruction now uses its own direction, and the footer's
authored message leaves declare their actual language. Instruction text,
the Greek word, question bytes and critical-copy filters remain unchanged.
The initial-globe browser fixture now extracts the complete JSX element through
the existing TypeScript parser. Its previous non-greedy `div` expression cut
the nested graphic wrapper short. First-paint bounds, the delayed real atlas,
DPR 1/2, reduced motion and visibility assertions remain intact.
The browser checks cover normal and enlarged Arabic text at 320, 390 and
1366 px, keyboard focus and PageDown reading, original question preservation
and English financial notices. Source browsing, stop/new/follow-up handoffs,
clipboard failures and retries, native downloads, evidence omission/restoration
and byte-exact exports use their existing real components and assertions.
The report and evidence matrices also cover the existing Russian preview.

Browser fixtures use explicit signed-out, synthetic-stream and offline
boundaries. They do not invoke real research, external providers, signing or
payments. Built informational-route acceptance derives its language matrix
from the shared prepared-locale registry. Opaque server children remain server
rendered; this change does not move routes or introduce a locale routing layer.

The ordinary Arabic answer support in desktop, CLI, API, remote/stdio MCP,
extension handoffs and bots remains the separately accepted PR #766 behavior.
This outcome changes web interface presentation and shared web readers; those
other clients retain their existing roles and exact contract values.

Regeneration validates current English bindings and existing coverage floors,
writing changed outputs only. Full current-source PR/domain/platform CI and
inspection of changed hosted images remain required before merge. Runtime
delivery belongs to the existing ROOT/Circle batch and is not established by
this source change.
