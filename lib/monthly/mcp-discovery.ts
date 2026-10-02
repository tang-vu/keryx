import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MonthlyQuote } from "./protocol";

export function registerMonthlyDiscovery(server: McpServer, quote: () => Promise<MonthlyQuote | null>) {
  server.registerTool("research_monthly", { title: "Research Monthly pilot",
    description: "Read the four-request, 30-day Arc-testnet Monthly quote and handoff. Never buys or redeems a plan.", inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async () => {
    let current: MonthlyQuote | null = null; try { current = await quote(); } catch { /* Offer unavailable. */ }
    return { content: [{ type: "text" as const, text: JSON.stringify({ available: !!current, quote: current,
      handoff: "https://keryx.cc/research#monthly", api: "https://keryx.cc/api/research/monthly",
      boundary: "Four public Deep research requests over 30 days. Manual renewal, no scheduler. Failed and pending jobs retain slots. Use the buyer wallet on web/API or Monthly CLI; this tool never spends or assumes ownership of a caller plan." }) }] };
  });
}
