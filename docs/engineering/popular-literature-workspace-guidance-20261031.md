# Popular-language literature workspace preview

The personal literature workspace previously showed its core controls and all four
screening labels in English in the ten partial interface previews. This increment
adds 75 neutral workspace messages and 4 screening labels per locale for Spanish,
Brazilian Portuguese, French, German, Japanese, Korean, Hindi, Indonesian, Russian
and Arabic. Each locale now has 130 authored reports entries (129 admitted to the
preview), 4 shared-helper entries and 533 authored partial-preview entries overall.

The screening editor, saved-paper badge, filter and import preview resolve the
existing screening message keys at display time. Stored enum values, fixed English
CSV labels, schema version, locking, stale-edit guards, source records, notes and
reference exports retain their existing contracts. A paper title or note equal to
an English UI phrase remains original user data. Reference downloads still contain
metadata rather than the review question or personal screening notes.

RIS, CSL-JSON, CSV, JSON and the 1 MiB upload limit use the existing authored-text
literal isolation in the relevant controls. Their exact text stays left to right
inside translated labels, including Arabic; parenthesized format names stay
together. Export controls retain the exact keyed accessible name. Sensitive
English fallback notices use explicit language and direction attributes. Long
review-form labels wrap within the form even at 32px root text. Interpolated titles, filenames and
dates use the existing keyed message formatter; user text is never translated or
treated as a template.

All additions remain `machineDraft` with `review: null`. English remains the shipped
default. Ten core notices remain English in these partial previews: removal and
clear confirmations, general action failure, privacy, reference-export disclosure,
comparison disclosure, draft privacy, portability disclosure, restore replacement
warning and clear warning. Bulk screening and cleared-data recovery retain their
existing consent boundary. Search, import, comparison and bibliography management
have separate catalogues; this change does not claim complete workspace or product
localization, human language approval or production delivery.

The source-bound draft tests validate all 790 additions, placeholders, exact format
tokens, critical English fallback and language-independent export values. The
offline browser fixture bundles the real workspace, store, keyed catalogues and UI
renderer with actual application CSS and local fonts; only Next Link is replaced
by a plain anchor. It checks all ten locales at 320 and 1366 pixels, Arabic at 390
pixels, and Portuguese, Russian and Arabic at 320 pixels with 32px root text. It
exercises locale changes with unsaved text, saving decisions and notes, native
screening labels in an import preview, cross-tab stale-edit protection, filtered
RIS/CSL-JSON, whole-workspace CSV/JSON, cancelled and successful restore, oversized
backup refusal, and cancelled clear with the exact English confirmation. It makes
no provider or research request. Captured originals use the existing native
guidance artifact directory. Full current-source PR, platform/domain, original-image
review and main acceptance remain required by the development workflow.
