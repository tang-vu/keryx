import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import { surfaceResearch } from "../research/surface-result";
import { formatRecordedUsdc } from "../display/recorded-usdc";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { collectRun } from "../agent";
import { config } from "../config";
import { resolveModelChoice } from "../llm";
import type { McpClientChannel, QueryRun } from "../types";
import { registerMonthlyDiscovery } from "../monthly/mcp-discovery";
import { quoteResearchMonthly } from "../monthly/quote";
import { reasoningServingText } from "../llm/reasoning-telemetry";
import { researchFailureMessage } from "../llm/research-plan";
import { ResearchSelectionError } from "../llm/research-selection";
import { registerOperatorDiscovery } from "../business-operator/mcp";
import { readOperatorStatus } from "../business-operator/status";
import { getDb } from "../db";
import { assertOrdinaryResearchAvailable, readResearchAvailability } from "../research/availability";
import { researchAdmissionError } from "../research/availability-contract";
import { createPaperLookupHandler, paperLookupToolOptions } from "../papers/lookup";
import { readHostedPaperLookup } from "../papers/hosted-lookup";
import { registerProfileTools } from "../profiles/profile-mcp";
import { registerHistoryTool } from "../history/personal-history-mcp";
import { requirePersonalHistory } from "../history/personal-history";
import { readPersonalHistory } from "../history/personal-history-reader";
import { requirePrivateProfiles } from "../profiles/private-profile";
import type { ApiKeyScope } from "../api-key-scopes";
import { registerEvidenceDraftTool } from "../research/evidence-draft-tool";

export interface RemoteMcpAccess {
  budgetCap: number;
  /** Wallet from a verified Keryx API key. Anonymous MCP clients leave this absent. */
  actor?: string;
  /** Explicit verified-key scopes only; actor alone never authorizes profile access. */
  profileScopes?: ApiKeyScope[];
  historyScopes?: ApiKeyScope[];
  /** Self-declared setup URL channel. Telemetry only; never identity or payment authority. */
  clientChannel: McpClientChannel;
  /** Request-bound metadata admission identity and cancellation; never payment authority. */
  paperCaller?: string;
  signal?: AbortSignal;
}

type ResearchRunner = typeof collectRun;

export function remoteResearchResult(run: QueryRun) {
  run = demoteSyntheticEvidence(run);
  return {
    queryId: run.id,
    answer: run.answer,
    ...surfaceResearch(run),
    totalToCreatorsUsdc: run.totalToCreators,
    confidence: run.confidence,
    engine: run.engine,
    paymentAttempts: run.paymentAttempts ?? 0,
    settledPayments: run.settledPayments ?? 0,
    dispatchUrl: `${config.baseUrl}/dispatch/${run.id}`,
  };
}

function researchText(result: ReturnType<typeof remoteResearchResult>): string {
  const rewards =
    result.citations.length > 0
      ? result.citations
          .map((citation) => `- ${citation.source}: ${formatRecordedUsdc(citation.rewardPlannedUsdc, { minimumFractionDigits: 4 })} USDC`)
          .join("\n")
      : "- No source reward was allocated.";
  const settlement =
    result.paymentMode === "real"
      ? `${result.settledPayments}/${result.paymentAttempts} payment attempts settled`
      : result.paymentMode === "offline" ? "offline payment simulation" : "payment mode unknown; no simulation or settlement inferred";
  const selection = result.reasoning.sourceSelection;
  const engines = selection.servingEngines.slice(0, 4).join(", ") || "none recorded";
  const engineRemainder = selection.servingEngines.length > 4 ? ` + ${selection.servingEngines.length - 4} more` : "";
  const selectionText = `Recorded source selection: ${selection.state} · ${engines}${engineRemainder} · ` +
    (selection.fallbackUsed === true ? "fallback served" : selection.fallbackUsed === false ? "requested tier served" : "fallback use unknown") +
    ` (${result.reasoning.telemetry} attempt telemetry)`;
  const groundedClaims = result.claimCoverage.filter(
    (claim) => claim.coverage >= 0.4,
  ).length;

  return (
    `${result.answer}\n\n` +
    `${reasoningServingText(result)}\n\n` +
    `Citations and planned creator rewards\n${rewards}\n\n` +
    `Evidence: ${groundedClaims}/${result.claimCoverage.length} research targets meet the recorded excerpt-support threshold; this does not verify entailment or complete synthesis\n` +
    `${selectionText}\n` +
    `Total recorded to creators: ${formatRecordedUsdc(result.totalToCreatorsUsdc, { minimumFractionDigits: 4 })} USDC · ${settlement}\n` +
    (result.operatingFee ? `Keryx operating fee allocation: ${formatRecordedUsdc(result.operatingFee.amountUsdc, { minimumFractionDigits: 6 })} USDC · ${result.operatingFee.status}. Separate from creator rewards; inspect the payment ledger for settlement evidence.\n` : "") +
    `Confidence: ${result.confidence?.level ?? "Low"} · ${result.dispatchUrl}`
  );
}

/** Build one stateless MCP server per HTTP request. The request's verified access stays in closure. */
export function createRemoteMcpServer(
  access: RemoteMcpAccess,
  runResearch: ResearchRunner = collectRun,
): McpServer {
  const server = new McpServer({
    name: "keryx",
    version: "0.3.8",
    description:
      "Budgeted research over creator sources with citation rewards on the configured Arc network. Anonymous research is sponsored by Keryx's treasury.",
  });
  registerEvidenceDraftTool(server);
  const profileStore = async (scope: "profile:read" | "profile:write") => {
    if (!access.actor || !access.profileScopes?.includes(scope)) throw new Error("Explicit profile scope required");
    return requirePrivateProfiles(await getDb());
  };

  server.registerTool("paper_lookup", paperLookupToolOptions,
    createPaperLookupHandler(input => readHostedPaperLookup(input, access.paperCaller ?? "unknown", access.signal)));

  server.registerTool(
    "research",
    {
      title: "Research with Keryx",
      description:
        "Research a question under a USDC creator-payment budget. Keryx selects sources, pays " +
        "access tolls and weighted citation rewards on the configured Arc network, then returns qualified source excerpts and a receipt. Complete synthesis and per-assertion entailment remain unverified. This remote surface uses Keryx's treasury; anonymous research is sponsored, not caller-funded usage. Public research may send your question to our search provider. The source USDC budget is separate from model and search operating costs. " +
        "For retained or repository bibliography use free paper_lookup with an exact identifier. An ordinary explicit exact-original bibliography request can also return a separate metadata-only record and references without a model call or creator payment; page status and full-paper evidence remain separate. " +
        "New runs record remote MCP ingress. A verified ask-scoped API key attributes the run to its wallet; anonymous runs have no wallet owner. Editable client names establish no identity or spending authority.",
      inputSchema: {
        question: z.string().trim().min(3).max(4_000).describe("Research question."),
        budget: z
          .number()
          .nonnegative()
          .optional()
          .describe("Maximum creator-payment budget in USDC; 0 allows free sources without purchases or rewards. Clamped to the caller's tier."),
        scholarly: z.boolean().optional().describe("Opt in to bounded Crossref/arXiv paper discovery; sends the question to those providers."),
        mode: z.enum(["quick", "deep"]).optional().describe("Research depth; default deep."),
        model: z
          .string()
          .optional()
          .describe("Optional Keryx model catalog id, for example deepseek-chat."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ question, budget, model, scholarly, mode }) => {
      try {
        assertOrdinaryResearchAvailable();
        const requested =
          typeof budget === "number" && Number.isFinite(budget) && budget >= 0
            ? budget
            : config.defaultBudget;
        const modelChoice = resolveModelChoice(model);
        const run = await runResearch({
          question,
          budget: Math.min(requested, access.budgetCap),
          queryId: crypto.randomUUID(),
          origin: "mcp",
          scholarly: scholarly === true, researchMode: mode ?? "deep",
          mcpClient: access.clientChannel,
          ...(access.actor ? { asker: access.actor } : {}),
          provenance: { version: 1, surface: "remote-mcp", ownershipMethod: access.actor ? "api-key" : "unknown" },
          ...(modelChoice ? { model: modelChoice.id } : {}),
        });
        const result = remoteResearchResult(run);
        return {
          content: [{ type: "text" as const, text: researchText(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = researchFailureMessage(error);
        const held = researchAdmissionError(error);
        return {
          isError: true,
          ...(held ? { structuredContent: { error: held.code, message: held.message,
            availability: readResearchAvailability() } } : {}),
          content: [{ type: "text" as const, text: `Keryx research failed: ${message}` },
            ...(error instanceof ResearchSelectionError ? [{ type: "text" as const,
              text: `Source-selection diagnostic (not a completed report or payment receipt):\n${JSON.stringify(error.diagnostic)}` }] : [])],
        };
      }
    },
  );

  server.registerTool(
    "keryx_status",
    {
      title: "Keryx remote MCP status",
      description: "Describe this MCP surface, its payment behavior, and the active caller tier.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const availability = readResearchAvailability();
      return {
        structuredContent: { endpoint: "connected", researchAvailability: availability },
        content: [{ type: "text" as const, text:
          `Keryx Remote MCP is connected. ${availability.message} Research calls are treasury-funded and creators receive ` +
          `real Arc USDC when settlement is configured. Budget cap: $${access.budgetCap} USDC. ` +
          `Caller: ${access.actor ? "verified API-key wallet" : "anonymous free trial"}.` }],
      };
    },
  );

  registerMonthlyDiscovery(server, async () => process.env.KERYX_MONTHLY_ENABLED === "1" ? quoteResearchMonthly() : null);
  registerOperatorDiscovery(server, async () => readOperatorStatus(await getDb(), config.networkId));
  registerProfileTools(server, {
    read: async () => (await profileStore("profile:read")).get(access.actor!, config.networkId),
    update: async input => ({ profile: await (await profileStore("profile:write")).update(access.actor!, input) }),
  });
  registerHistoryTool(server, async input => {
    if (!access.actor || !access.historyScopes?.includes("history:read")) throw new Error("Explicit history scope required");
    return readPersonalHistory(requirePersonalHistory(await getDb()), access.actor, config.networkId, input);
  });
  return server;
}
