#!/usr/bin/env node
/**
 * Keryx MCP server — add Keryx to any agent in one line.
 *
 * Exposes Keryx's paid autonomous-research endpoint as MCP tools. The calling agent asks a question;
 * this server pays the x402 toll from the user's own Arc-testnet wallet, Keryx researches across paid
 * sources and answers with citations, then pays every creator it cites downstream. Each call is a real
 * on-chain USDC payment on Arc — and shows up live on the keryx.cc dashboard as external traction.
 *
 * Transport: stdio. Configure it in any MCP client (Claude Code/Desktop, etc.) — see mcp/README.md.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askKeryx, getStatus, meta, recoverKeryx } from "./keryx-buyer.mts";

const server = new McpServer({ name: "keryx", version: "0.1.0" });

server.registerTool(
  "ask_keryx",
  {
    title: "Ask Keryx",
    description:
      `Ask Keryx — an autonomous research agent that buys paid sources under a budget, answers with ` +
      `inline citations, and pays each cited creator in USDC on Arc. Default deep-mode price is ` +
      `${meta.feeUsdc} USDC service fee + ${meta.defaultBudgetUsdc} USDC creator budget; the POST body sets the exact price. ` +
      `Paid from your own funded Arc-testnet wallet (run keryx_wallet_status first to fund it). ` +
      `Public research may send your question to Keryx's search provider. The source USDC budget is separate from model and search operating costs. ` +
      `Use when you want a grounded, source-cited answer AND the creators paid for their work.`,
    inputSchema: {
      question: z.string().min(3).describe("The research question to ask Keryx."),
      budget: z
        .number()
        .positive()
        .optional()
        .describe("Optional prepaid creator-spend cap in USDC (default 0.05); added to the deep-mode service fee."),
    },
  },
  async ({ question, budget }) => {
    try {
      const r = await askKeryx(question, budget);
      const cites = r.citations?.length
        ? r.citations.map((c) => `  • ${c.source} — $${c.reward}`).join("\n")
        : "  (none)";
      // The settlement id is a batched Circle Gateway UUID, not an EVM hash — label it honestly and
      // point at the dashboard for the on-chain proof rather than a /tx/ link that won't resolve.
      const proof = r.settlementId ? ` (Circle Gateway settlement ${r.settlementId.slice(0, 12)}…, batched on Arc)` : "";
      const text =
        `${r.answer}\n\n` +
        `— Paid Keryx ${r.amountPaid} USDC${proof}\n` +
        `Keryx paid ${r.creatorsPaid} creator(s) $${r.totalToCreators} downstream:\n${cites}\n` +
        `On-chain proof + live feed: ${meta.baseUrl}/dashboard`;
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text: `Keryx call failed: ${msg}` }] };
    }
  },
);

server.registerTool(
  "keryx_recover",
  {
    title: "Recover paid Keryx research",
    description: "Read the saved payment attempt and poll its query ID without submitting another payment. Use after a paid error or uncertain network outcome.",
    inputSchema: {},
  },
  async () => {
    try {
      const recovered = await recoverKeryx();
      return { content: [{ type: "text" as const, text: JSON.stringify(recovered, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `Recovery failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

server.registerTool(
  "keryx_wallet_status",
  {
    title: "Keryx wallet status",
    description:
      "Show the Arc-testnet wallet the Keryx MCP server pays from: address, balances, whether it's " +
      "ready, and exactly how to fund it via the Circle faucet. Run this before ask_keryx.",
    inputSchema: {},
  },
  async () => {
    try {
      const s = await getStatus();
      const text =
        `Keryx buyer wallet\n` +
        `  address:  ${s.address}\n` +
        `  USDC:     ${s.usdcBalance}\n` +
        `  gas:      ${s.gasBalance}\n` +
        `  Gateway:  ${s.gatewayAvailable} USDC available\n` +
        `  ready:    ${s.ready ? "yes" : "no"}\n\n` +
        `${s.instructions}`;
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Status check failed: ${msg}` }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the MCP protocol channel — all human-facing logging must go to stderr.
console.error(`Keryx MCP server ready · paying from ${meta.address} → ${meta.baseUrl}`);
