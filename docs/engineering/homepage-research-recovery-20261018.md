# Homepage research recovery — October 18, 2026

The owner reported that the SQLite and children's educational video examples
ended in “No supported answer” or insufficient evidence. A fresh production
page also showed unavailable visibility settings and research availability.

Two independently reproduced defects are in scope:

- `readResearchVisibility()` performed `creationReady()` on GET. The SQLite
  implementation uses a zero-row UPDATE to verify the writer, which acquires a
  write lock even when no preference changes. A concurrent writer can block
  this synchronous operation and delay unrelated requests on the same process.
  Preference observation now reads only; `prepareAskPublication()` still proves
  creation readiness before any inference or payment.
- `JsonChatEngine.synthesize()` marked a failed relevance review unavailable
  without setting its existing failure stage. The final renderer consequently
  described missing qualifying evidence instead of an incomplete assessment.
  The engine now returns the review stage in that same unavailable branch.
  Evidence support, quote checks, citation eligibility, provider attempts and
  budgets retain their existing rules.

Acceptance includes genuine SQLite contention and read-only connection cases,
submit-time refusal, owner/default/visibility regressions, real-engine review
truncation/transport/malformed responses, and final answer, receipt and export
projection. All local fault cases use isolated data and synthetic transports.

The native desktop, stdio MCP and extension use hosted research handoffs rather
than embedding the changed server modules. Their package and installer inputs
are unchanged. Web/API, hosted MCP, OpenAI-compatible responses, local research
CLI and bots receive the shared server classification where applicable. Existing
result and payment contracts remain compatible; package identities are not
inferred from web deployment.

The original two reported executions have not been correlated with saved runs.
Historical unavailable search counts do not distinguish transport errors from
local admission refusals. Read-only provider management checks accepted the
configured credentials and showed remaining capacity; they do not establish a
successful search or model completion. The exact cause and usefulness of those
two live answers remain open. No provider/search retry, funding, allowance
renewal, migration or private hold change is part of this recovery.
