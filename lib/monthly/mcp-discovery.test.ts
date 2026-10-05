import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { registerMonthlyDiscovery } from "./mcp-discovery";
import type { MonthlyQuote } from "./protocol";

function quote(network: MonthlyQuote["network"]): MonthlyQuote {
  return { plan: "research-monthly-v1", requests: 4, termDays: 30, researchMode: "deep", packageVersion: "1.0.0",
    creatorBudgetMicros: 20000, serviceFeeMicros: 28000, totalMicros: 108000, separateTotalMicros: 120000,
    roundingMicros: 0, payee: `0x${"1".repeat(40)}`, network, quoteId: "a".repeat(64) };
}

describe("Monthly MCP discovery payment boundary", () => {
  it.each([ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE])("preserves the $name quote's original network without spending", async (profile) => {
    const server = { registerTool: vi.fn() }, current = quote(profile.networkId), readQuote = vi.fn(async () => current);
    registerMonthlyDiscovery(server, readQuote);
    const [name, options, handler] = server.registerTool.mock.calls[0];
    expect(name).toBe("research_monthly");
    expect(options.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(options.description).not.toMatch(/Arc-testnet|eip155:5042/);
    const payload = JSON.parse((await handler()).content[0].text);
    expect(readQuote).toHaveBeenCalledOnce();
    expect(payload).toMatchObject({ available: true, quote: current });
    expect(payload.boundary).toContain("this tool never spends");
  });

  it("retains an unavailable handoff when the quote cannot be read", async () => {
    const server = { registerTool: vi.fn() };
    registerMonthlyDiscovery(server, async () => { throw new Error("quote unavailable"); });
    const result = await server.registerTool.mock.calls[0][2]();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ available: false, quote: null,
      handoff: "https://keryx.cc/research#monthly" });
  });
});
