# Neutral repository CLI scaffolding (#276), October 15

This bounded source increment adds four neutral label keys to the existing
EN/VI/PT/ES client catalogue: engine, source cap, question and run ID. English
retains its original output. The repository `ask` CLI uses its existing system
locale / `--language en|vi|pt|pt-BR|es|auto` selection for the three pre-run
wrappers. After completion, the run ID wrapper uses the same strict
`recordedAnswerLanguage(run) ?? clientLanguage` selection already used by the
answer heading. Missing, future, malformed, duplicate or answer-mismatched
packets retain that existing fallback. A selected label language does not prove
the answer's language; missing provenance remains unknown.

Only wrappers change. The original question and saved answer, exact quotations,
engine/provider names, trace and diagnostics, run IDs, enums, machine codes,
contract signatures, amounts and arithmetic retain their existing bytes and
roles. The source cap still prints the existing numeric value and `USDC`;
citation amounts, totals, fees and contribution percentages keep their existing
formatting calls. Provider/generation, purchases, payments, session/auth and
private claim behavior are outside this increment.

Financial allocations/totals, simulation and settlement qualifications, separate
model/search costs, external-provider disclosure and private-claim warnings
remain canonical English. No legal or consent translation is added. Genuine
human review under [#273's content-bound instructions](../translation-instructions.md)
remains required for critical financial/legal/trust translations. These neutral
labels are agent-authored presentation copy, with no human translation approval
claimed. A language packet binds final answer bytes; it does not prove source
authenticity, factual correctness, settlement or human approval.

The focused `lib/i18n/cli-scaffolding.test.ts` authors pure system/default and
override cases, all four catalogues, recorded-answer precedence and honest
fallbacks, exact answer/quote bytes, micro-USDC/contribution formatting and source
integration guards for the original data expressions and critical English.
It reads `scripts/ask.mts` as text and never imports or launches that executable.
No new runtime helper, parser, locale registry or trace-console support is added.

Repository CLI presentation is the affected surface. Shared catalogue additions
are additive; web/API, desktop, remote/stdio MCP, extensions and bots retain
their current contracts. This is neither full CLI localization nor coordinated
language delivery. Original [#276](https://github.com/tang-vu/keryx/issues/276)
remains **OPEN**, including uncovered generation paths, human financial/trust
terminology approval, canonical evaluation and applicable distributed delivery.

## Validation and delivery

The 26 focused pure controls and the TypeScript check using the existing
operations-script options passed. The tests inspect CLI source and do not launch
the paid research executable or prove provider/generation behavior. Source review
found no changed authority, machine contract or critical English disclosure.

The companion [neutral Desktop increment](neutral-desktop276-scaffolding-20261015.md)
uses the same existing client language selection. A separate synthetic control
on the genuine enrolled SQLite facade passed save/readback, close/reopen,
recipient isolation, group nonmutation and runtime-drift refusal for the already
implemented bot language preference. It grants no transport authentication,
wallet linkage, spend authority or live outbound-message acceptance.

No changed source is in the offline study's runtime-source map, so the accepted
study is retained. Required PR and Desktop CI, merge and coordinated release
remain separate gates; only the existing release owner deploys the batch.
