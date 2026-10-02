import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("requires the independently captured public block window to match server cashout settings", async () => {
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "300"); vi.stubEnv("NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "300");
  vi.resetModules(); const policy = await import("./browser-session-cashout-policy");
  expect(policy.browserSessionCashoutMaxAheadBlocks()).toBe("300"); expect(policy.configuredSessionCashoutMaxAheadBlocks()).toBe("300");
  vi.stubEnv("NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "999");
  expect(policy.browserSessionCashoutMaxAheadBlocks()).toBe("300");
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "999"); expect(() => policy.configuredSessionCashoutMaxAheadBlocks()).toThrow();
});
it.each([undefined,"","0","01","-1","1.2","9007199254740992"])("closes cashout when the compiled block window is %s", async pin => {
  vi.stubEnv("NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", pin); vi.resetModules();
  const policy = await import("./browser-session-cashout-policy");
  expect(() => policy.browserSessionCashoutMaxAheadBlocks()).toThrow();
});
