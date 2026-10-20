# Preserve the newest owner acceptance observation — issue 250

The owner acceptance panel starts a read on mount and also permits an explicit
read. A slow initial response could arrive after a manual read and an acknowledged
Accept. It then replaced revision 1 with revision 0, displayed “No response
recorded” and used the obsolete revision for the next choice. An initial read
failure arriving after that successful submission instead displayed an unrelated
unavailable error. Both cases reproduce against the previous component in the
rendered `lib/deliverable-acceptance/browser.test.ts` regressions.

Each owner request now captures a generation. Starting an explicit read or
submission supersedes the mount-time observation. Only the current generation
can update the snapshot, error, pending submission or busy state. Existing
wallet/report keys, abort/unmount checks, displayed-answer digest verification,
expected-wallet headers and server compare-and-swap checks remain in force.
The regressions check that late initial success and failure preserve the
acknowledged choice and that the next choice carries revision 1.

This changes browser state ordering only. Lost acknowledgement still retains
the exact original input and idempotency key for explicit replay; reading current
state does not manufacture acknowledgement. The existing production browser
acceptance exercises lost acknowledgement, replay and public withdrawal at four
viewport widths. API/MCP/CLI schemas and journal/payment behavior are unchanged.

Issue 250 stays open. Original-only revision/refund execution, unsupported
original adapters and remaining rollout/product acceptance are outside this
fix. The [acceptance contract](deliverable-acceptance-250.md) retains those gates.
Source acceptance and the existing coordinator's batched runtime delivery are
separate outcomes.
