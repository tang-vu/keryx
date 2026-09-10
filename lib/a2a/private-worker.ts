import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema } from "./private-research-intent";
import { privateReasoningEngine, type PrivateReasoningConfig } from "../llm/private-engine";
import { runPrivateResearch } from "./run-private-research";

type ExecutionOptions = Parameters<typeof runPrivateResearch>[3];
const pageSchema = z.array(z.object({ id: privateResearchIdSchema, payer: addressSchema }).strict()).max(25);

/** Backend polling primitive, not a daemon or readiness signal. One tick visits at
 * most one page, serially. Cursor is private in-memory scheduling state. No job IDs,
 * answers, signatures, provider errors or credentials appear in its summaries. */
export function createPrivateWorker(db: KeryxDB, options: Omit<ExecutionOptions, "engineForModel" | "privateProvider"> & {
  privateProvider: PrivateReasoningConfig;
}) {
  const signerAddress = addressSchema.parse(options.signerAddress).toLowerCase();
  const privateProvider = { ...options.privateProvider };
  privateReasoningEngine(privateProvider); // Validate explicit provider configuration before scanning.
  const execution = { signerAddress, privateProvider,
    resultSpool: options.resultSpool,
    signer: { createPaymentPayload: options.signer.createPaymentPayload.bind(options.signer) },
    getGatewayBalance: options.getGatewayBalance };
  let cursor: string | undefined;
  let busy = false;
  return {
    async tick(signal?: AbortSignal) {
      if (busy) return { status: "busy" as const };
      if (signal?.aborted) return { status: "paused" as const };
      busy = true;
      const counts = { visited: 0, completed: 0, stored: 0, alreadyClaimed: 0, unpersisted: 0, errors: 0 };
      try {
        let page;
        try {
          page = pageSchema.parse(await db.listPrivateWorkerCandidates(signerAddress, cursor));
          let previous = cursor;
          for (const row of page) {
            if (previous !== undefined && row.id <= previous) throw new Error();
            previous = row.id;
          }
        } catch { return { status: "scan-unavailable" as const, ...counts }; }
        for (const row of page) {
          // Stop between jobs, never race an ongoing paid execution against a timeout.
          if (signal?.aborted) return { status: "paused" as const, ...counts };
          counts.visited++;
          try {
            const result = await runPrivateResearch(db, row.id, row.payer, execution);
            if (result.status === "completed") {
              if (await db.getPrivateResearchResult(row.id, row.payer)) counts.completed++;
              else counts.unpersisted++;
            } else if (result.status === "stored") counts.stored++;
            else counts.alreadyClaimed++;
          } catch { counts.errors++; }
          cursor = row.id; // A bad job must not starve later candidates in the same sweep.
        }
        if (page.length < 25) cursor = undefined;
        return { status: "processed" as const, ...counts };
      } finally { busy = false; }
    },
  };
}
