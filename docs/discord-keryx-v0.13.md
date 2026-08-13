# Keryx v0.13 Discord announcement

Copy the text inside this block directly into a public Discord channel:

```text
Keryx v0.13.0 — Public Proof, With Its Limits Attached

Keryx is a citation-toll reading agent: it discovers sources, explains BUY/SKIP/CACHE decisions, buys selected x402 content, synthesizes a cited answer, and settles weighted USDC rewards to the creators it actually cites.

This release ships a live public proof dossier that connects:
• the exact GitHub commit and CI workflow running in production;
• settled-only payment and creator-reward metrics;
• independent usage separated from first-party autonomous traffic;
• Arc RPC head, registry indexing, and 20/20 SourceRegistry parity;
• Circle Gateway balance reconciliation; and
• recent creator cash-outs with ArcScan transaction links.

Live snapshot — August 13, 2026:
• 9,527 settled payments
• $45.154314 testnet USDC volume
• $39.234314 paid to creator wallets
• 20 registry wallets earning

Independent usage is reported separately:
• 142 external queries and 613 external payments
• 4 identified external actors; all 4 returned
• 68/68 measured external settlement attempts succeeded
• 9/9 positive feedback responses

These are Arc testnet figures, not mainnet revenue. Simulated and pending payments are excluded, and the proof page states what each source of evidence cannot prove.

Release gate: 661 application tests, 16 contract tests, TypeScript, ESLint, and a production build.

Public proof: https://keryx.cc/proof
X thread: https://x.com/tangvu_dev/status/2087928851326546140
Open source: https://github.com/tang-vu/keryx
Release: https://github.com/tang-vu/keryx/releases/tag/v0.13.0
```
