# Language276 source candidate, October 12

Issue [276](https://github.com/tang-vu/keryx/issues/276) remains open. This isolated
candidate extends the already delivered bot source; it does not rerun producer198,
activate prepared UI locales, claim human translation approval, allocate a version,
publish, deploy, send a notification, or authorize financial effects.

## Source behavior

- The ordinary synthesis reviewer can observe each generated statement's actual
  language in its existing bounded review call. A trusted internal opt-in is
  required; legacy and retained/private review guidance/schema remain unchanged.
  Missing, duplicate, unsupported or mutated observations confer no language
  authority. A prompt, question, request parameter or arbitrary model property
  never proves the output language.
- The finalizer contract binds observed generated-prose language to exact final
  UTF-8 answer bytes. Deterministic renderer prose and every delivered model
  sentence must agree. The stored envelope fits the existing done-step trace JSON;
  neither adapter needs DDL or historical backfill. The digest binds bytes, not
  source authenticity, factual correctness, settlement or human approval.
- API, remote MCP, bot results and Markdown report headings can consume that
  byte-bound recorded envelope. Absent, future, conflicting or altered metadata
  remains unknown. Reports use English fallback for unknown historical provenance;
  they do not detect language retrospectively from a question or answer.
- `/language` writes a separate answer-intent namespace and confirms readback.
  Existing help-only state is not silently migrated into answer intent. A new
  command also updates help, with both saves confirmed before success is reported.
  Answers prefer an explicit language instruction in the unchanged original
  question, then the verified sender's preference, then the question selector.
  Ingress passes a structured internal option, never an appended hidden prompt.
  Preference failures retain default behavior. Channel/application/sender scope,
  authenticated transports and private claim delivery keep their existing roles.
- Owner-only `/api/creator/{id}/notify/language` reads/sets the presentation
  preference for that source's exact existing email recipient configuration.
  Replacing the address or unsubscribe token starts a fresh preference. Storage
  readback and recipient recheck are required before successful save. No account,
  wallet or reader-question identity join is made. Email dispatch uses the stored
  recipient preference with English fallback; ordinary navigation is localized.
  Settled-only sending, rate caps, canonical financial prose, receipts and URLs
  retain their established semantics. The endpoint sends no mail.
- CLI `--language en|vi|pt|pt-BR|es|auto` and native Desktop's presentation selector
  share the finite catalogue. System locale provides default ordinary labels.
  CLI answer headings prefer recorded answer provenance when available. Desktop
  uses the catalogue for ordinary result/selection labels; saved answer text,
  native financial controls, commands, private artifacts and IPC remain unchanged.

## Admission dependency: root-owned producer composition

This branch is **not merge-ready**. The root coordinator must review and coordinate
the narrow `lib/agent/run-agent.ts` delta with the active301 owner before applying
it. That delta must honor the trusted bot presentation option, opt ordinary
synthesis into the existing language review, select only language-admitted model
sentences, and stamp provenance after every final answer projection. Never stamp a
special/private, unobserved, mixed-language or subsequently changed answer as known.
Early returns and additional generated follow-up/recency/teaching prose require
their own observed renderer coverage or remain unknown. The concrete helper APIs
are implemented; this worker did not overwrite the301 producer file/test.

Until that composition is accepted, the new structured preference is not honored
by the unchanged producer and the new provenance is not emitted in real runs.
The command copy and consumers therefore belong to the same unshipped candidate,
not an independently deployable preference feature.

Metadata277 retains public page/archive/feed/OG/sitemap ownership. Root should give
that owner `recordedAnswerLanguage(run)` after producer composition. Stdio MCP's
current paid response has no trusted trace-language projection; it remains unknown
rather than inventing a field or altering a paid body/hash/receipt. Extensions keep
their established hosted/browser handoff. These gates remain explicit, not omitted.

## Original acceptance criteria

| Criterion | Current qualification |
| --- | --- |
| C1: no English scaffolding for a shipped-language question | Partial source candidate. Ordinary owned labels implemented; root producer/web/stdio integration and273 financial/trust terminology acceptance remain. |
| C2: cited excerpts byte-identical to retrieved source | Fixed synthetic exact-span matrix checks raw UTF-8 evidence preservation. Markdown/HTML escaping is presentation encoding, not retrieval authenticity proof. |
| C3: stable machine contracts in every locale | Focused API/MCP machine-envelope tests retained/refreshed; field names, enums, codes, receipts and numeric authority remain English/stable. New owner preference endpoint is additive and documented. Full combined/package acceptance remains. |
| C4: every surface in one coordinated release | Root owns review, authorized push, same focused PR CI, merge, version/publication/distribution/deploy/Canteen. No delivery is claimed by this worker. |
| C5: answer/scaffolding agreement in evaluation set | Fixed deterministic-renderer and reviewer-observation fixtures cover en/vi/pt/es, mismatches and historical unknown. Final composed producer/surface matrix is still required. |

Human approval under273 is an existing financial/trust terminology gate. Ordinary
generated labels in this candidate do not introduce another human-review gate.
Canonical English financial/claim authority remains visible where that gate is
unaccepted. No locale flag is enabled.

## Verification and handoff

Focused synthetic checks use an exact matching read-only root dependency graph,
Node24.21.0, isolated caches/compiler outputs and mocked channels/providers. Test
receipts capture exit code, signal, stdout/stderr EOF and raw stream hashes. Failures
and corrections are retained under `output/language276` rather than discarded.
Application/ops type checks and scoped lint are recorded separately.

Desktop type checking could not resolve its existing `@tauri-apps/api/core`
dependency. An isolated pinned install was reserved and attempted with scripts,
audit and funding disabled; the managed offline npm configuration refused a missing
cached tarball (`ENOTCACHED`). No offline-policy override or alternate download was
used. Root must arrange an allowed matching Desktop dependency installation and
refresh Desktop acceptance. Full Next build, package/native consumer checks and
hosted aggregate/domain CI must bind root's finalized combined candidate.

The review request and exact commit/check/handoff references live in the native
launch capture folder. Keep the original276 criteria open until genuinely delivered.
