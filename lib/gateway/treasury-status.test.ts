import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const state = vi.hoisted(() => ({ treasury: null as unknown, index: 0, effects: [] as (() => () => void)[] }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => () => void) => { state.effects.push(effect); }, useState: (initial: unknown) => {
    const index = state.index++;
    return [index === 1 ? state.treasury : initial, (value: unknown) => { if (index === 1) state.treasury = value; }];
  } }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/registry-status-section", () => ({ RegistryStatusSection: () => null }));
vi.mock("@/components/keryx/dispatch-health-section", () => ({ DispatchHealthSection: () => null }));
vi.mock("@/components/keryx/settlement-proof-section", () => ({ SettlementProofSection: () => null }));
vi.mock("@/components/keryx/pending-reconciliation-section", () => ({ PendingReconciliationSection: () => null }));
import StatusPage from "../../app/status/page";

beforeEach(() => { state.index = 0; state.effects = []; });
afterEach(() => { vi.unstubAllGlobals(); });
it.each([null, "0", "5"])("renders mainnet available %s without inventing confirmed deposits or readiness", amount => {
  state.treasury = { available: amount !== null, unifiedBalance: null,
    observation: { network: "eip155:5042", address: "0x9e88d16c3ecb07b9e84df13ef38dd6b673bd285c", availableUsdc: amount } };
  const page = renderToStaticMarkup(createElement(StatusPage));
  expect(page).toContain("Public research treasury · Arc mainnet"); expect(page).toContain("Gateway available USDC");
  expect(page).toContain(amount === null ? "Unknown" : `$${amount}`);
  expect(page).toContain("Available balance is checked again before research spending");
  expect(page).not.toContain("Confirmed (all chains)"); expect(page).not.toContain("Pending deposits");
  expect(page).not.toContain("Circle App Kit");
});
it("preserves the legacy testnet confirmed/pending kit presentation", () => {
  state.treasury = { available: true, unifiedBalance: { address: `0x${"a".repeat(40)}`, totalConfirmedUsdc: "1.000000",
    totalPendingUsdc: "0.100000", perChain: [{ chain: "Arc_Testnet", confirmed: "1.000000", pending: "0.100000" }] } };
  const page = renderToStaticMarkup(createElement(StatusPage));
  expect(page).toContain("Confirmed (all chains)"); expect(page).toContain("Pending deposits"); expect(page).toContain("$0.100000");
  expect(page).toContain("Circle App Kit"); expect(page).not.toContain("Arc mainnet");
});
it.each(["refused", "transport"])("clears an already displayed testnet snapshot when the next mainnet read is %s", async failure => {
  state.treasury = { available: true, unifiedBalance: { address: `0x${"a".repeat(40)}`, totalConfirmedUsdc: "1.000000",
    totalPendingUsdc: "0.100000", perChain: [] } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/health") return Response.json({ ok: true, network: "arc" });
    if (failure === "transport") throw new Error("upstream unavailable");
    return Response.json({ available: false, via: "circle-gateway-api", unifiedBalance: null, observation: null }, { status: 503 });
  }));
  expect(renderToStaticMarkup(createElement(StatusPage))).toContain("Circle App Kit");
  const cleanup = state.effects[0]();
  try {
    await vi.waitFor(() => expect(state.treasury).toBeNull());
    state.index = 0;
    expect(renderToStaticMarkup(createElement(StatusPage))).not.toContain("Circle App Kit");
  } finally { cleanup(); }
});
