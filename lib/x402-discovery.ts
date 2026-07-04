/**
 * Bazaar discovery metadata for Keryx's paid endpoints (x402 discovery extension).
 *
 * Shape mirrors the entries Circle's x402 service registry returns from
 * `/v2/x402/discovery/resources` (the index behind `circle services search`): provider info +
 * input/output JSON schemas. Declared in the 402 challenge (`extensions.bazaar.info`) and carried
 * through facilitator verify/settle so the facilitator can catalog the service. Purely additive
 * metadata — it never gates payment.
 */

import { config } from "./config";

/** Discovery declaration for POST /api/agent/ask — the outward-facing paid research endpoint. */
export const a2aDiscovery = {
  provider: {
    name: "Keryx",
    website: config.baseUrl,
    docsUrl: `${config.baseUrl}/dev`,
    openApiUrl: `${config.baseUrl}/api/openapi.json`,
    description:
      "Citation-toll research agent — pays the sources it cites. Ask a question, get a grounded answer with citations; every cited creator receives a weighted USDC payout on Arc.",
    category: "WEB_SEARCH_RESEARCH",
    tags: [
      "x402",
      "paid-api",
      "research",
      "citations",
      "agent-to-agent",
      "arc",
      "usdc",
      "circle-gateway",
    ],
  },
  path: "/api/agent/ask",
  method: "POST",
  description:
    "Autonomous research: Keryx buys and reads paid sources, answers with citations, and pays every cited creator downstream.",
  mimeType: "application/json",
  input: {
    type: "http",
    method: "POST",
    bodyType: "json",
    body: {
      type: "object",
      required: ["question"],
      properties: {
        question: {
          type: "string",
          description: "The research question to answer",
        },
        budget: {
          type: "number",
          minimum: 0,
          description:
            "Max USDC the agent may spend buying sources (optional; clamped to the server ceiling)",
        },
      },
    },
  },
  output: {
    type: "object",
    required: ["queryId", "answer", "citations"],
    properties: {
      queryId: { type: "string", description: "Dispatch id — reasoning trace at /dispatch/{queryId}" },
      answer: { type: "string", description: "Grounded answer with inline citation markers" },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: { type: "string", description: "Cited source name" },
            weight: { type: "number", description: "Citation weight (share of the reward pool)" },
            reward: { type: "number", description: "USDC paid to this source's creator(s)" },
          },
        },
        description: "Sources the answer actually cites — each one was paid",
      },
      creatorsPaid: { type: "integer", description: "Number of cited sources paid downstream" },
      totalToCreators: { type: "number", description: "Total USDC settled to creators for this answer" },
      feePaid: { type: "number", description: "The x402 fee this call paid Keryx" },
      engine: { type: "string", description: "Reasoning engine used (anthropic | deepseek | heuristic)" },
    },
  },
  siwx: false,
  supportsVanillax402: false,
  supportsCircleGateway: true,
} as const;
