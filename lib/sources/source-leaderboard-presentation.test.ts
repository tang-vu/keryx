import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SourceLeaderboard } from "../../components/keryx/source-leaderboard";
import type { SourceLeaderboard as Data, SourceLeaderboardRow } from "./source-leaderboard";

const row: SourceLeaderboardRow = { sourceId: "public:one", sourceName: "One", href: "https://one.example/",
  kind: "public-reference", creatorEarnedUsdc: 0, paymentCount: 0, citationCount: 0,
  operatingFeeUsdc: 0.0025, operatingFeePaymentCount: 1, operatingFeeCitationCount: 1,
  feeBeneficiaries: ["0x1111111111111111111111111111111111111111"] };
const data: Data = { rows: [row, { ...row, sourceId: "public:two", sourceName: "Two", href: "https://two.example/" },
  { ...row, sourceId: "public:zero", sourceName: "Zero", operatingFeeUsdc: 0, operatingFeePaymentCount: 0, operatingFeeCitationCount: 0, feeBeneficiaries: [] }],
  catalogStatus: "ready", operatingFeesStatus: "ready", operatingFeeNetwork: "eip155:5042" };

it("renders all source rows, distinct accounting labels and source links for a shared recipient", () => {
  const html = renderToStaticMarkup(createElement(SourceLeaderboard, { data, network: "Arc mainnet" }));
  expect(html.match(/data-source-id=/g)).toHaveLength(3);
  expect(html).toContain('href="https://one.example/"');
  expect(html).toContain('href="https://two.example/"');
  expect(html).not.toContain('/creator/public:');
  expect(html).toContain("Creator rewards");
  expect(html).toContain("Owner fee");
  expect(html).toContain("not publisher earnings");
  expect(html).toContain("Zero");
});

it.each([
  ["incomplete", "Not publicly attributed", "Settled owner fees can exist without public source attribution."],
  ["unavailable", "Unavailable", "Per-source owner fee records are temporarily unavailable."],
] as const)("distinguishes %s attribution from settled fee totals without inventing a zero", (operatingFeesStatus, label, explanation) => {
  const html = renderToStaticMarkup(createElement(SourceLeaderboard, { data: { ...data, operatingFeesStatus,
    rows: [{ ...row, operatingFeeUsdc: null, operatingFeePaymentCount: null, operatingFeeCitationCount: null }] }, network: "Arc mainnet" }));
  expect(html).toContain(label);
  expect(html).toContain(explanation);
  expect(html).not.toContain("Unknown");
  expect(html).toContain('href="#payment-proof-title"');
  expect(html).toContain("View settled operating fee totals");
});
