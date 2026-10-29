# Original-report guidance after an interrupted stream

When an accepted research stream ended without a terminal event, the browser
correctly retained its original report reference but said “please try again.”
An interrupted connection does not establish that research or signed payments
stopped. That instruction could encourage a duplicate request.

Change the explanatory English error and its adjacent comment. Tell the
reader that the final report did not arrive, that stopping is unconfirmed, to
open the original saved report if available, and to retain recovery records
without automatically resubmitting or signing. The existing manual same-origin
GET link still requires a validated ordinary public/unlisted report reference;
private, missing and malformed metadata do not gain a public link.

Keep this authored explanation in the existing shared recovery-copy object.
The live alert marks only an exact match of that known English sentence with
`lang="en"`, so a Japanese interface does not change its pronunciation. Arbitrary
original diagnostics are neither translated nor assigned English by this match.

The EOF transition, generic error kind, original metadata, steps, payment records,
completed reports, terminal diagnostics and reset/replacement guards keep their
existing behavior. Fetch failures and explicit server errors remain separate.
No retry, signature, recovery fetch, cancellation, refund or settlement action
is added. Critical guidance remains English authority; no draft translation or
human approval is introduced.

Acceptance exercises the actual hook and live alert for public, unlisted,
private, malformed and missing references, preserving synthetic pending-payment
bytes and one POST. It checks completed/error terminals and late EOF after reset
or replacement. Chromium mounts the real hook, live renderer and locale providers
at 320/1366 under English/Japanese UI and verifies the known English paragraph's
language while preserving an unrelated original Japanese diagnostic. A zero-budget fake-origin stream ends
without a terminal event; an original-report GET occurs only after an explicit
link click. All signing, external and other requests fail the fixture. Four
frames use an isolated `interrupted-research` subdirectory of the existing hosted
unit screenshot artifact.

Parent PR757 must merge first. Reuse local checks only after an exact whole-tree
transplant onto its accepted squash commit; independent exact-head full CI,
domain/platform checks and hosted browser acceptance remain required. ROOT/Circle
retains the separate runtime/publication batch and every payment, custody,
original and prepared-cutover gate.
