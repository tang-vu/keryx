# Issue217: preserve a later newest-release instruction before BUY

The full saved [issue217 dispatch](https://keryx.cc/dispatch/76fa4ed9-615b-4db5-a813-9362faf177d7)
starts with analyst context, names the exact GitHub Atom feed in a second sentence,
then asks: “In English, name the newest release tag actually present in the feed”.
The issue body's shortened `Name the newest release in <feed>` example does not
preserve this original wording. The full public question is retained as an inert
[test fixture](../../test-support/issue-217-request-fixture.ts).

On main43 source `6e591603`, the beginning-only temporal detector returned no
requirement for that full question. An intercepted shared-agent regression
reached the older v0.27.10 fixture's .005 article BUY despite newer v0.27.18
metadata. The gateway threw before settlement; this reproduction used no live
feed, model, search provider, database or payment. Native observation helpers
were already merged and correctly guarded the shortened question; they could
not qualify a temporal requirement that the detector never retained.

## Deliberate correction

The earlier [original-text detector](../../lib/sources/source-recency.ts) correction
found its existing positive command family at an unquoted sentence or line
boundary, with an optional `In English,` or `In Vietnamese,` prefix. It retained
the full saved question as `unsupported-temporal-form` with the original URL
binding and command span, withholding the registered feed before catalog
selection, funding, CACHE or BUY. That correction did not guess what “the feed”
meant or grant native observation authority from surrounding prose. Multiple
original URLs and unresolved bindings keep their existing refusal.

Existing qualified initial forms, such as `Name the newest release in <exact
feed URL>`, keep their bounded native observation path. The current-feed resolver
still requires complete native document membership, explicit publication dates,
a unique newest entry and an exact catalog winner. It never substitutes an older
indexed article after an uncertain or missing winner. Native metadata does not
establish the release's change, compatibility, body integrity or payment authority.

| Original wording | Current boundary |
| --- | --- |
| `Name the newest release in <exact feed URL>` | Existing qualified native observation; exact eligible catalog winner or a visible gap |
| Adjacent positive `Read the registered, verified creator release source associated with <exact URL>.` then `In English, name the newest release tag actually present in the feed` | Finite original caller binding; existing native observation and exact catalog-winner checks still required |
| Context followed by a direct `Name` / `Identify` / `Find` / `Compare` newest/latest command | Conservative unsupported hold; no new native scope inferred |
| A quoted example or `Do not name the newest release` | Does not manufacture a positive temporal requirement |
| A line wrap after `Do not` / `Don't` / `Đừng` / `Không`, or an explicit `Example:` / `Ví dụ:` label | Remains a negation or example; optional language/please modifiers across lines do not create a positive command |
| Multiple original feed URLs or unresolved binding | Existing ambiguous/unresolved refusal; no guessed feed membership |

This remains a narrow grammar. Inline clauses without a recognized sentence/line
boundary and conversational questions such as “Which release is most recent?”
are outside its recognition coverage and can still enter ordinary topical
selection. These finite forms do not establish general natural-language temporal
understanding. Extending those forms or
introducing a structured caller requirement remains separate work.

## Original-task newest-selection qualification

The earlier refusal was insufficient for acceptance criterion 2: the shortened,
free public-reference test did not show newest selection for the full original
registered-creator task. The current correction adds only the adjacent two-sentence
form in the table. Both commands must be positive and unquoted at a sentence/line
boundary, the Read sentence must immediately precede the temporal command, and
there must be exactly one safe original URL. The Read role wording and temporal
directive are finite; the feed URL, vendor, analyst context and release tag are
not hardcoded. A second temporal directive, negated/quoted Read binding, ambiguous
or different feed, stable/prerelease/cutoff/retained form cannot grant this binding.
The positive `newest prerelease tag` family is retained as an unsupported hold,
including when it lacks the separate word `release`.

This binds selection, never registration or payout authority. The unchanged
per-run native observer must still obtain one bounded complete document, mint an
opaque observation with raw-byte and cohort digests, validate native date roles,
reject uncertain membership or tied newest entries, and resolve the exact winner
against its source/link/title/publication/catalog identity. Legacy retained rows
cannot mint that observation. Wanted/private/brief/unattended and other existing
held scopes keep their restrictions. Neither model decomposition nor topical
overlap can erase the retained original requirement.

The expanded [original-task test](../../lib/agent/issue-217-original-request.test.ts)
uses the byte-identical saved question, a synthetic registered creator source
with a .005 access price and all ten rows from the existing
[frozen fixture](../../lib/sources/fixtures/issue-217-retained-releases.json).
The rows' URLs are mapped to the task's exact GitHub feed and native Atom document;
these invented bytes are returned by intercepted transport, not a live read or
reconstruction of the paid original. The fixture clock is separate from the old
retained-set capture time. No retained snapshot is promoted into an observed
capability: the real observer parses the controlled full response and the actual
catalog adapter resolves it normally.

The ordinary relevance selector demonstrably prefers stronger-overlap v10.
For the original task, only v18 reaches the creator decision before either BUY
or CACHE. BUY retains the exact source, article and .005 price, then its real-mode
gateway fixture throws before settlement. The final response truthfully says no
supported answer/read payment was confirmed and distinguishes the native ordering
observation from unverified release changes/compatibility. CACHE uses explicit
synthetic retained bytes; absent qualifying evidence, no reward is forced. Both
cases report zero settled/pending payments, spending and creator reward. If the
observed v18 has no exact catalog match, no funding, decision or older BUY follows.
The same-source nonrecency case still admits v10 through ordinary relevance.

Six focused suites pass 178 tests, including the original-task BUY/CACHE paths,
unindexed winner, unsupported full-task variants and unchanged observer/adapter
authority regressions. A positive original-task assertion fails on the base
before the recognizer correction. Initial capture-helper and fixture-assertion
failures are retained separately and are not acceptance evidence. Application
TypeScript and scoped lint pass. Checks use pinned Node 24.21, an OS allowlist
plus explicit offline/testnet settings, blank Supabase values, denied outbound
transport and no environment loader. Synthetic fixture evidence establishes
source behavior only.

## Authority and supported surfaces

Only the shared detector, focused fixtures and this rationale change. Existing `runAgent` callers
in web/API, CLI, hosted and stdio research adapters retain the same original-text
guard; model targets and source tags cannot create or erase its requirement.
Their current native-read role limits remain. Protected private/package/wanted,
brief, paid-paper and unattended engine runs gain no native probe or new contract.
Desktop/Operator and extensions retain their existing reduced/shared handoff roles.
Saved runs and paid-original recovery preserve their original request, receipt
and evidence; this change does not reissue an old task.

Registry activation, source-owned `payTo`, exact item/content version, paid-body
commitments, offer validation, spend limits, pending/settled evidence and citation
reward gates are unchanged. Withholding a new irrelevant article does not refund
historical access, erase service/model costs or make public evidence rewardable.
The old dispatch's .005 access and zero reward remain historical outcomes; it is
not relabeled as a repaired acceptance run.

## Verification and remaining gates

The expected-no-BUY regression failed on main43 with the older item and .005
amount visible in the intercepted gateway call. After that earlier correction,
that exact shared-agent case had no funding, catalog selection, article BUY,
payment record, citation reward or native read, and returned the explicit gap.
Focused tests retain the existing qualified native winner and membership/date
failure coverage while adding contextual commands, sentence/line boundaries,
quotes/code examples, negation and ambiguous binding. All fixtures remain inert.
Wrapped negation/example regressions cover English and Vietnamese while preserving
direct commands after a newline, blank line or completed example. These specific
continuation prefixes do not establish general prose or negation understanding.

Required CI, independent root review and deployment of the final accepted source
remain release gates. No version, production setting, funding, custody or source
rights change is included. Fixture refusal does not prove a supported live
tag/change answer, a real caller's usefulness, deployment or independent adoption.
