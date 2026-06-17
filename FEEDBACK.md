# Dev-Tool Feedback — Circle & Arc

Friction, bugs, and improvement ideas captured while building Keryx on the Circle x402 / Gateway
stack and Arc testnet. Targets the dev-feedback prize. Can be submitted via `circle feedback submit`
(the condensed, ≤2000-char version we actually submitted lives in
`plans/reports/circle-feedback-submission-260617-1150.md`).

## High-impact

1. **The facilitator's 7-day authorization-validity floor has zero slack — and is undocumented.**
   The buyer signs `validBefore = now + maxTimeoutSeconds`. The Gateway facilitator rejects `verify`
   with `authorization_validity_too_short` unless the *remaining* validity at verify time is still
   ≥ 7 days (604800s). We set exactly 604800 and got **intermittent** settlement failures — every few
   citations one would die. The cause is zero slack: signing→verify network hops, second-truncation,
   and host clock skew each shave the window, so a value equal to the floor keeps dipping just under
   it. Raising to ~8 days (691200) fixed it completely. The painful part is discoverability — nothing
   tells you the floor exists; you only meet it as a cryptic error under load. (Verified in
   `lib/config.ts` / `lib/x402.ts`; the scaffold's 345600 (4d) fails outright post Arc v0.7.2.)
   **Ask:** document the 7-day floor plainly, or measure validity at *signing* time, not verify time,
   so a correctly-sized window can't decay underneath you.

2. **No programmatic / CLI faucet blocks autonomous agent testing.**
   `faucet.circle.com` requires a human (captcha/login). There is no `circle faucet` command and no
   faucet API. An autonomous *payment* agent can't fund itself for CI/testing — a human must intervene.
   **Ask:** a rate-limited testnet faucet API or `circle faucet --address --chain arcTestnet`.

3. **`@circle-fin/x402-batching` is under-documented; the SDK is only learnable from `.d.ts`.**
   `GatewayClient.pay()` returns `PayResult { data, amount, transaction, formattedAmount, status }`,
   `deposit()` returns `DepositResult`, etc. — none of this is in the public docs we could find. The
   Gateway nanopayment settlement REST endpoints were effectively undiscoverable (we marked several
   "UNVERIFIED" during research and had to read source).
   **Ask:** a "GatewayClient API reference" page + a minimal buyer/seller code sample beyond the demo.

4. **Arc uses native USDC as the gas token (18 decimals) while ERC-20 USDC is 6 decimals.**
   This is a real footgun: funding gas uses `parseEther(...)` (18dp) but USDC transfers use
   `parseUnits(amount, 6)`. Easy to mix up and send 10^12× the intended amount.
   **Ask:** call this out prominently in the Arc chain docs with a code snippet.

5. **No single "Arc testnet constants" reference.**
   USDC `0x3600…0000`, Gateway Wallet `0x0077…19B9`, chain id `5042002`, CCTP domain `26`, Gateway
   balance API `gateway-api-testnet.circle.com/v1/balances`, RPC `rpc.testnet.arc.network` — we
   assembled these from scaffold code + scattered docs. The USDC testnet contract address in
   particular we could only confirm from the scaffold, not the docs.
   **Ask:** one canonical constants table per network.

## Medium

6. **The `circlefin/arc-nanopayments` README oversells the agent.**
   It advertises a "LangChain + Deep Agents" paying agent, but `agent.mts` is a deterministic
   1-tx/sec loop with no LLM; `@langchain/*` and `deepagents` are installed but unused, and
   `OPENAI_API_KEY` is "optional (mock mode)". This cost real time to discover. Either wire the LLM
   or label it "payment traffic generator" so builders know the reasoning layer is theirs to build.

7. **Gateway balance API request shape is undocumented.**
   `POST {token:"USDC", sources:[{domain:26, depositor:<addr>}]}` and the decimal-vs-atomic ambiguity
   of the returned balance are only learnable from scaffold code (which even comments "may return
   decimal string or atomic units").

8. **Settlement finality is unclear.**
   When is a batched nanopayment "final" — at EIP-3009 signature, at batch submission, or at on-chain
   inclusion? A creator-facing product needs to know when to show "paid." Docs don't say.

## Minor
9. `circle --version` errored with a Node module-loader stack on first global install; a clean
   reinstall fixed it. Worth a postinstall sanity check.
10. Docs domain drift: links to `docs.arc.network` redirect to `docs.arc.io` — fine, but tooling that
   pins URLs can break.

## What worked well
- `@circle-fin/x402-batching` `GatewayClient.pay()` is a genuinely clean one-call 402 flow once you
  know the return shape — abstracts signing/retry nicely.
- `viem` ships `arcTestnet` as a built-in chain (id 5042002) — zero config.
- The `withGateway` seller pattern in the scaffold is a great, copyable middleware shape.
- `arc-canteen` bundling Arc repos/docs as agent context + `push` for traction is a smart idea.
- Arc's native-USDC-gas model means the agent only needs ONE asset (USDC) — no separate gas token to manage.
