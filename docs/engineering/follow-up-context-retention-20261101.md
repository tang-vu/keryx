# Follow-up question context and caller text

The three-turn email-job observation found correct owner/history links but an
incorrect research input. `/api/ask` sent a derived question to the agent and then
stored that derived question in `QueryRun.question`. The next follow-up copied the
first 240 characters of it, repeatedly nesting wrappers. By the third question,
the provider having no idempotency keys and the unknown email-send outcome were
absent. The original observations remain unchanged in the canonical local
`related-wallet-test-20261101` evidence directory.

The web adapter now retains its validated caller question in completed reports,
SSE results and planning-refusal history. The separate research input contains
only authorized recorded ancestor questions, presented as flat JSON context with
recent questions first. The complete current caller question precedes all context,
so prefix-bounded downstream readers retain its original positions. Earlier
questions are constraints, not additional research targets. No previous answer, purchased
source body or payment result is copied into the input. Explicitly linked requests
keep applicable earlier constraints even when the latest question is long.

The existing dispatch reader resolves every ancestor with the same request-bound
actor. Unknown immediate parents keep the existing standalone behavior; an
inaccessible older ancestor stops collection. The most restrictive included
visibility reaches the existing publication policy before inference or payment,
including a private ancestor of a currently public parent. A storage error remains
an error, rather than being relabelled as a missing record.

Collection has at most eight reads and 16,384 serialized context characters. It
reuses the existing immediate-parent read and collects older ancestors only after
the existing request admission succeeds; a rate-limited request cannot trigger
the additional ancestry reads. A stricter included ancestor re-enters the existing
publication guard before any provider/payment effect. Collection
prioritizes whole recent questions before adding older ones, detects cycles and
canonical aliases, observes cancellation and includes an omission marker when it
cannot carry older questions. Questions predating the current 2,000-character
input limit are bounded on a word/code-point boundary and marked as truncated.
Historical wrapped questions remain quoted recorded text; the implementation
does not guess their original contents or rewrite historical rows. Reading their
authorized ancestor records can recover conditions missing from a later wrapper.

The original six actual-route regressions reproduced four unmet expectations
before the change: lost third/fourth-turn conditions, raw refusal history and the
visibility guard needed when extending ancestry. The old implementation did not
read that private ancestor; this is a guard for the new context collection, not
evidence of a prior private-data leak. The route regressions use a synthetic
same-owner ledger, offline generator and real SSE/publication policy. Helper and
neighboring auth, publication, original-input, disconnect and budget tests retain
the failure boundaries. No live question, email or payment is submitted.

The observed Low-confidence answers also had insufficient qualifying evidence.
Preserving question context does not establish factual correctness or justify
raising confidence. Current source-bound full/domain CI and the normal coordinated
runtime delivery gates remain required. Source budgets, funding, signatures,
custody, settlement, stored originals and publication authority are unchanged.
