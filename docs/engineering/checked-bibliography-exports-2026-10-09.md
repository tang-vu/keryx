# Checked saved bibliography exports — October 9, 2026

A saved original-page metadata task can contain a reusable paper while its cited
reference list is empty. Hosted web/API already expose a separate
`bibliographyExports` role. The checked Operator/desktop export projection used
only citations, so its reference files stayed empty for that task. This source
candidate adds explicit `bibliography-bibtex`, `bibliography-ris` and
`bibliography-csl-json` choices; it advances the local export parity portion of
[issue285](https://github.com/tang-vu/keryx/issues/285), without closing it.

The application projection reuses `bibliographyFromCheckedReceipt` over the exact
receipt object already checked for integrity and original task binding. Its
bounded validator admits only the recorded original metadata identity and
recomputes the existing metadata-only BibTeX/RIS. CSL-JSON uses the same saved-paper
formatter as the hosted projection. No file is reread between checking and
projection. Missing, invalid or unusable optional bibliography metadata refuses
the explicit export before the exclusive private publisher creates a file.

The default Markdown brief, cited-only BibTeX/RIS/CSL-JSON, evidence CSV and raw
`readSavedOperatorResult`/native inspection contract remain unchanged. No metadata
paper becomes a cited source or qualifies for payment. Original-page BibTeX keeps
its recorded ordinal-key contract; CSL keys retain the existing exact-URL
identity. This correction changes neither saved receipts/digests nor old response
snapshots. It creates no sharing URL, provider connection, token, store, signing
or storage authority.

| Surface | Outcome and boundary |
| --- | --- |
| Repository Operator CLI | `brief --format bibliography-bibtex\|bibliography-ris\|bibliography-csl-json --state <task> --file <new destination>` exports the checked metadata role explicitly, with existing overwrite refusal. |
| Desktop | Existing helper/writer accepts the shared choices; renderer offers distinct bibliography buttons and native save dialogs use `.bib`, `.ris` or `.json`. Saved-result availability is required. Missing metadata gives a refusal without a file. |
| Hosted web/API, remote MCP, A2A, OpenAI | Existing dedicated `bibliographyExports` projection already supplies these formats; no new endpoint, scope or duplicate formatter. |
| Caller-funded stdio MCP | Existing optional server bibliography export fields remain forwarded; no local sharing/upload command. |
| Extensions/bots | Retain their hosted/page/answer roles; no new account adapter or bibliography command. |
| Native engine | Raw result/inspection ABI and authority stay unchanged; only the desktop's existing export-format adapter allowlist gains the three choices. |

Meaningful acceptance includes a bibliography-only saved task, exact output
parity, old empty cited exports/default brief, no saved-byte or authority change,
corrupted-receipt refusal, unknown/missing metadata refusal, overwrite refusal,
renderer dispatch and native packaged export/cancellation. Focused tests, affected
application/operations/desktop TypeScript and scoped lint are required. Native
adapter changes additionally require actual platform/package checks. This note
records source behavior, not completed production or packaged acceptance.

Versions, merge readiness, package/installer publication and deployment belong to
the owner-controlled coordinated release after exact combined source passes the
applicable aggregate/domain/platform gates. This branch makes no independent
version, release or deployment. Zotero authorization, encrypted provider tokens,
duplicate-safe collection writes and report/excerpt notes remain separate open
issue285 work. Synced bibliography storage/log-redaction enablement and actual
external writing-tool acceptance keep their existing gates.
