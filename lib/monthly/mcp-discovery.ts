import type { MonthlyQuote } from "./protocol";

// Root and packaged stdio install independent pinned SDK copies. Share only this
// capability, rather than a nominal SDK class whose private fields differ by copy.
interface DiscoveryRegistrar {
  registerTool(name: string, options: { title: string; description: string; inputSchema: Record<string, never>;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } },
  handler: () => Promise<{ content: { type: "text"; text: string }[] }>): unknown;
}

export function registerMonthlyDiscovery(server: DiscoveryRegistrar, quote: () => Promise<MonthlyQuote | null>) {
  server.registerTool("research_monthly", { title: "Research Monthly pilot",
    description: "Read the four-request, 30-day Arc-testnet Monthly quote and handoff. Never buys or redeems a plan.", inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async () => {
    let current: MonthlyQuote | null = null; try { current = await quote(); } catch { /* Offer unavailable. */ }
    return { content: [{ type: "text" as const, text: JSON.stringify({ available: !!current, quote: current,
      handoff: "https://keryx.cc/research#monthly", api: "https://keryx.cc/api/research/monthly",
      boundary: "Four public Deep research requests over 30 days. Manual renewal, no scheduler. Failed and pending jobs retain slots. Use the buyer wallet on web/API or Monthly CLI; this tool never spends or assumes ownership of a caller plan." }) }] };
  });
}
