/** Optional v1 result shapes accepted by the production TypeScript GET verifier and writer. */
import type { BuyerJob } from "../lib/a2a/buyer-workspace.ts";

export const defaultCitation = { marker: "[1]", sourceName: "Créateur <source> * one" };
type DisplayCitation = { marker: string; sourceName: string };
type OptionalJobFields = Partial<Pick<BuyerJob,
  "serviceStatus" | "serviceReceipt" | "claimCoverage" | "evidence" | "message" | "error">>;

export type ResultFixture = {
  label: string;
  pricing?: { unusedCreatorReserveUsdc: number | null; accountingComplete?: boolean };
  jobFields?: OptionalJobFields;
  citations?: unknown[] | "omit";
  expectedCitations: DisplayCitation[];
};

const firstCitations = Array.from({ length: 63 }, (_, index) => ({
  marker: `[${index + 1}]`, sourceName: `Source ${index + 1}`,
}));
const cappedCitations = [...firstCitations,
  { marker: "x".repeat(65), sourceName: "Invalid at position 64" },
  { marker: "[late]", sourceName: "Outside the first 64" }];

export const resultFixtures: ResultFixture[] = [
  {
    label: "legacy nullable creator reserve",
    pricing: { unusedCreatorReserveUsdc: null },
    expectedCitations: [defaultCitation],
  },
  {
    label: "all optional buyer measurements",
    pricing: { unusedCreatorReserveUsdc: 0.015, accountingComplete: true },
    jobFields: {
      serviceStatus: { elapsedMs: 1234, targetCompletionMs: 180000, targetBreached: false },
      serviceReceipt: { totalDurationMs: 1234, targetCompletionMs: 180000, targetMet: true,
        quality: { status: "measured", groundedClaimRate: 0.75 } },
      claimCoverage: [{ claimIndex: 0, claim: "Arc claim", coverage: 0.75 }],
      evidence: [{ claimIndex: 0, sourceName: "Creator", quote: "Exact evidence" }],
      message: "Completed with measured quality",
      error: "Historical diagnostic retained",
    },
    expectedCitations: [defaultCitation],
  },
  {
    label: "unavailable quality and incomplete accounting",
    pricing: { unusedCreatorReserveUsdc: null, accountingComplete: false },
    jobFields: {
      serviceStatus: { elapsedMs: 180001, targetCompletionMs: 180000, targetBreached: true },
      serviceReceipt: { totalDurationMs: 180001, targetCompletionMs: 180000, targetMet: false,
        quality: { status: "unavailable", groundedClaimRate: null } },
      claimCoverage: [], evidence: [], message: "Seller did not report quality", error: "Unavailable",
    },
    expectedCitations: [defaultCitation],
  },
  {
    label: "lossless optional job text and large claim indices",
    jobFields: {
      claimCoverage: [
        { claimIndex: 9007199254740992, claim: "High \ud800", coverage: 1 },
        { claimIndex: 9007199254740994, claim: "Low \udc00", coverage: 0 },
      ],
      evidence: [
        { claimIndex: 9007199254740992, sourceName: "High \ud800", quote: "Low \udc00" },
        { claimIndex: 9007199254740994, sourceName: "Low \udc00", quote: "High \ud800" },
      ],
      message: "High \ud800", error: "Low \udc00",
    },
    expectedCitations: [defaultCitation],
  },
  { label: "receipt citations absent", citations: "omit", expectedCitations: [] },
  { label: "receipt citations empty", citations: [], expectedCitations: [] },
  {
    label: "malformed receipt citations filtered",
    citations: [
      { marker: "[valid]", sourceName: "Valid creator" }, null, 5, {}, { marker: "[missing]" },
      { marker: "x".repeat(65), sourceName: "Long marker" },
      { marker: "[long]", sourceName: "x".repeat(257) },
      { marker: "[also valid]", sourceName: "Second creator" },
    ],
    expectedCitations: [
      { marker: "[valid]", sourceName: "Valid creator" },
      { marker: "[also valid]", sourceName: "Second creator" },
    ],
  },
  {
    label: "citation UTF-16 field bounds",
    citations: [
      { marker: "😀".repeat(32), sourceName: "Exact marker" },
      { marker: `${"😀".repeat(32)}A`, sourceName: "Long marker" },
      { marker: "[exact name]", sourceName: "😀".repeat(128) },
      { marker: "[long name]", sourceName: `${"😀".repeat(128)}A` },
    ],
    expectedCitations: [
      { marker: "😀".repeat(32), sourceName: "Exact marker" },
      { marker: "[exact name]", sourceName: "😀".repeat(128) },
    ],
  },
  {
    label: "receipt citations capped before filtering",
    citations: cappedCitations,
    expectedCitations: firstCitations,
  },
];
