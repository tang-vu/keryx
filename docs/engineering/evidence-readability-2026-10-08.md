# Stored excerpt readability — October 8, 2026

App 0.27.36 is a source candidate, building on the HTML evidence-context candidate.
Production delivery requires current-main reconciliation, required CI and
deployed-commit readback.

## Observed problem and behavior

Actual AnswerCard and citation-panel components with production CSS reproduced a
16-pixel Evidence button, collapsed quote line breaks and horizontally overflowing
unbroken text at 360, 390 and 1280 pixels. The fixture uses synthetic records;
it makes no model, research, payment or external service request.

Quote inspection now preserves stored whitespace and wraps unbroken strings.
This applies to the citation panel, inline claim ledger, evidence matrix,
source-omission inspector, public job detail and private result views. CSV examples
and other multiline text remain readable without changing stored quote bytes.
The citation's Evidence action has a 44-pixel minimum target, a contextual accessible
name and a dialog hint. Existing focus restoration and Escape behavior remain.

## Acceptance and supported surfaces

The browser fixture exercises the actual components and freshly built CSS at
320, 360, 390 and 1280 pixels. It checks all six quote views, literal markup and
whitespace fidelity, quote/dialog geometry, the target size and keyboard focus
return. Synthetic transport permits only read observations; no research or payment
mutation is submitted. TypeScript, scoped lint, the default production build,
required exact-head CI and source review remain separate checks.

Integration retains main's sponsored operating settlement implementation and its
inactive policy boundary. The combined agent regression verifies that a withheld
newest-feed reference produces no citation, funding request or operating fee.

These are web presentation changes, including shared public/private result views.
Desktop clients opening those web pages receive the same presentation; their
native result rendering remains separate. API, CLI, remote/stdio MCP, native
desktop exports, extensions and bots retain their raw quote and receipt contracts.
No client package bump, settlement, custody, authorization or schedule change is
introduced. Published installer/package versions and the deployed commit still
need readback before synchronized delivery can be claimed.

Evidence eligibility, source identities, support estimates and archived content
remain as recorded. Readable rendering does not establish factual correctness,
independent corroboration, complete answers, finality or independent traction.
