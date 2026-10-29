# Russian ordinary interface preview

Russian grounded answers and client presentation were introduced in PR #763.
This outcome adds a separately identified Russian interface preview for the web
entry flow, first-use guide, research conversation, source library, PDF scope and
report reading. The interface uses the native name `Русский (preview)`.

The nine source-bound namespaces contain 370 authored draft entries, including
unchanged technical names. Every file remains `machineDraft` with `review: null`.
They cover core entry labels, setup navigation, PDF limits, product explanations,
reports, research controls, navigation, source browsing and language preferences.
The existing critical-copy and glossary filters still retain unreviewed payment,
consent, privacy and legal text in English. Russian has no approved payment
glossary. The default shipped-locale allowlist remains English; the web provider
explicitly offers the partial preview with its machine-draft notice.

Locale normalization admits Russian and its supported Cyrillic/region variants.
An explicitly incompatible script such as `ru-Latn`, Ukrainian, Belarusian and
malformed values do not become Russian. Existing preference precedence and
zero-quality header exclusions remain in force. Only the selected UI and shell
chunks load. Changing interface language does not request research, edit the
question, append an answer-language command, attest the language of an answer or
rewrite an original quotation, title, URL, source field or saved report.

Existing one/other UI counters use neutral Russian count-label wording that works
with every integer. Recorded Russian answers retain their separate Russian
plural rules. Localized display uses the Russian decimal separator through the
existing formatter; integer micro-USDC accounting and signing text stay canonical.

Actual source-library browser checks found that the initial Russian recency label
exceeded a native select's available width. The shorter label means newest records
first. The sort value, recorded dates and sorting behavior are unchanged. Native
GET forms retain their original query, author, DOI, year and fragment behavior.

The existing browser fixtures now include Russian rather than substituting a
separate mock interface. They exercise the real composer, tour, locale provider,
stop/new/follow-up controls and source cards. The tour covers 320/1366 widths at
normal and doubled root text size. Wallet authentication and funding stay at the
fixtures' explicit signed-out boundaries; research streams are synthetic and
external requests, signing and real payments remain excluded. Original text,
keyboard navigation, minimum control sizes, English financial notices and all
prior language cases retain their assertions. Built informational-route acceptance
also derives its preview matrix from the shared prepared-locale registry.

Regeneration writes changed outputs only. Its `--check` mode still validates every
prepared preview, current English binding and required coverage floor. Existing
language artifacts and critical-review gates are preserved. Full exact-head CI,
applicable platform/domain acceptance and inspection of new hosted image pixels
remain required before merge. Runtime delivery belongs to the existing ROOT/Circle
batch and is not established by this source change.
