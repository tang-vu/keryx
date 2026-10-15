# Wallet and agent-budget onboarding

Owner direction, October 15, 2026: Google sign-in should lead to an approachable
wallet and reusable agent budget. Users should not have to understand spending
sessions or repeat setup for each conversation.

## User flow

After sign-in, **Wallet & budget** opens `/me/wallet`. The same entry is available
beside the budget in chat. The wallet page groups receiving USDC, reviewing an
agent budget, and withdrawing unused research funds. **Ask Keryx** returns to chat.
An active budget is reused by the existing signer; chat shows a compact allowance
summary with budget controls in a disclosure.

The receiving address carries the selected network. Receiving wallet funds and
authorizing research spending remain separate operations. The wallet's balance
reader retains its unavailable state and refresh action. Optional bank funding
keeps its existing configuration, eligibility and confirmation requirements.

Withdrawal review, confirmation, status, owner mint and final verification keep
their original handlers. The wallet page uses plain action labels and hides manual
request/hash entry and cancellation controls under **Recovery details**. Existing
withdrawal records and recovery remain reachable. This is not a new transfer rail,
automatic signing, or a funded withdrawal acceptance claim.

## Financial and recovery boundaries

The total allowance, per-question maximum, duration, funding approval/deposit,
owner consent, signer, nonces, retained liabilities and settlement evidence are
unchanged. Opening a page or disclosure does not fund, sign, renew, or raise a
budget. Expired and paused chat bindings retain their original spending identity.
The compact remaining allowance is not an assertion of a withdrawable balance.

Fund controls require a signed-in account with a matching connected wallet.
Switching wallets or signing out removes those controls. Clipboard refusal leaves
the receiving address available for manual copying.

Keryx does not implement Google-wallet private-key export. Its interface says so
without promising an unsupported provider operation. The separate research signer
still depends on this browser's retained custody; Google sign-in on another device
does not restore it. The recovery disclosure explains that distinction.

## Supported surfaces and release

Web owns the wallet controls and the new page. Desktop, browser extension and
Telegram/Discord/Slack continue to use their existing browser handoffs. CLI,
remote/stdio MCP, buyer/Operator and paid APIs retain their existing custody and
payment roles; Google sign-in grants none of those callers new spending authority.
There is no schema, public API or package-version change in this outcome.

The new English namespace has explicitly uncovered, empty Vietnamese and Chinese
draft bindings. Existing translations and source bindings are preserved; this does
not activate translated financial or recovery prose.

Acceptance includes focused wallet/budget/recovery browser cases, styled layouts
at 320/768/1440px, TypeScript, affected-source lint, copy checks, a production build,
independent review and the required hosted PR checks. Merge remains coordinated;
production deployment belongs to the existing batched release owner.
