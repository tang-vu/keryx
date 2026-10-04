/** Isolated execution of internally authored tasks, using supplied discovery candidates.
 * This measures reading/orchestration and delivery, not web-search recall or customer demand. */
import { createHash } from "node:crypto";
import { collectRun } from "../agent";
import type { ResearchEffects } from "../agent/research-effects";
import { SqliteAdapter } from "../db/sqlite-adapter";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { PaymentGateway } from "../payments/payment-gateway";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { researchExports } from "../research/surface-result";
import { ArticleReadError, type ArticleRead, type ArticleFailureCode } from "../web-research/article-reader";
import type { InternalResearchInput } from "./internal-research-input-types";

export interface WorkloadRead {
  url: string;
  title: string;
  observedAt: string;
  provenance: InternalResearchInput["inputKind"];
  observedScope?: string;
  article?: ArticleRead;
  failure?: ArticleFailureCode;
  snapshotSha256?: string;
}

export function workloadSourceUrl(input: InternalResearchInput, index: number): string {
  return input.sources[index]!.url ?? `https://${input.id.toLowerCase()}-source-${index + 1}.workload.invalid/document`;
}

export function workloadSnapshotHash(article: ArticleRead): string {
  return createHash("sha256").update(JSON.stringify(article)).digest("hex");
}

export async function executeResearchWorkload(input: InternalResearchInput, reads: WorkloadRead[], engine: ReasoningEngine) {
  const expectedUrls = input.sources.map((_, index) => workloadSourceUrl(input, index));
  if (!Array.isArray(reads) || reads.length !== expectedUrls.length || new Set(reads.map(row => row.url)).size !== reads.length ||
    reads.some(row => !expectedUrls.includes(row.url) || !Number.isFinite(Date.parse(row.observedAt)) ||
      (!!row.article === !!row.failure) || (row.article && row.snapshotSha256 !== workloadSnapshotHash(row.article))))
    throw new Error("Workload snapshot integrity mismatch");
  const db = new SqliteAdapter(":memory:");
  const startedAt = Date.now();
  const readAttempts: string[] = [];
  let paymentAttempts = 0;
  const denyPayment = async (): Promise<never> => { paymentAttempts++; throw new Error("Workload forbids payments"); };
  const gateway: PaymentGateway = {
    mode: "offline", ensureFunded: async () => ({ address: "0xOFFLINE_AGENT" }),
    agentAddress: () => "0xOFFLINE_AGENT", payFetch: denyPayment, payCitation: denyPayment,
  };
  try {
    await db.init();
    const effects: ResearchEffects = {
      scope: { kind: "public" },
      recordPayment: denyPayment,
      getCached: key => db.getCached(key), getCachedAt: key => db.getCachedAt(key),
      setCached: (key, content) => db.setCached(key, content), saveQueryRun: run => db.saveQueryRun(run),
      discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
      saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {},
    };
    // The frozen input is the complete discovery allowance. No snippets substitute for reads.
    const hits = input.sources.map((source, index) => ({ url: workloadSourceUrl(input, index), title: source.title, snippet: source.title }));
    const run = await collectRun({ question: input.question, queryId: `workload-${input.id}-${startedAt}`,
      budget: 0.01, researchMode: "deep", origin: "engine", fundingOwner: "offline", allowExternalWeb: true,
      executionLimits: { attentionLimit: 8, reevaluateRounds: 1 } }, { deps: {
      engine, db, gateway, effects, discoverExternal: async () => [],
      discoverScholarly: async () => ({ candidates: new Map(), succeeded: 0, unavailable: 0, requestedDois: 0, resolvedDois: 0 }),
      webSearch: { search: async () => hits },
      readWebArticle: async url => {
        readAttempts.push(url);
        const read = reads.find(row => row.url === url);
        if (!read?.article) throw new ArticleReadError(read?.failure ?? "transport-unavailable");
        if (read.snapshotSha256 !== workloadSnapshotHash(read.article)) throw new Error("Workload snapshot integrity mismatch");
        return structuredClone(read.article);
      },
    } });
    // The production reader stamps its invocation time. Eval replay is not a new network
    // observation: bind all exported evidence/citations back to the capture's timestamp.
    for (const item of [...run.citations, ...(run.evidence ?? [])]) {
      const captured = reads.find(row => row.article?.finalUrl === item.itemUrl);
      if (captured && item.webProvenance) item.webProvenance.retrievedAt = captured.observedAt;
    }
    const payments = await db.listPayments(1000);
    const receipt = buildResearchReceipt(run, payments);
    const exports = researchExports(run);
    const hardFailures = [
      ...(paymentAttempts || payments.length ? ["No-payment boundary violated"] : []),
      ...(!verifyResearchReceipt(receipt).valid ? ["Receipt integrity failed"] : []),
      ...(run.totalSpent !== 0 || run.totalToCreators !== 0 ? ["Nonzero public-source spend"] : []),
    ];
    const context = `> Internal evaluation. Reasoning: ${engine.name}. Payment: offline, no source payments. Discovery: supplied candidates, not live search. Sources: retained snapshots; capture timestamps are preserved. This is not a customer task or proof of complete synthesis.\n\n`;
    return { run, receipt, markdown: context + researchReportMarkdown(run, null, payments), exports,
      observation: { id: input.id, inputKind: input.inputKind, engine: engine.name, startedAt: new Date(startedAt).toISOString(),
        elapsedMs: Date.now() - startedAt, pipelineCompleted: true, paymentAttempts, paymentRows: payments.length,
        readAttempts, availableInputs: reads.filter(row => row.article).length, unavailableInputs: reads.filter(row => !row.article).length,
        truncatedInputs: reads.filter(row => row.article?.truncated).length, researchTargets: run.subClaims.length,
        citedSources: run.citations.length, evidenceSpans: run.evidence?.length ?? 0,
        confidence: run.confidence, hardFailures,
        usefulness: "requires-human-review" as const, expectedArtifact: input.expectedArtifact, review: input.review,
        limitations: ["Internally authored task, not customer demand", "Supplied candidates; discovery recall untested",
          "Read snapshots replayed through production orchestration", "Qualified excerpts are not proof of a useful decision or complete synthesis"],
      } };
  } finally { db.close(); }
}
