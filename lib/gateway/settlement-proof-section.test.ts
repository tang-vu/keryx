import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettlementProofSection, type SettlementHealth } from "../../components/keryx/settlement-proof-section";

const summary: SettlementHealth = {
  checkedAt: "2026-10-04T00:00:00Z", owedUsdc: 1, confirmedUsdc: 1, cashedOutUsdc: 0,
  counts: { confirmed: 1, surplus: 0, cashedOut: 0, short: 0, unknown: 0 },
  accounts: [{ address: `0x${"11".repeat(20)}`, owedUsdc: 1, heldUsdc: 1, verdict: "confirmed" }],
};

it("does not turn an observed empty ledger into Circle-confirmed settlement", () => {
  const markup = renderToStaticMarkup(createElement(SettlementProofSection, { settlement: {
    ...summary, basis: "empty-ledger", network: "eip155:5042", owedUsdc: 0, confirmedUsdc: 0,
    accounts: [], counts: { confirmed: 0, surplus: 0, cashedOut: 0, short: 0, unknown: 0 },
  } }));
  expect(markup).toContain("Circle balances were not queried");
  expect(markup).not.toContain("confirmed by Circle");
  expect(markup).not.toContain("curl -s");
});

it("does not hide recorded nonzero payouts behind a conflicting empty-ledger label", () => {
  const markup = renderToStaticMarkup(createElement(SettlementProofSection, { settlement: { ...summary, basis: "empty-ledger" } }));
  expect(markup).toContain("$1.000000");
  expect(markup).not.toContain("Circle balances were not queried");
});

it.each([
  ["eip155:5042", "https://gateway-api.circle.com/v1/balances", "Arc mainnet"],
  ["eip155:5042002", "https://gateway-api-testnet.circle.com/v1/balances", "Arc Testnet"],
])("keeps the original %s observation's endpoint", (network, endpoint, label) => {
  const markup = renderToStaticMarkup(createElement(SettlementProofSection, { settlement: { ...summary, network } }));
  expect(markup).toContain(`curl -s ${endpoint}`);
  expect(markup).toContain(label);
  expect(markup.match(/curl -s /g)).toHaveLength(1);
});

it.each([undefined, "unknown", "eip155:1"])("does not invent a lookup network for retained %s observations", network => {
  const markup = renderToStaticMarkup(createElement(SettlementProofSection, { settlement: { ...summary, network } }));
  expect(markup).not.toContain("curl -s");
  expect(markup).not.toContain("gateway-api");
  expect(markup).toContain("no recognized original network");
  expect(markup).toContain("$1.000000");
});
