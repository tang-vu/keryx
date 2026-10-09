#!/usr/bin/env node
/**
 * Keryx MCP server — add Keryx to any agent in one line.
 *
 * Exposes Keryx's paid autonomous-research endpoint as MCP tools. The calling agent asks a question;
 * this server pays the x402 toll from the user's own deployment-selected Arc wallet, Keryx researches across paid
 * sources and answers with citations, then pays creators downstream. Settlement receipts and
 * pending outcomes remain distinct; self-operated calls do not establish external traction.
 *
 * Transport: stdio. Configure it in any MCP client (Claude Code/Desktop, etc.) — see mcp/README.md.
 */

import packageInfo from "./package.json" with { type: "json" };

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askKeryx, getStatus, meta, recoverKeryx } from "./keryx-buyer.mts";
import { reasoningServingText } from "../lib/llm/reasoning-telemetry.ts";
import { formatRecordedUsdc } from "../lib/display/recorded-usdc.ts";
import { createPaperLookupHandler, paperLookupToolOptions } from "../lib/papers/lookup.ts";
import { fetchPaperLookup } from "../lib/papers/client.ts";
import { MAX_ASK_QUESTION_CHARS } from "../lib/ask-input.ts";
import { registerProfileTools } from "../lib/profiles/profile-mcp.ts";
import { registerIdentityReadTool } from "../lib/profiles/identity-mcp.ts";
import { createProfileClient } from "../lib/profiles/profile-client.ts";
import { registerObligationInspection } from "../lib/operator-obligations/mcp.ts";
import { createObligationClient } from "../lib/operator-obligations/client.ts";
import { registerEvidenceDraftTool } from "../lib/research/evidence-draft-tool.ts";
import { createHistoryClient } from "../lib/history/personal-history-client.ts";
import { registerHistoryTool } from "../lib/history/personal-history-mcp.ts";
import { registerAcceptanceTools } from "../lib/deliverable-acceptance/mcp.ts";
import { createAcceptanceClient } from "../lib/deliverable-acceptance/client.ts";

const server = new McpServer({ name: "keryx", version: packageInfo.version });
registerObligationInspection(server, () => createObligationClient(meta.baseUrl, () => process.env.KERYX_API_KEY).read());
registerEvidenceDraftTool(server);
const acceptanceClient = () => createAcceptanceClient(meta.baseUrl, () => process.env.KERYX_API_KEY);
registerAcceptanceTools(server, { read: id => acceptanceClient().read(id), submit: (id, input) => acceptanceClient().submit(id, input) });
const profileClient = () => createProfileClient(meta.baseUrl, () => process.env.KERYX_API_KEY);
registerProfileTools(server, { read: () => profileClient().read(), update: input => profileClient().update(input) });
registerHistoryTool(server, input => createHistoryClient(meta.baseUrl, () => process.env.KERYX_API_KEY).read(input));
registerIdentityReadTool(server, () => profileClient().readIdentities());
server.registerTool("paper_lookup", paperLookupToolOptions,
  createPaperLookupHandler(input => fetchPaperLookup(meta.baseUrl, input)));
import { registerMonthlyDiscovery } from "../lib/monthly/mcp-discovery.ts";
import { fetchMonthlyQuote } from "../lib/monthly/client.ts";
import { registerOperatorDiscovery } from "../lib/business-operator/mcp.ts";
import { fetchOperatorStatus } from "../lib/business-operator/client.ts";
import { registerPublicJobLedger } from "../lib/operator-ledger/mcp.ts";
import { registerPurchaseOutcomes } from "../lib/research/purchase-outcomes-mcp.ts";
import { fetchPurchaseOutcomes } from "../lib/research/purchase-outcomes-client.ts";
import { fetchOperatorLedger } from "../lib/operator-ledger/client.ts";
registerMonthlyDiscovery(server, fetchMonthlyQuote);
registerOperatorDiscovery(server, () => fetchOperatorStatus(meta.baseUrl));
registerPublicJobLedger(server, days => fetchOperatorLedger(meta.baseUrl, days));
registerPurchaseOutcomes(server, id => fetchPurchaseOutcomes(meta.baseUrl, id));

server.registerTool(
  "ask_keryx",
  {
    title: "Ask Keryx",
    description:
      `Ask Keryx — an autonomous research agent that buys paid sources under a budget, answers with ` +
      `inline citations, and pays each cited creator in USDC on Arc. Default deep-mode price is ` +
      `${meta.feeUsdc} USDC service fee + ${meta.defaultBudgetUsdc} USDC creator budget; the POST body sets the exact price. ` +
      `Paid from your own funded ${meta.networkLabel} wallet (${meta.network}; run keryx_wallet_status first). ` +
      `Public research may send your question to Keryx's search provider. The source USDC budget is separate from model and search operating costs. ` +
      `New hosted runs are attributed to the verified paying wallet through agent-to-agent ingress; editable client metadata does not prove stdio identity or grant additional rights. ` +
      `Use when you want a grounded, source-cited answer AND the creators paid for their work. ` +
      `For title, ordered authors, year, journal, DOI or exact arXiv version without reading paper findings, use free paper_lookup with an exact identifier instead.`,
    inputSchema: {
      reviewFirst: z.literal(false).optional().describe("Review-first requires the authenticated live browser; this adapter refuses true."),
      mode: z.never().optional().describe("Interactive review mode is unavailable on stdio."),
      researchMode: z.never().optional(), responseMode: z.never().optional(),
      question: z.string().max(8192).trim().min(3).max(MAX_ASK_QUESTION_CHARS)
        .describe(`The research question to ask Keryx (3–${MAX_ASK_QUESTION_CHARS} characters after trimming).`),
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
        ? r.citations.map((c) => `  • ${c.source} — ${formatRecordedUsdc(c.reward)}`).join("\n")
        : "  (none)";
      // The settlement id is a batched Circle Gateway UUID, not an EVM hash — label it honestly and
      // point at the dashboard for the on-chain proof rather than a /tx/ link that won't resolve.
      const proof = r.settlementId ? ` (Circle Gateway settlement ${r.settlementId.slice(0, 12)}…, batched on Arc)` : "";
      const text =
        `${r.answer}\n\n` +
        `${reasoningServingText(r)}\n\n` +
        `— Paid Keryx ${r.amountPaid} USDC${proof}\n` +
        `Recorded creator total: ${formatRecordedUsdc(r.totalToCreators)}; citation allocations (not individual settlement proof):\n${cites}\n` +
        `On-chain proof + live feed: ${meta.baseUrl}/dashboard`;
      return { content: [{ type: "text" as const, text }], structuredContent: { ...r } };
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
      `Show the configured ${meta.networkLabel} wallet (${meta.network}) the Keryx MCP server pays from: address, balances and readiness. ` +
      (meta.faucet ? "Testnet funds are available through the Circle faucet. " : "Mainnet funds and native setup gas must come from the owner. ") +
      "Run this before ask_keryx.",
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
console.error(`Keryx MCP server ready · ${meta.address} · ${meta.baseUrl}`);
