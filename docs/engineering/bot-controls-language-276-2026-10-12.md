# Bot help, private placeholder and language controls (#276)

This adds the remaining bot-owned help/control paths to the previously reviewed
[question-language result wrappers](bot-wrapper-language-276-2026-10-11.md).
It does not claim completion of the original cross-surface issue or deployed delivery.

## Actual language authority

The shipped bot catalogue is finite: `en`, `vi`, `pt` (Brazilian Portuguese catalogue,
also accepted as `pt-BR`) and `es`. Command names, option names and stored values remain English
machine identifiers. Bare help has no question: an explicit help locale wins over the stored
help preference, then a supported authenticated sender-platform locale, then English. Telegram
uses `from.language_code`; Discord uses the interaction's `locale`; Slack's existing signed
slash-command payload supplies no supported locale hint. No browser/system/global locale is read.

`/language` truthfully controls **help language only**. Inspection changes nothing; an explicit
value saves that preference and reads it back before confirming success. `auto` is a reset value
that makes future help use the platform hint/English fallback. Help overrides are request-local.
Unsupported values return the supported values without a write. Missing/refused/corrupt storage
produces an unavailable notice; a failed save never reports success or echoes backend details.

Research progress, results, limits, failures and the Telegram sender-private claim preflight
placeholder still use the exact original question's existing answer-presentation selector.
Neither the question nor generated answer is rewritten to apply a stored help preference.
Nothing is labeled translated. Explicit answer-language instructions belong in the question.
The coordinator's remaining source gate is a trusted, typed answer-language preference passed
through generation, evidence review and report scaffolding, preserving the original question;
bot adapters must not synthesize an `originalQuestion` or append hidden directives to fake that
contract. No shared pipeline/report changes are included here.

## Private persistence and delivery

The existing application storage contract exposes `getSyncState` and `setSyncState`; the
enrolled SQLite and Supabase method inventories classify these as read and write respectively.
Only these existing capabilities are used. No schema/migration/backfill or alternate datastore
is introduced. Supabase sync-state reads distinguish a successful missing row (`null`, automatic
help preference) from a returned query error (unavailable). A failed read or write readback cannot
confirm a preference, even if the backend also returns stale data; backend details stay private.
The enrolled RPC/identity path and SQLite readback are unchanged.
The namespace `keryx:bot-help-language:v1:<sha256>` hashes a canonical tuple of
platform, scope and verified sender. Telegram scope is the webhook's bot context (`telegram`);
Discord scope is application ID; Slack scope is workspace ID. Values contain only the finite
locale or `auto`, never questions, sender/channel IDs, wallet/account linkage, tokens, email,
credentials or run claims. Hashing is pseudonymization, not anonymization: these rows remain
private application state. Changing bot identity within one deployment requires owner review
of the Telegram namespace; no historical identity migration is inferred.

Transport authentication precedes every preference read/write. Unknown or invalid recipient
bindings cannot open storage. Telegram preference operations additionally require a private
chat addressed to the authenticated human sender; group operations neither read nor write
preferences. Group help uses a request-local locale/platform hint, never a private preference.
Discord controls are ephemeral (`flags:64`); Slack controls are ephemeral inline responses.
Controls never enter sponsored admission, `after()` research, provider calls or outbound fetch.

The private Telegram placeholder changes only its text. Its protected sender address, private
acknowledgement/matching message checks, refusal before research, fallback destination and
separate credential delivery stay intact. Private claim packets and authority text are unchanged.
Existing financial help paragraphs remain byte-identical English and are identified as English
financial details in non-English help. The financial/trust-copy approval gate of #273 is still
open; these ordinary scaffolding translations do not claim that approval.

## Verification and delivery admission

Focused offline controls cover all four locales, real local signature verification, refused
authentication before storage, private/group recipient isolation, durable isolated SQLite
sync-state roundtrips, readback failures and honest fallback. The existing evidence/amount/mode
and private claim delivery controls remain applicable and are exercised alongside the new
paths. No live message, model/search request, payment, production DB access or registration
is part of verification. Application and operations TypeScript check the adapters/registration
source; no credentials are needed. Retained prior 15-file/231-check/source-37 review evidence
continues to qualify unchanged result-wrapper bytes, not the new help/control source.

| Surface | This source outcome / remaining original gate |
| --- | --- |
| Telegram | Localized ordinary help and private preflight placeholder; private help preference. Root coordinated delivery and command-menu registration remain unproved. |
| Discord | Localized ordinary ephemeral help; application/sender help preference; registration definitions. Root command registration and delivery remain unproved. |
| Slack | Localized ordinary ephemeral help; workspace/sender help preference through existing `/keryx`. Root delivery remains unproved; standalone commands are optional separate registrations. |
| Web / report / API / remote+stdio MCP | Unchanged. Shared answer preference and answer/scaffold agreement remain coordinator-owned. English fields/enums/errors/receipts retained. |
| CLI / Desktop / extension | Unchanged. System-locale/override integration and synchronized distribution remain respective owners' gates. |
| Email / other notifications | Unchanged. Bot-recipient preferences are not source-owner email preferences; no new recipient/channel binding or successful stored email preference is claimed. |

Root independent review, applicable hosted aggregate CI, coordinated main/release/distribution
and original-criteria evaluation govern admission. No live outbound trial or translation of
quoted/cited evidence is introduced. #276 remains open until its original surface/language
agreement/delivery criteria are met.
