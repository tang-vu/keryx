/**
 * Seed sources for offline dev & demos. A spread of topics so the agent must DISCRIMINATE:
 * it should buy the payments/agent sources for a fintech question and skip gardening/retro-gaming.
 * "Onchain Micropayments Digest" is multi-author to exercise citation splits.
 */

import type { CreateSourceInput } from "./create-source";

export const SEED_SOURCES: CreateSourceInput[] = [
  {
    name: "Stablecoin Ledger",
    url: "https://example.com/stablecoin-ledger",
    description:
      "Deep coverage of stablecoins: USDC, EURC, issuance, reserves, and onchain settlement.",
    tags: ["stablecoins", "usdc", "payments", "settlement"],
    fetchPrice: 0.003,
    items: [
      {
        title: "Why USDC settles instantly onchain",
        summary: "USDC transfers settle in seconds with finality on most L2s.",
        content:
          "USDC is a fully-reserved dollar stablecoin that settles peer-to-peer onchain in seconds. Because settlement is final and programmable, it removes the multi-day delays of card networks and ACH. For machine-to-machine commerce, instant final settlement means an agent can pay and immediately receive a resource without counterparty risk.",
        link: "https://example.com/stablecoin-ledger/usdc-settles",
      },
      {
        title: "Stablecoins as the unit of account for agents",
        summary: "Dollar-denominated stablecoins give agents a stable budget unit.",
        content:
          "Autonomous agents need a stable unit of account to reason about budgets. A volatile token makes 'spend at most $0.05' meaningless minute to minute. Dollar stablecoins like USDC let an agent price expected value against cost in stable terms, which is a precondition for rational spending decisions.",
        link: "https://example.com/stablecoin-ledger/unit-of-account",
      },
    ],
  },
  {
    name: "Agent Economy Weekly",
    url: "https://example.com/agent-economy",
    description:
      "The emerging machine economy: autonomous AI agents that discover, negotiate, and pay for services.",
    tags: ["ai agents", "autonomous commerce", "x402", "machine economy"],
    fetchPrice: 0.004,
    items: [
      {
        title: "x402 turns HTTP 402 into an agent payment rail",
        summary: "The x402 standard lets a server demand payment and an agent pay inline.",
        content:
          "x402 revives the dormant HTTP 402 'Payment Required' status as a real payment rail. A server responds 402 with machine-readable payment requirements; the client signs a payment authorization and retries. Agents can therefore pay per request with no accounts or API keys, discovering and purchasing data autonomously at runtime.",
        link: "https://example.com/agent-economy/x402-rail",
      },
      {
        title: "Budgets make agents decide, not just automate",
        summary: "A spending cap forces an agent to weigh value against price.",
        content:
          "An agent under a hard budget must choose: which sources are worth paying for, when a cheaper source suffices, and when it has read enough to stop. This turns automation into genuine agency — every purchase is a reasoned trade-off, and the budget produces emergent frugality.",
        link: "https://example.com/agent-economy/budgets",
      },
    ],
  },
  {
    name: "Onchain Micropayments Digest",
    url: "https://example.com/micropayments",
    description:
      "Sub-cent payments, nanopayments, batching, and gas-efficient settlement primitives.",
    tags: ["micropayments", "nanopayments", "batching", "gas"],
    fetchPrice: 0.005,
    authors: [
      { name: "Mara Okoye", splitWeight: 0.6 },
      { name: "Devin Park", splitWeight: 0.4 },
    ],
    items: [
      {
        title: "Nanopayments and the $0.000001 floor",
        summary: "Batched settlement drops the economical floor to a millionth of a dollar.",
        content:
          "Nanopayments push the minimum economical payment to about $0.000001 by signing off-chain authorizations and settling them in batches. Instead of paying gas per transaction, many micro-authorizations settle together. This makes paying a creator a fraction of a cent per citation actually viable.",
        link: "https://example.com/micropayments/nano-floor",
      },
      {
        title: "Per-citation payments weighted by contribution",
        summary: "Reward sources in proportion to how much they grounded an answer.",
        content:
          "A fair model pays each cited source in proportion to its contribution to the final answer. Heavily-relied-upon sources earn more; lightly-used ones earn less. Weighted nanopayments make this granular settlement practical, and multi-author works can split a single reward across contributors automatically.",
        link: "https://example.com/micropayments/weighted",
      },
    ],
  },
  {
    name: "Distributed Systems Notes",
    url: "https://example.com/distsys",
    description:
      "Consensus, replication, and database internals for builders of reliable systems.",
    tags: ["consensus", "databases", "replication"],
    fetchPrice: 0.003,
    items: [
      {
        title: "Idempotency keys prevent double-spends",
        summary: "Use a unique key per operation to make retries safe.",
        content:
          "An idempotency key ensures a retried request is processed at most once. In a payment system, keying on (payer, resource, nonce) prevents charging twice when a client retries after a timeout. This is essential when an autonomous agent issues many rapid payments.",
        link: "https://example.com/distsys/idempotency",
      },
    ],
  },
  {
    name: "Garden & Soil Monthly",
    url: "https://example.com/garden",
    description: "Practical organic gardening: composting, raised beds, and seasonal planting.",
    tags: ["gardening", "compost", "plants"],
    fetchPrice: 0.002,
    items: [
      {
        title: "Building a no-dig raised bed",
        summary: "Layer cardboard, compost, and mulch for a low-effort bed.",
        content:
          "A no-dig raised bed starts with cardboard to smother weeds, topped with compost and mulch. Over a season the layers break down into rich soil without tilling, preserving soil structure and the fungal networks plants rely on.",
        link: "https://example.com/garden/no-dig",
      },
    ],
  },
  {
    name: "Retro Game Hardware",
    url: "https://example.com/retro",
    description: "Restoring and modding vintage consoles and arcade boards.",
    tags: ["retro", "gaming", "hardware"],
    fetchPrice: 0.002,
    items: [
      {
        title: "Recapping a 1990s console",
        summary: "Replace aged electrolytic capacitors to fix video and audio faults.",
        content:
          "Aged electrolytic capacitors leak and cause dim video or distorted audio on vintage consoles. Recapping — desoldering the old caps and fitting fresh ones of the correct value and voltage — restores the original signal quality and prevents board corrosion.",
        link: "https://example.com/retro/recap",
      },
    ],
  },
];
