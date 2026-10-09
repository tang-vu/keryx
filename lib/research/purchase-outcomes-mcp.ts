import { z } from "zod";
import { purchaseOutcomeId, validatePurchaseOutcomes } from "./purchase-outcomes-contract";

const input = z.object({ dispatchId: purchaseOutcomeId }).strict();
interface Registrar {
  registerTool(name: string, options: { title: string; description: string; inputSchema: typeof input;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } },
    handler: (value: unknown) => Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }>): unknown;
}
/** Identical public-read role in hosted and packaged stdio. No account scope or paid fallback. */
export function registerPurchaseOutcomes(server: Registrar, read: (id: string) => Promise<unknown | null>) {
  server.registerTool("keryx_purchase_outcomes", { title: "Recorded dispatch purchase outcomes",
    description: "Read a public dispatch's retained exact-version BUY/citation/payment observations. Returns bounded sample counts, citation hit rate, calibration bands and integer micro-USDC uncited access cost. Recorded settlement is not revalidated on chain. Historical participant cohort is unknown; causal regret, missed value and cost per supported claim are unmeasured. No research, paid read, current-source backfill, private reviews, signing or learning. Use an existing dispatch ID, never a URL.",
    inputSchema: input, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async value => {
    try {
      const { dispatchId } = input.parse(value), result = await read(dispatchId);
      if (result === null) throw new Error();
      const report = validatePurchaseOutcomes(result, dispatchId);
      return { content: [{ type: "text", text: JSON.stringify(report) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Recorded purchase outcomes unavailable. No research, payment or private inspection was executed." }] };
    }
  });
}
