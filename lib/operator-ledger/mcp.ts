import { z } from "zod";
import { verifyOperatorLedger } from "./export";

const input = z.object({ days: z.number().int().min(1).max(31).optional() }).strict();
interface LedgerRegistrar {
  registerTool(name: string, options: { title: string; description: string; inputSchema: typeof input;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } },
    handler: (value: unknown) => Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }>): unknown;
}
/** Same public-role registration in hosted and packaged stdio SDKs. No private scope fallback. */
export function registerPublicJobLedger(server: LedgerRegistrar, read: (days: number) => Promise<unknown>) {
  server.registerTool("keryx_public_job_ledger", { title: "Public job transfer ledger",
    description: "Inspect a partial selected-network public web-dispatch transfer ledger and balanced exact micro-USDC vouchers. Browser funding and Keryx sponsorship are separate. Pending/ambiguous/batched-attribution legs do not enter settled totals. No customer questions/identities, private invoices, complete business books, margin, cash balance, signing or execution authority. days1–31, default7. Export via /api/operator/ledger; a checksum is not authenticity or independent settlement proof.",
    inputSchema: input, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async value => {
    try {
      const parsed = input.parse(value), ledger = verifyOperatorLedger(await read(parsed.days ?? 7));
      return { content: [{ type: "text", text: JSON.stringify(ledger) }] };
    } catch { return { isError: true, content: [{ type: "text", text: "Public transfer ledger unavailable. No job, funding or private inspection was executed." }] }; }
  });
}
