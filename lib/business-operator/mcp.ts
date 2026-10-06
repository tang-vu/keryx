import { operatorBusinessStatusSchema } from "./contracts";

// Hosted and packaged stdio use independent SDK copies. Share the registration
// capability, not the nominal SDK class with copy-specific private fields.
interface DiscoveryRegistrar {
  registerTool(name: string, options: {
    title: string;
    description: string;
    inputSchema: Record<string, never>;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  }, handler: () => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>): unknown;
}

/** Discovery only. The shared contract grants no signer, job or scheduler access. */
export function registerOperatorDiscovery(server: DiscoveryRegistrar, read: () => Promise<unknown>) {
  server.registerTool("keryx_operator_status", {
    title: "Keryx business Operator status",
    description: "Observe public prepaid research operations, queue and hold/review rationale. No spending or execution authority; exact books and customer jobs stay private.",
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(operatorBusinessStatusSchema.parse(await read())) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Operator observation unavailable. This tool did not execute or fund a job." }] };
    }
  });
}
