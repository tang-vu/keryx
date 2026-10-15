# Topic-watch #284 preview metadata - October 15, 2026

The new `locales/en/topic-watches.ts` namespace adds 42 English leaves. VI and
Simplified Chinese now record 61 extracted namespaces (60 English files plus
core-inline), 5,617 leaves, 5,554 existing authored entries, 21 preserved machine
identifiers and 42 uncovered keys each. The existing 60 namespace rows and assets
are unchanged. Both manifests correctly report `complete: false`, with 60 complete
namespaces. The two new assets contain `entries: {}`, `status: "machineDraft"`
and `review: null`; no translation or human approval is supplied.

Bindings use the existing `uiSourceSha256` contract: UTF-8 source with CRLF/CR
normalized to LF. The current topic catalogue hash is
`da619acd121f4e293b428684dc8d402443b4ac2c578719dc67f7374a7fc447a2`.
Its one flat exported literal root has no source aliases. Every actual key is
uncovered; no identifiers, placeholders or critical consent text are reclassified.

Source inspection traces deliberate English behavior: the manager calls
`createMessages("en")`; `englishMessages` spreads `topicWatchMessages` and
`createMessages` uses `translated ?? englishMessages[key]`. The existing namespace
preview allowlist does not include topic-watches, so an explicit request currently
returns an empty catalogue before loading. Empty entries also supply no translated
leaves. This is a source trace, not executed loader or browser acceptance. English
remains the only shipped UI locale; runtime loaders, guards and defaults are unchanged.

The owned `output/preview-metadata-handoff.json` retains full before/after bytes,
inverse restoration, minimal patches, all prior rows and protected asset/source
hashes. All checks are **UNRUN** here: check-ui-copy, loader tests, types, build,
compiled/browser acceptance and required CI. This additive partition does not
accept the parent's in-progress composition or close the broader original #284.
ROOT496's historical owned-history work remains separately owned; later current-main
composition must resolve overlaps normally and preserve its actual changes.

Parent next action: obtain the tiny data/source peer review, rerun the failed copy
guard and meaningful existing English-fallback controls on the actual composition,
then perform one current build and compiled acceptance. Refresh canonical evidence
only for changed inputs, pass required PR CI and hand off to the existing coordinator.
Deployment remains batched; this handoff makes no production or surface-delivery claim.
