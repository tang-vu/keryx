# Circle wallet research acceptance and funding recovery

The October 16–17 browser trial verified an actual Google/Circle wallet login on
the deployed Arc mainnet profile. It did not establish a completed funded research
session or paid answer. A retained owner funding plan had an uncertain approval
without a saved transaction hash; its deposit was still ready. The existing guard
correctly refused a different new funding plan. Wallet identities, balances and
private browser records remain outside this document.

## Recovery behavior

The wallet and conversation budget panels now show the active owner's existing
funding plan, approval/deposit states and original-hash inspection. Inspection uses
the existing transaction verifier and journal compare-and-set operations. It can
confirm only the matching original on the pinned network, with its sender, target,
nonce, calldata, amount and finalized receipt. Missing, mismatched or unavailable
evidence retains the hold. This panel cannot sign, send, replace or cancel a
transaction, create funding, renew a budget or release an uncertain hold.

A retained browser signing key with no admitted budget ceiling no longer produces
the claim that a funded budget is saved, or the “Continue with saved budget” label.
The existing saved-budget recovery action remains available.

## Verification and surface boundaries

Focused browser tests exercise the real IndexedDB journal and verifier with a
synthetic read-only RPC. They cover the original plan, a mismatched transaction,
successful original verification and an account switch during lookup. Existing
custody recovery, wallet workspace, funding client, replacement and policy tests
also pass: 65 tests across six files. Affected-file ESLint, the UI copy guard and
diff whitespace checks pass. An independent payment-path review found no required
corrections. Hosted TypeScript, build and applicable CI remain merge gates.

Web wallet and conversation panels share this component. Desktop browser handoff,
CLI, API, remote/stdio MCP, extensions and bots retain their existing owner-browser
funding handoff; they gain no signer, custody or funding API. No public contract or
distribution version changes. Deployment belongs to the existing release batch;
source tests do not establish deployed behavior.

The real paid-research acceptance remains open until the original transaction can
be reconciled, the owner completes any required funding/budget confirmation, and
an answer's original access and citation receipts are verified. A missing hash,
elapsed time or an empty balance alone cannot establish that an original was not
sent. No new payment was made by the agent during this trial.
