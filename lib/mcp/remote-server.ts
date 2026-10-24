import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import { surfaceResearch } from "../research/surface-result";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hostedRequesterObservations } from "../research-feedback/hosted-delivery";
import { registerRequesterFeedbackTools, privateRequesterObservationText } from "../research-feedback/mcp";
import { createRequesterFeedbackRoute } from "../research-feedback/http";
import { feedbackResponseSchema } from "../research-feedback/contracts";
import { configuredRequesterOpinionStore } from "../research-feedback/metadata-store";
import { z } from "zod";
import { collectRun } from "../agent";
import { config } from "../config";
import { resolveModelChoice } from "../llm";
import type { McpClientChannel, QueryRun } from "../types";
import { registerMonthlyDiscovery } from "../monthly/mcp-discovery";
import { quoteResearchMonthly } from "../monthly/quote";
import { livePresentationLocale, presentationLanguages } from "../research/presentation-language";
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import { researchPresentationMessages } from "../research/presentation-messages";
import { remoteResearchText } from "../research/result-presentation";
import { botResearchCatalogues } from "../bots/research-messages";
import { researchFailureMessage } from "../llm/research-plan";
import { ResearchSelectionError } from "../llm/research-selection";
import { registerOperatorDiscovery } from "../business-operator/mcp";
import { readOperatorStatus } from "../business-operator/status";
import { registerPublicJobLedger } from "../operator-ledger/mcp";
import { registerPurchaseOutcomes } from "../research/purchase-outcomes-mcp";
import { registerSourceLearning } from "../research/source-learning-mcp";
import { readSourceLearning } from "../research/source-learning-server";
import { readPublicPurchaseOutcomes } from "../research/purchase-outcomes-server";
import { readSelectedOperatorLedger } from "../operator-ledger/server";
import { getDb } from "../db";
import { assertOrdinaryResearchAvailable, readResearchAvailability } from "../research/availability";
import { researchAdmissionError } from "../research/availability-contract";
import { createPaperLookupHandler, paperLookupToolOptions } from "../papers/lookup";
import { readHostedPaperLookup } from "../papers/hosted-lookup";
import { registerProfileTools } from "../profiles/profile-mcp";
import { registerObligationInspection } from "../operator-obligations/mcp";
import { readDelegatedOperatorObligations } from "../operator-obligations/delegated";
import { registerHistoryTool } from "../history/personal-history-mcp";
import { registerOwnedHistoryTools } from "../history/owned-history-mcp";
import { createPrivateJobHistoryRead, registerPrivateJobHistoryTools } from "../history/private-job-history-mcp";
import { readPrivateJobHistory, readPrivateJobHistoryDetail, exportPrivateJobHistory } from "../history/private-job-history";
import { guardPrivateJobHistoryPage, guardPrivateJobHistoryDetail, guardPrivateJobHistoryExport } from "../history/private-job-history-client";
import { readOwnedHistory } from "../history/owned-history-reader";
import { exportOwnedHistory } from "../history/owned-history-export";
import { requirePersonalHistory } from "../history/personal-history";
import { readPersonalHistory } from "../history/personal-history-reader";
import { registerIdentityReadTool } from "../profiles/identity-mcp";
import { identitySnapshotSchema, requireProfileIdentities } from "../profiles/verified-identities";
import { profileWallet, requirePrivateProfiles } from "../profiles/private-profile";
import type { ApiKeyScope } from "../api-key-scopes";
import { registerEvidenceDraftTool } from "../research/evidence-draft-tool";
import { registerDraftCheckTool } from "../research/draft-check-tool";
import { registerEvidenceProcurementTool } from "../evidence-procurement/tool";
import { registerAcceptanceTools } from "../deliverable-acceptance/mcp";
import { requireDeliverableAcceptance } from "../deliverable-acceptance/contracts";
import { prepareHostedRunClaim } from "../run-claims/hosted-delivery";
import { privateRunClaimText } from "../run-claims/delivery";
import { registerRunPrivacyRead } from "../run-privacy/mcp";
import { privacyBinding } from "../run-privacy/auth";
import { privacyWallet, requirePrivacy } from "../run-privacy/contracts";
import {publicFinancialPayment} from "../run-privacy/public";

export interface RemoteMcpAccess {
  /** Verified key row identifier and explicit deliverable rights; not model input. */
  keyId?: string;
  deliverableScopes?: ApiKeyScope[];
  budgetCap: number;
  /** Wallet from a verified Keryx API key. Anonymous MCP clients leave this absent. */
  actor?: string;
  /** Explicit verified-key scopes only; actor alone never authorizes profile access. */
  profileScopes?: ApiKeyScope[];
  historyScopes?: ApiKeyScope[];
  /** HTTP request-local current key/wallet/scope fence; credentials stay in its closure. */
  revalidateHistoryAccess?: () => Promise<void>;
  /** Explicit verified-key delegation scope, narrowed again by protected reader config. */
  operatorScopes?: ApiKeyScope[];
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

/** Build one stateless MCP server per HTTP request. The request's verified access stays in closure. */
export function createRemoteMcpServer(
  access: RemoteMcpAccess,
  runResearch: ResearchRunner = collectRun,
): McpServer {
  const server = new McpServer({
    name: "keryx",
    version: "0.3.18",
    description:
      "Budgeted research over creator sources with citation rewards on the configured Arc network. Anonymous research is sponsored by Keryx's treasury.",
  });
  registerEvidenceDraftTool(server);
  registerRequesterFeedbackTools(server, { baseUrl: config.baseUrl, execute: async (token, input, signal) => {
    const binding = { network: config.networkId, origin: config.baseUrl };
    const response = await createRequesterFeedbackRoute({ db: getDb, store: () => configuredRequesterOpinionStore(binding), binding,
      secret: () => config.jwtSecret })(new Request(`${config.baseUrl}/api/research-feedback`, { method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input ? { operation: "submit", ...input } : { operation: "read" }) }));
    if (!response.ok) throw new Error("Requester feedback unavailable");
    return feedbackResponseSchema.parse(await response.json());
  } });
  registerDraftCheckTool(server);
  registerEvidenceProcurementTool(server);
  const acceptanceStore = async (scope: "deliverable:read" | "deliverable:write") => {
    if (!access.actor || !access.keyId || !access.deliverableScopes?.includes(scope)) throw new Error("Explicit deliverable scope required");
    return requireDeliverableAcceptance(await getDb());
  };
  registerAcceptanceTools(server, {
    read: async id => (await acceptanceStore("deliverable:read")).read(access.actor!, config.networkId, id),
    submit: async (id, input) => (await acceptanceStore("deliverable:write")).submit(access.actor!, config.networkId, id, input, { kind: "api-key", id: access.keyId! }),
  });
  const profileStore = async (scope: "profile:read" | "profile:write") => {
    if (!access.actor || !access.profileScopes?.includes(scope)) throw new Error("Explicit profile scope required");
    return requirePrivateProfiles(await getDb());
  };
  registerObligationInspection(server, () => readDelegatedOperatorObligations(access.actor, access.operatorScopes));

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
        reviewFirst: z.literal(false).optional().describe("Review-first requires the authenticated live browser; this adapter refuses true."),
        researchMode: z.never().optional(), responseMode: z.never().optional(),
        question: z.string().trim().min(3).max(4_000).describe("Research question."),
        language: z.enum(presentationLanguages).optional().describe("Language of generated labels only; the original question and answer are unchanged. Omitted labels follow qualified recorded answer language when available; historical and unqualified answer language remains unknown."),
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
    async ({ question, budget, model, scholarly, mode, language }) => {
      const locale = livePresentationLocale({ requestedLanguage: language, originalQuestion: question });
      const copy = researchPresentationMessages(locale.language);
      try {
        assertOrdinaryResearchAvailable();
        const requested =
          typeof budget === "number" && Number.isFinite(budget) && budget >= 0
            ? budget
            : config.defaultBudget;
        const modelChoice = resolveModelChoice(model);
        const queryId = crypto.randomUUID();
        const privateClaim = await prepareHostedRunClaim(queryId, access.actor);
        const run = await runResearch({
          question,
          budget: Math.min(requested, access.budgetCap),
          queryId,
          origin: "mcp",
          scholarly: scholarly === true, researchMode: mode ?? "deep",
          mcpClient: access.clientChannel,
          ...(access.actor ? { asker: access.actor } : {}),
          provenance: { version: 1, surface: "remote-mcp", ownershipMethod: access.actor ? "api-key" : "unknown" },
          ...(modelChoice ? { model: modelChoice.id } : {}),
        });
        const result = remoteResearchResult(run);
        const packet = await privateClaim?.complete(run);
        const requester = await hostedRequesterObservations(run, true);
        return {
          // Direct caller's private tool response only. The structured public
          // projection remains unchanged and never acquires claim credentials.
          content: [{ type: "text" as const, text: remoteResearchText(result, livePresentationLocale({
            requestedLanguage: language, originalQuestion: question, recordedAnswerLanguage: recordedAnswerLanguage(run) })) },
            ...(packet ? [{ type: "text" as const, text: privateRunClaimText(packet) }] : []),
            ...(requester ? [{ type: "text" as const, text: privateRequesterObservationText(requester) }] : [])],
          ...(packet || requester ? { _meta: { ...(packet ? { "keryx/privateRunClaim": packet } : {}),
            ...(requester ? { "keryx/privateRequesterObservations": requester } : {}) } } : {}),
          structuredContent: result,
        };
      } catch (error) {
        const held = researchAdmissionError(error);
        const message = held ? botResearchCatalogues[locale.language].paused : researchFailureMessage(error);
        return {
          isError: true,
          ...(held ? { structuredContent: { error: held.code, message: held.message,
            availability: readResearchAvailability() } } : {}),
          content: [{ type: "text" as const, text: copy("remoteFailure", { detail: message }) },
            ...(error instanceof ResearchSelectionError ? [{ type: "text" as const,
              text: `${copy("selectionDiagnostic")}\n${JSON.stringify(error.diagnostic)}` }] : [])],
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
  registerPublicJobLedger(server, readSelectedOperatorLedger);
  registerPurchaseOutcomes(server, readPublicPurchaseOutcomes);
  registerSourceLearning(server, async id => readSourceLearning(await getDb(), id, config.networkId));
  registerProfileTools(server, {
    read: async () => (await profileStore("profile:read")).get(access.actor!, config.networkId),
    update: async input => ({ profile: await (await profileStore("profile:write")).update(access.actor!, input) }),
  });
  registerHistoryTool(server, async input => {
    if (!access.actor || !access.historyScopes?.includes("history:read")) throw new Error("Explicit history scope required");
    return readPersonalHistory(requirePersonalHistory(await getDb()), access.actor, config.networkId, input);
  });
  const ownedHistoryRead = async <T>(read: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>) => {
    if (!access.actor || !access.historyScopes?.includes("history:read") || !access.revalidateHistoryAccess) throw new Error("Explicit current history scope required");
    const value = await read(await getDb());
    await access.revalidateHistoryAccess();
    return value;
  };
  registerOwnedHistoryTools(server, input => ownedHistoryRead(db => readOwnedHistory(db, access.actor!, privacyBinding(), input, access.signal)),
    input => ownedHistoryRead(db => exportOwnedHistory(db, access.actor!, privacyBinding(), input, access.signal)));
  const privateHistoryRead = createPrivateJobHistoryRead(access, getDb);
  registerPrivateJobHistoryTools(server, {
    current: privateHistoryRead.current,
    list: (input, call) => privateHistoryRead.read(async (db, owner, options) =>
      guardPrivateJobHistoryPage(await readPrivateJobHistory(db, owner, input, options), input, owner), false, call?.signal),
    detail: ({ id }, call) => privateHistoryRead.read(async (db, owner, options) => {
      const value = await readPrivateJobHistoryDetail(db, owner, id, options);
      return value === null ? null : guardPrivateJobHistoryDetail(value, id, owner);
    }, false, call?.signal),
    export: (input, call) => privateHistoryRead.read(async (db, owner, options) =>
      guardPrivateJobHistoryExport(await exportPrivateJobHistory(db, owner, input, options), input, owner), true, call?.signal),
  });
  registerRunPrivacyRead(server,async(id,requestId)=>{
    if(!access.actor||!access.historyScopes?.includes("history:read"))throw new Error("Explicit history scope required");
    const db=await getDb(),actor={wallet:privacyWallet.parse(access.actor),binding:privacyBinding()},store=requirePrivacy(db);
    const result=requestId?await store.export(id,actor,requestId):await store.owner(id,actor);
    if(!result)throw new Error("Owner record unavailable");
    return {wallet:actor.wallet,...result,...(requestId?{version:1,payments:(await db.listCreatorPaymentAttemptsByQuery(id)).map(publicFinancialPayment)}:{})};
  });
  registerIdentityReadTool(server, async () => {
    if (!access.actor || !access.profileScopes?.includes("profile:read")) throw new Error("Explicit profile scope required");
    const owner = profileWallet(access.actor);
    const body = identitySnapshotSchema.parse(await requireProfileIdentities(await getDb()).list(owner));
    if (body.wallet !== owner) throw new Error("Invalid verified identity owner");
    return body;
  });
  return server;
}
