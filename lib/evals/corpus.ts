import crypto from "node:crypto";
import type { Source, SourceItem } from "../types";
import type { AgentEvalCase } from "./types";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

function fixture(
  id: string,
  input: {
    name: string;
    description: string;
    tags: string[];
    price?: number;
    title: string;
    summary: string;
    content: string;
  },
): { source: Source; items: SourceItem[] } {
  const itemId = `${id}-article`;
  return {
    source: {
      id,
      name: input.name,
      url: `https://eval.invalid/${id}`,
      description: input.description,
      walletAddress: `0x${id.charCodeAt(0).toString(16).padStart(2, "0").repeat(20)}`,
      fetchPrice: input.price ?? 0.004,
      tags: input.tags,
      authors: [],
      active: true,
      verified: true,
      createdAt: CREATED_AT,
    },
    items: [
      {
        id: itemId,
        sourceId: id,
        title: input.title,
        summary: input.summary,
        content: input.content,
        link: `https://eval.invalid/${id}/${itemId}`,
        publishedAt: CREATED_AT,
        deliveryKind: "full_text",
        storageMode: "db_plaintext",
      },
    ],
  };
}

const x402 = () =>
  fixture("x402", {
    name: "x402 Protocol Notes",
    description: "Technical documentation for HTTP 402 autonomous agent payments.",
    tags: ["x402", "agents", "payments", "http"],
    title: "How x402 payment retries work",
    summary: "A server returns HTTP 402 payment terms and an agent retries with an authorization.",
    content:
      "The x402 flow starts when a server returns HTTP 402 with machine-readable payment terms. The agent signs a bounded payment authorization and retries the request, allowing autonomous per-request commerce without an account.",
  });

const stableBudget = () =>
  fixture("stable-budget", {
    name: "Stable Agent Budgets",
    description: "Research on USDC-denominated budgets for autonomous software.",
    tags: ["usdc", "stablecoin", "budget", "agents"],
    title: "Why agents budget in USDC",
    summary: "Stablecoins keep an autonomous agent's spending limit predictable.",
    content:
      "USDC gives an autonomous agent a stable dollar unit of account. A fixed USDC budget lets the agent compare evidence value with price without volatility changing the spending limit between decisions.",
  });

const gardening = () =>
  fixture("gardening", {
    name: "Garden Field Notes",
    description: "Seasonal advice for soil, compost, and vegetable gardens.",
    tags: ["gardening", "soil", "compost"],
    price: 0.002,
    title: "Building healthy compost",
    summary: "Balance green and brown material for garden compost.",
    content:
      "Healthy compost combines nitrogen-rich green material with carbon-rich brown material. Turning the pile adds oxygen and helps garden soil retain moisture.",
  });

const misleading = () =>
  fixture("preview-bait", {
    name: "Agent Payment Headlines",
    description: "Headlines about x402 agent payments and budget automation.",
    tags: ["x402", "agent", "payments", "budget"],
    price: 0.002,
    title: "The complete x402 budget guide",
    summary: "Explains x402 authorization, stable budgets, settlement, and autonomous payment decisions.",
    content:
      "This article is a publication announcement. The promised technical report has not been released and no protocol or budgeting evidence is available yet.",
  });

export const AGENT_EVAL_CORPUS: AgentEvalCase[] = [
  {
    id: "relevance-with-distractor",
    description: "Buys relevant x402 evidence and rejects an unrelated cheap source.",
    question: "How does x402 let autonomous agents pay per request?",
    budget: 0.03,
    researchMode: "quick",
    sources: [x402(), gardening()],
    expected: {
      allowedCitationSourceIds: ["x402"],
      requiredCitationSourceIds: ["x402"],
      allowedReadSourceIds: ["x402"],
      requiredReadSourceIds: ["x402"],
      forbiddenReadSourceIds: ["gardening"],
      decisions: { x402: "BUY", gardening: "SKIP" },
      minGroundedClaimRate: 0.5,
    },
  },
  {
    id: "stable-budget",
    description: "Finds evidence for stablecoin-denominated agent budgets.",
    question: "Why does a USDC budget help an autonomous agent control spending?",
    budget: 0.03,
    researchMode: "quick",
    sources: [stableBudget(), gardening()],
    expected: {
      allowedCitationSourceIds: ["stable-budget"],
      requiredCitationSourceIds: ["stable-budget"],
      allowedReadSourceIds: ["stable-budget"],
      requiredReadSourceIds: ["stable-budget"],
      forbiddenReadSourceIds: ["gardening"],
      decisions: { "stable-budget": "BUY", gardening: "SKIP" },
      minGroundedClaimRate: 0.5,
    },
  },
  {
    id: "multi-claim-portfolio",
    description: "Builds a complementary evidence portfolio for two distinct claims.",
    question: "How does x402 payment authorization work and why does a stable USDC budget matter for agents?",
    budget: 0.04,
    researchMode: "deep",
    sources: [x402(), stableBudget(), gardening()],
    expected: {
      allowedCitationSourceIds: ["x402", "stable-budget"],
      requiredCitationSourceIds: ["x402", "stable-budget"],
      allowedReadSourceIds: ["x402", "stable-budget"],
      requiredReadSourceIds: ["x402", "stable-budget"],
      forbiddenReadSourceIds: ["gardening"],
      decisions: { x402: "BUY", "stable-budget": "BUY", gardening: "SKIP" },
      minGroundedClaimRate: 0.5,
    },
  },
  {
    id: "irrelevant-corpus",
    description: "Abstains when the frozen corpus cannot answer the question.",
    question: "What telescope measured the atmosphere of an exoplanet?",
    budget: 0.03,
    researchMode: "quick",
    sources: [x402(), stableBudget(), gardening()],
    expected: {
      allowedCitationSourceIds: [],
      allowedReadSourceIds: [],
      forbiddenReadSourceIds: ["x402", "stable-budget", "gardening"],
      decisions: { x402: "SKIP", "stable-budget": "SKIP", gardening: "SKIP" },
      minGroundedClaimRate: 0,
      maxTotalSpentUsdc: 0,
    },
  },
  {
    id: "preview-body-mismatch",
    description: "Does not reward a source whose attractive preview is unsupported by its paid body.",
    question: "How do x402 authorization and stable budgets support autonomous agent payments?",
    budget: 0.03,
    researchMode: "quick",
    sources: [misleading()],
    expected: {
      allowedCitationSourceIds: [],
      allowedReadSourceIds: ["preview-bait"],
      requiredReadSourceIds: ["preview-bait"],
      decisions: { "preview-bait": "BUY" },
      minGroundedClaimRate: 0,
    },
  },
  {
    id: "budget-denial",
    description: "A relevant source cannot cross the deterministic fetch budget ceiling.",
    question: "How does x402 let an autonomous agent pay?",
    budget: 0.004,
    researchMode: "quick",
    sources: [x402()],
    expected: {
      allowedCitationSourceIds: [],
      allowedReadSourceIds: [],
      forbiddenReadSourceIds: ["x402"],
      decisions: { x402: "SKIP" },
      minGroundedClaimRate: 0,
      maxTotalSpentUsdc: 0,
    },
  },
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function corpusFingerprint(cases: AgentEvalCase[] = AGENT_EVAL_CORPUS): string {
  return crypto.createHash("sha256").update(stableJson(cases)).digest("hex");
}
