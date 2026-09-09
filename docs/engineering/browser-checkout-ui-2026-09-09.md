# Browser checkout and recovery UI — September 9, 2026

Scope: v0.22.21 connects the browser buyer engine to `/research`. The purchase flow
requires an EOA with existing Arc-testnet Gateway funds. It does not yet provide
browser deposits, contract-wallet support, authenticated server history or complete
fresh-wallet onboarding. B1/B2 and mainnet acceptance remain open.

## User journey and controls

The buyer enters a question, connects a wallet, switches to Arc testnet if necessary,
checks Gateway credit and reviews the exact question/package/price/payee. Changing
the question, wallet or price invalidates confirmation. The non-refundable package,
retained unused reserve, best-effort quality and local recovery-data limits are visible
before confirmation. A per-component synchronous operation guard stops repeated
clicks from creating concurrent purchases; the existing journal provides the atomic
per-intent cross-tab submission gate.

The connected-wallet adapter checks provider accounts and chain, not just the wallet
client's captured metadata. It checks again after the balance lookup and before signing.
Only the reviewed payer receives the EIP-712 prompt. The private intent is durable and
a recovery-file download is requested before signing; browser download restrictions
can still require the buyer to use the explicit download button. Signature bytes never
enter the local journal. A navigation abort prevents later signing/submission where
possible; an already submitted authorization remains recoverable and uncertain.

Saved jobs show the most recent 50 local records. Imports validate the original intent
and are recovery-only. Opening or refreshing a saved job does not need a wallet. The
workspace verifies package/economics and, on completion, the receipt's digest and
original-question/answer binding. A rehashed receipt for a different question fails.
The answer, source decisions, grounding and pending/settled creator spend remain
separate claims. Receipt export uses a local download without putting the job ID in
the address bar. Local deletion requires an explicit explanation/confirmation; it
does not cancel a job, revoke payment, refund funds or delete server data.

## Evidence and limitations

- Five adapter tests exercise live-provider account/chain reads, a change while
  Gateway lookup is in flight, and refusal to sign for another payer.
- `npm run test:browser-checkout` renders the actual React components and uses the
  real viem/IndexedDB buyer path with an unfunded synthetic wallet. It exercises
  review gating, question-change refusal, one signature and one signed POST,
  pre-sign recovery export, HTTP-500 acknowledgement, reload/import GET-only recovery,
  explicit deletion, completed receipt/decision rendering, verified download and
  refusal of a substituted rehashed receipt. All HTTP is intercepted; no settlement
  or independent customer usage is claimed. The test is required in CI.
- The same browser check passed with all CSS chunks from the local production build
  at 390px and 1440px without horizontal overflow. The desktop result was visually
  inspected. An initial screenshot used only a font CSS chunk and was unstyled;
  concatenating both actual build CSS chunks corrected the harness. Next's image
  component is stubbed in this isolated test; full Next production build passed.
- The existing browser engine check, focused regressions, TypeScript and ESLint
  remain required. A real browser-wallet testnet purchase, deposit interruption,
  mobile wallet handoff and independent buyer usability evidence are still required.

This advances the working buyer interface. It does not establish complete buyer
onboarding, recurring revenue, creator adoption, a security audit or mainnet readiness.
