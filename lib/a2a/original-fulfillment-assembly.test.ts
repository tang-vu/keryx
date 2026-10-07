import { describe, expect, it, vi } from "vitest";
import { qualityQuestion, qualityStatements, qualityTargets } from "../llm/original-fulfillment-quality-fixture";
import { ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL } from "../llm/original-fulfillment-quality";
import { enrollSupplementalSpans } from "../llm/supplemental-span-capability";
import type { QuoteOption } from "../llm/quote-options";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { FulfillmentSupplementContext } from "./fulfillment-supplement-evidence";
import type { ContinuationQualityEvidenceCapability } from "../business-operator/fulfillment-continuation-policy";
import { syntheticFailedOriginal } from "../db/a2a-fulfillment-fixture";
import { fulfillmentObjectSha256 as objectHash, fulfillmentSha256 as hash } from "./failed-original-fulfillment-protocol";
import { assembleOriginalFulfillmentRun } from "./fulfill-original";

// This pure assembly fixture has no supplier/native admission. Its explicit test
// span token covers the documentation-shaped rows, including private table/bullet
// spans; genuine policy/native token phases are tested in the protected suite.
const spans = vi.hoisted(() => new WeakMap<object, { token: object; capability: object }>());
vi.mock("./fulfillment-supplement-evidence", () => ({
  supplementaryQuoteOptions(context: object, token: object) {
    const admitted = spans.get(context);
    if (!admitted || token !== admitted.token) throw new Error("Assembly test evidence token refused");
    return { options: [], capability: admitted.capability };
  },
}));

function fixture() {
  const rows = qualityStatements(), old = syntheticFailedOriginal();
  const gathered: GatheredContent[] = ["S1", "S2", "S3", "S4"].map(marker => {
    const text = rows.filter(row => row.marker === marker).map(row => row.quote).join("\n\n");
    return { marker, text, sourceId: `public:fulfillment:${marker}`, sourceName: `Isolated documentation-shaped ${marker}`,
      sourceKind: "public-reference", creatorRewardEligible: false, contentVersion: hash(text) };
  });
  const options: QuoteOption[] = rows.map((row, index) => {
    const source = gathered.find(item => item.marker === row.marker)!, start = source.text.indexOf(row.quote);
    return { quoteId: `Q${index}`, marker: row.marker, sourceId: source.sourceId, contentVersion: source.contentVersion,
      text: row.quote, start, end: start + row.quote.length, context: source.text,
      contextStart: 0, contextEnd: source.text.length, prefixOmitted: false, suffixOmitted: false };
  });
  const token = Object.freeze({}) as ContinuationQualityEvidenceCapability;
  const capability = enrollSupplementalSpans(gathered, options, () => undefined);
  const authority = { ...old.authority, question: qualityQuestion,
    input: { ...old.authority.input, questionSha256: hash(qualityQuestion), targets: [...qualityTargets] } };
  const binding = { authority, authorization: { requiredSupportedTargetIndexes: [0, 1, 2, 3, 4] },
    packet: { input: authority.input, gathered: gathered.slice(0, 2), packetSha256: "ab".repeat(32), inputSemanticSha256: objectHash(authority.input) } };
  const claim = { ...old.input, authority, failedOrder: old.order };
  const supplement = { gathered, authoritySha256: "ac".repeat(32), contextSha256: "ad".repeat(32) } as FulfillmentSupplementContext;
  spans.set(supplement, { token, capability });
  const evidence = rows.map((row, index) => ({ claimIndex: row.claimIndex, marker: row.marker, quote: row.quote,
    quoteSpan: { start: options[index].start, end: options[index].end }, support: 0.9,
    statement: row.text, statementSupport: 0.9 }));
  const args: Parameters<typeof assembleOriginalFulfillmentRun>[0] = {
    binding: binding as Parameters<typeof assembleOriginalFulfillmentRun>[0]["binding"], claim,
    assessment: { sufficient: true, rationale: "Isolated fixture", perClaim: qualityTargets.map(claim => ({ claim, coverage: 0.8, coveredBy: ["S1", "S2", "S3", "S4"] })) },
    synthesized: { answer: "Bound factual premises. [S1] [S2] [S3] [S4]", citedMarkers: ["S1", "S2", "S3", "S4"], evidence,
      evidenceReview: "completed", conflicts: [] },
    evidenceGaps: [{ claimIndex: 4, missingRequestedParts: ["Arc contract addresses and executable authorization values are not established."] }],
    providerLedger: { sha256: "ae".repeat(32) }, engine: { name: "inert-quality-assembly", calls: [], usage: [] },
    startedAtMs: Date.parse("2026-10-06T10:00:00.000Z"), completedAtMs: Date.parse("2026-10-06T10:00:01.000Z"),
    supplement, qualityProtocol: ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL, qualityEvidenceCapability: token,
  };
  return { args, rows };
}

describe("complete original quality assembly", () => {
  it("retains all29 independently reviewed premises, original identity and explicit proposed checks/gaps", () => {
    const { args, rows } = fixture(), run = assembleOriginalFulfillmentRun(args);
    expect(run.originalFulfillment?.statements).toEqual(rows);
    expect(run.originalFulfillment).toMatchObject({ format: "keryx-a2a-original-fulfillment-result-v2", qualityProtocol: ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL,
      claimId: args.claim.claimId, providerLedgerSha256: args.providerLedger.sha256, evidenceGaps: args.evidenceGaps });
    expect(run).toMatchObject({ id: args.claim.authority.original.queryId, asker: args.claim.authority.original.payer, question: qualityQuestion,
      budget: 0.01, totalSpent: 0, totalToCreators: 0, paymentAttempts: 0, settledPayments: 0 });
    expect(run.claimCoverage?.every(row => row.coverage === 0.8)).toBe(true);
    expect(run.evidence).toHaveLength(29);
    expect(run.evidence?.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
    expect(run.citations).toHaveLength(4);
    expect(run.citations.every(row => row.reward === 0)).toBe(true);
    expect(run.answer).toContain("Proposed acceptance checks (inferences; not executed)");
    expect(run.answer).toContain("Arc contract addresses and executable authorization values are not established.");
    expect(run.answer).toContain("No real settlement is certified here.");
  });
  it.each(["omitted-middle-flow", "dropped-quorum-qualification", "unreviewed-factual-premise", "missing-opaque-token"])
    ("cannot assemble a numerically supported but incomplete answer: %s", mutation => {
      const { args } = fixture();
      if (mutation === "omitted-middle-flow") args.synthesized.evidence = args.synthesized.evidence.filter((_, index) => index !== 4);
      if (mutation === "dropped-quorum-qualification") args.synthesized.evidence[13].statement = "Gateway returns an attestation after validation.";
      if (mutation === "unreviewed-factual-premise") args.synthesized.evidence[21].statementSupport = 0.69;
      if (mutation === "missing-opaque-token") args.qualityEvidenceCapability = undefined;
      expect(() => assembleOriginalFulfillmentRun(args)).toThrow();
    });
});
