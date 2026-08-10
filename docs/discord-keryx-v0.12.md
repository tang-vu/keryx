# Keryx v0.12 is live: an AI reader that pays the sources it cites

What if an AI reading agent had to **show its work — and pay the writers it actually cites?**

We just shipped **Keryx v0.12 on Arc** with three major upgrades:

### 🔏 Verifiable content

Publishers can now sign the exact article URL, SHA-256 body hash, and byte count with EIP-712. Buyers receive a verifiable delivery receipt, while `SourceRegistry` remains the authority for pricing, payees, and payout splits.

### 🔐 Encrypted paid content

Paid bodies and caches stay encrypted at rest. Keryx prefers encrypted IPFS storage and safely falls back to private encrypted database storage when IPFS pinning is unavailable — never silent plaintext.

We migrated **945 production articles** and verified:

- `0` plaintext body rows
- `0` unsealed cache rows
- `0` incomplete encryption envelopes

### 🧠 Attention-bounded agency

The reading agent now has an explicit attention budget across both `CACHE` and `BUY` decisions. Every source purchase, cache hit, and skip remains visible, so users can see not only the answer, but how the agent allocated its budget to reach it.

The release passed **657 application tests**, **16 smart-contract tests**, TypeScript checks, and a full production build. Commit `073250d` is live with real settlement enabled.

🌐 Try Keryx: https://keryx.cc  
🧵 Release thread: https://x.com/tangvu_dev/status/2086716952505160055

Feedback, edge cases, and publisher integrations are very welcome.
