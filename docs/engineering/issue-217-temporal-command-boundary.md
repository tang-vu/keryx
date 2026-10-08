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

The [original-text detector](../../lib/sources/source-recency.ts) now also finds
its existing positive command family at an unquoted sentence or line boundary,
with an optional `In English,` or `In Vietnamese,` prefix. It recognizes the
full saved question as `unsupported-temporal-form`, retaining the original URL
binding and command span. The registered feed is withheld before catalog
selection, funding, CACHE or BUY; the answer retains a newest-release limitation.
It does not guess what “the feed” means or grant native observation authority
from surrounding prose. Multiple original URLs remain ambiguous; missing or
invalid source binding retains its existing unresolved hold.

Existing qualified initial forms, such as `Name the newest release in <exact
feed URL>`, keep their bounded native observation path. The current-feed resolver
still requires complete native document membership, explicit publication dates,
a unique newest entry and an exact catalog winner. It never substitutes an older
indexed article after an uncertain or missing winner. Native metadata does not
establish the release's change, compatibility, body integrity or payment authority.

| Original wording | Current boundary |
| --- | --- |
| `Name the newest release in <exact feed URL>` | Existing qualified native observation; exact eligible catalog winner or a visible gap |
| Analyst context followed by `In English, name the newest release tag actually present in the feed` | Original source binding retained; unsupported wording held before the affected article read |
| Context followed by a direct `Name` / `Identify` / `Find` / `Compare` newest/latest command | Conservative unsupported hold; no new native scope inferred |
| A quoted example or `Do not name the newest release` | Does not manufacture a positive temporal requirement |
| Multiple original feed URLs or unresolved binding | Existing ambiguous/unresolved refusal; no guessed feed membership |

This remains a narrow grammar. Inline clauses without a recognized sentence/line
boundary and conversational questions such as “Which release is most recent?”
are outside its recognition coverage and can still enter ordinary topical
selection. This candidate establishes the exact issue217 request's safe refusal,
not general natural-language temporal understanding. Extending those forms or
introducing a structured caller requirement remains separate work.

## Authority and supported surfaces

Only the shared detector and focused fixtures change. Existing `runAgent` callers
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
amount visible in the intercepted gateway call. After the detector correction,
that exact shared-agent case has no funding, catalog selection, article BUY,
payment record, citation reward or native read, and returns the explicit gap.
Focused tests retain the existing qualified native winner and membership/date
failure coverage while adding contextual commands, sentence/line boundaries,
quotes/code examples, negation and ambiguous binding. All fixtures remain inert.

Required CI, independent root review and deployment of the final accepted source
remain release gates. No version, production setting, funding, custody or source
rights change is included. Fixture refusal does not prove a supported live
tag/change answer, a real caller's usefulness, deployment or independent adoption.
