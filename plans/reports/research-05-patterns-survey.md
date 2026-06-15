# Reference Repo Survey: Citation-Toll Reading Agent Patterns

**Survey date:** 2026-06-15  
**Focus:** Reusable payment, escrow, conditional settlement, x402 seller patterns for multi-author citation-pay architecture.

---

## 1. circle-agent

**Purpose:** Explainer companion to Circle x402 nanopayments demo. Zooms into: "what actually happens when an x402 payment settles?"

**Stack:**
- Express server (Node.js 20+)
- Circle x402 batching middleware
- Viem (for onchain decode)
- Arc Testnet USDC

**Key Artifacts:**
- server.ts — paywalled endpoint + settlement/batch tracing API
- decode-batch.ts — decodes submitBatch() calldata to extract per-buyer deltas and net transfers
- buyer.ts — CLI buyer using GatewayClient

**X402 Seller-Side Pattern (Minimal & Production-Ready):**

From server.ts lines 16-41:
- createGatewayMiddleware({ sellerAddress, facilitatorUrl, networks })
- app.get("/endpoint", gateway.require(".01"), (req: PaidRequest, res) => { ... })
- req.payment = { verified, payer, amount, network, transaction }

**How It Works:**
1. Client signs EIP-712 off-chain (MetaMask, no gas)
2. Middleware forwards to Circle facilitator → settles immediately
3. Server receives req.payment injected by middleware
4. settlementId surfaces in response (UUID, queued optimistically)
5. Circle relayer batches multiple payments → calls submitBatch() on Arc
6. decode-batch.ts unpacks batch calldata to show per-buyer transfers + net flows

**Batch Decoding for Multi-Payment Analysis:**
- Decodes per-address deltas (negative=debit, positive=credit)
- Pairs deltas to infer net transfers (line 104-117 of decode-batch.ts)
- Settlement UUIDs matched via timestamp heuristic (±10s window), not deterministic
- Useful for tracing, risky for production settlement confirmation

**Reuse for Citation-Toll:**
- Wrap your /read/{citationId} endpoint with gateway.require("")
- Extract payer + amount from req.payment
- **Limitation:** No payment-split logic in this repo

---

## 2. arc-escrow: Escrow + Conditional Settlement

**Purpose:** AI-powered work validation with USDC escrow-backed agreements on Arc.

**Stack:**
- Next.js + Supabase (RLS-protected)
- Circle Developer Controlled Wallets
- Circle Smart Contract Platform (EIP-712 RefundProtocol)
- OpenAI vision (work validation)

**RefundProtocol.sol (MOST RELEVANT FOR CITATION-TOLL):**

File: C:/Users/tangm/_hackathon_ref/arc-escrow/contracts/escrow_smart_contract/RefundProtocol.sol

`solidity
struct Payment {
  address to;               // recipient
  uint256 amount;
  address refundTo;         // fallback for refunds
  uint256 withdrawnAmount;  // partial withdrawals tracked
  bool refunded;
}

mapping(address => uint256) public balances;    // per-address escrow balance
mapping(address => uint256) public debts;       // arbiter can cover shortfalls

// Arbiter conditional refund (key pattern for citation-toll validation)
function refundByArbiter(uint256 paymentID) external onlyArbiter {
  if (payment.amount <= recipientBalance) {
    balances[payment.to] -= payment.amount;
  } else {
    balances[arbiter] -= payment.amount;
    debts[payment.to] += payment.amount;
  }
  fiatToken.transfer(payment.refundTo, payment.amount);
}

// Early withdrawal with recipient signature (optional fee)
function earlyWithdrawByArbiter(
  uint256[] paymentIDs,
  uint256[] withdrawalAmounts,  // partial release per payment
  uint256 feeAmount,            // platform fee
  uint256 expiry,
  uint8 v, bytes32 r, bytes32 s // recipient signature
) onlyArbiter {
  // arbiter can force partial release (e.g., validated 70%, hold 30%)
  fiatToken.transfer(recipient, totalAmount - feeAmount);
  balances[arbiter] += feeAmount;  // arbiter extracts fee
}

// Debt settlement (auto-reconcile after withdrawals)
function _settleDebt(address recipient) internal {
  uint256 settleAmount = min(recipientBalance, recipientDebt);
  balances[recipient] -= settleAmount;
  balances[arbiter] += settleAmount;
  debts[recipient] -= settleAmount;
}
`

**State Machine for Validation (Circle webhook pattern):**

File: C:/Users/tangm/_hackathon_ref/arc-escrow/app/api/webhooks/circle/route.ts

`	ypescript
async function updateAgreementTransaction(transactionId, notification) {
  switch(notification.state) {
    case "COMPLETE":
      if (type === "DEPLOY_CONTRACT") 
        supabase.update({ status: "OPEN" });
      if (type === "DEPOSIT_PAYMENT") 
        supabase.update({ status: "LOCKED" });
      if (type === "RELEASE_PAYMENT") 
        supabase.update({ status: "CLOSED" });
      break;
    case "FAILED":
      supabase.update({ status: "OPEN" });  // revert to safe state
      break;
  }
}
`

**Reuse for Citation-Toll:**
1. Replace states: SUBMITTED → REVIEWED → SPLIT_QUEUED → SETTLED
2. Same webhook signature verification (lines 213-259)
3. Same idempotency approach (exit early if state unchanged)
4. Extend contract for multi-author:
   `solidity
   struct Citation {
     uint256 escrowAmount;
     address[] authors;
     uint256[] splits;        // 1e18 = 100%
     address validationOracle;
     bool validated;
   }
   `

**Critical Limitation:**
- No explicit multi-recipient logic in existing code
- RefundProtocol is 1-depositor → 1-beneficiary
- Balances mapping is foundation, but no split distribution

---

## 3. arc-commerce: Transaction Recording + Idempotency

**Purpose:** USDC payment for credit purchases on Arc.

**File:** C:/Users/tangm/_hackathon_ref/arc-commerce/app/api/transactions/route.ts

`	ypescript
// Idempotency via composite key
const idempotencyKey = "\:\";

const { data: insertedTransaction, error: insertError } = await supabaseAdminClient
  .from("transactions")
  .insert({
    transaction_type: "USER",
    user_id: user.id,
    amount_usdc: usdcAmount,
    idempotency_key: idempotencyKey,  // DB unique constraint
  });

// Duplicate detection (PG 23505 = unique violation)
if (insertError?.code === "23505") {
  const { data: existingTx } = await supabaseAdminClient
    .from("transactions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .single();
  return { ok: true, transactionId: existingTx.id };
}
`

**Event Aggregation:**

`	ypescript
// GET /api/transactions aggregates status events
const { data: transactions } = await supabase
  .from("transactions")
  .select("*");

const { data: statusEvents } = await supabase
  .from("transaction_events")
  .select("*")
  .in("transaction_id", ids);

const enriched = transactions.map(t => ({
  ...t,
  status_events: statusByTx.get(t.id) || [],
}));
`

**Reuse for Citation-Toll:**
- Idempotency key: \:\:\
- Extend schema: add splits array with author allocations
- Event types: SUBMITTED, AI_REVIEW_STARTED, REVIEW_COMPLETE, SPLIT_QUEUED, AUTHOR_1_PAID, ...

---

## Multi-Author Payment Splits: THE CRITICAL GAP

**None of the three repos implement 1-payment → N-recipient splits at contract or application level.**

arc-escrow comes closest:
- balances mapping supports arbitrary addresses
- RefundProtocol could theoretically extend with multi-recipient struct
- **But no existing code does this**

**Recommended Design (Contract-Side):**

`solidity
struct Citation {
  uint256 escrowAmount;
  address[] authors;
  uint256[] splits;              // [6000, 3000, 1000] = 60%, 30%, 10%
  address validationOracle;
  bool validated;
}

function validateAndSplitPay(uint256 citationId) external onlyOracle {
  Citation storage c = citations[citationId];
  require(!c.validated, "already paid");
  
  uint256 total = c.escrowAmount;
  for (uint i = 0; i < c.authors.length; i++) {
    uint256 amount = (total * c.splits[i]) / 10000;
    balances[c.authors[i]] += amount;
  }
  c.validated = true;
}
`

---

## Top 3 Reusable Assets

| File | What It Gives | Reuse Path |
|------|---|---|
| circle-agent/server.ts (16-41) | x402 Seller endpoint (createGatewayMiddleware) | Wrap /read/{citationId}; extract payer from req.payment |
| arc-escrow/RefundProtocol.sol | Escrow + arbiter conditional logic (balances, refundByArbiter, fee extraction) | Fork + add Citation struct with authors[], splits[]; arbiter validates and splits |
| arc-escrow/api/webhooks/circle/route.ts | Circle webhook state machine (signature verification, safe transitions) | Replace states (PENDING→LOCKED→CLOSED) with citation states; reuse verb pattern |

---

## Key Findings Summary

1. **x402 seller-side is minimal & clean** — 5-line middleware (circle-agent/server.ts)
2. **Escrow + arbiter conditional logic is foundation** — fork RefundProtocol for multi-recipient variant (arc-escrow/RefundProtocol.sol)
3. **Settlement UUID→TX matching is heuristic** — timestamp window (±10s), risky for production
4. **No multi-author splits implemented** — you must design it (contract + off-chain orchestration)
5. **Webhook state machine pattern is reusable** — same verification, different state names

---

## Unresolved Questions / Friction

1. **Multi-author split orchestration: Design gap**
   - On-chain (extend struct with authors[], splits[]) or off-chain (batch transfers)?
   - **Recommendation:** On-chain (atomic, auditable), requires custom contract audit.

2. **Settlement UUID→TX matching: Heuristic risk**
   - timestamp window (±10s) masks individual citations in high-volume batches
   - **For prod:** Deterministic mapping (store UUID, verify aggregate on-chain, mark settled).

3. **x402 batching latency**
   - Arc testnet: ~10 min (low traffic)
   - **Clarify:** "Citation paid" = EIP-712 signed (instant) or on-chain batch (delayed)?

4. **AI validation workflow: Unclear**
   - arc-escrow uses OpenAI vision for deliverable verification
   - Citation-toll: How to determine validity + author weights?
   - **Questions:** What oracle? How to scale weights? Who triggers release?

5. **Idempotency for multi-user scenario**
   - Idempotency key = (citationId, payer) — non-deterministic
   - If 2 users cite same paper before arbiter validates, both succeed → double-pay
   - **Need mutex or validation queue**
