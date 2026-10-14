import { describe, expect, it, vi } from "vitest";
import { runPrivateJobHistoryCli, PRIVATE_JOB_HISTORY_HELP } from "./private-job-history-cli";
import { PRIVATE_JOB_HISTORY_ORIGIN, PRIVATE_JOB_HISTORY_REFUSAL } from "./private-job-history-client";
import { PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities } from "./private-job-history-contract";

const wallet = `0x${"a".repeat(40)}`, token = `kx_live_${"1".repeat(96)}`, id = `prv_${"1".repeat(64)}`;
const date = "2026-10-14T00:00:00.123456+00:00";
const row = { id, ownerWallet: wallet, createdAt: date, intentCreatedAt: date, savedAt: date, question: " \uFEFF=PRIVATE formula",
  researchMode: "deep", model: null, packageVersion: "1.0.0", record: "finalized-private-result", provenance: null,
  incomingSettlement: { status: "settled", amountMicros: "120000", network: "eip155:5042", reference: "incoming", settledAt: date,
    evidenceSource: "circle-facilitator-success", chainFinalityVerified: false }, ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null };
const envelope = { format: "private-job-history-v1", wallet, scope: "exact-payer-private-current-store",
  capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION };
const page = { ...envelope, rows: [row], nextCursor: null, scanLimited: false, scannedIntents: 1 };
const exported = { ...envelope, rows: [row], nextCursor: "continue", complete: false, truncated: true, pages: 1,
  bounds: { maxPages: 20, maxRows: 500, maxBytes: 2097152 } };
const detail = { ...envelope, row: { ...row, intentCreatedAt: null }, result: { answer: "PRIVATE saved answer", engine: "saved",
  createdAt: date, savedAt: date, subClaims: [], decisions: [], citations: [], evidence: null, claimCoverage: null,
  paymentEvidence: "incoming-only-no-creator-ledger" } };
function fixture() {
  const write = vi.fn(), error = vi.fn(), fetcher = vi.fn<typeof fetch>(async url => Response.json(String(url).endsWith("/detail")
    ? detail : String(url).endsWith("/export") ? exported : page));
  return { write, error, fetcher, key: () => token };
}

describe("actual completed-private-history CLI adapter (UNRUN source fixtures)", () => {
  it("help discloses private output and finite roles without requiring a key or network", async () => {
    const io = fixture(); io.key = () => "";
    expect(await runPrivateJobHistoryCli(["--help"], io)).toBe(0);
    expect(io.write).toHaveBeenCalledWith(PRIVATE_JOB_HISTORY_HELP); expect(io.fetcher).not.toHaveBeenCalled();
    expect(PRIVATE_JOB_HISTORY_HELP).toContain("PRIVATE DATA"); expect(PRIVATE_JOB_HISTORY_HELP).toContain("precondition only");
  });
  it("uses fixed HTTPS list origin and body-only literal filters", async () => {
    const io = fixture();
    expect(await runPrivateJobHistoryCli(["list", "--limit", "1", "--search", "PRIVATE", "--surface", "unknown",
      "--network", "eip155:5042", "--from", date, "--to", date, "--expected-wallet", wallet], io)).toBe(0);
    expect(String(io.fetcher.mock.calls[0][0])).toBe(`${PRIVATE_JOB_HISTORY_ORIGIN}/api/me/private-jobs`);
    expect(JSON.parse(String(io.fetcher.mock.calls[0][1]!.body))).toEqual({ limit: 1, search: "PRIVATE", surface: "unknown",
      network: "eip155:5042", from: date, to: date });
    const output = JSON.parse(io.write.mock.calls[0][0]);
    expect(output.rows[0]).toMatchObject({ provenance: null, ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null });
    expect(io.error).not.toHaveBeenCalled();
  });
  it("detail is an explicit private ID read and prints saved text only to caller stdout", async () => {
    const io = fixture(); expect(await runPrivateJobHistoryCli(["detail", "--id", id], io)).toBe(0);
    expect(JSON.parse(String(io.fetcher.mock.calls[0][1]!.body))).toEqual({ id });
    expect(String(io.fetcher.mock.calls[0][0])).toBe(`${PRIVATE_JOB_HISTORY_ORIGIN}/api/me/private-jobs/detail`);
    expect(JSON.parse(io.write.mock.calls[0][0]).result.answer).toBe("PRIVATE saved answer");
  });
  it.each(["json", "csv"])("manual %s export fetches schema JSON once, preserves truncation and omits answers", async format => {
    const io = fixture(); expect(await runPrivateJobHistoryCli(["export", "--format", format], io)).toBe(0);
    expect(io.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(io.fetcher.mock.calls[0][1]!.body))).toEqual({ limit: 25, format: "json" });
    const output = io.write.mock.calls[0][0] as string;
    expect(output).not.toContain("PRIVATE saved answer"); expect(output).not.toContain(token);
    if (format === "json") expect(JSON.parse(output)).toMatchObject({ truncated: true, complete: false, nextCursor: "continue" });
    else { expect(output).toContain('"\' \uFEFF=PRIVATE formula"'); expect(output).toContain('""truncated"":true'); }
  });
  it.each([
    [], ["unknown"], ["--help", "--id", id], ["list", "--help"], ["list", "--limit"], ["list", "--limit", "1", "--limit", "2"],
    ["list", "--limit", "01"], ["list", "--limit", "1e1"], ["list", "--limit", "Infinity"], ["list", "--limit", "26"],
    ["list", "--wallet", wallet], ["list", "--key", token], ["list", "--origin", "https://other.test"], ["list", "--format", "json"],
    ["detail"], ["detail", "--id", "foreign"], ["detail", "--id", id, "--search", "PRIVATE"], ["detail", "--id", id, "--format", "json"],
    ["export", "--format", "report"], ["list", "--surface", "arbitrary"], ["list", "--network", "mainnet"],
    ["list", "--expected-wallet", "chat-label"], ["list", "--search", "x".repeat(8193)],
  ].map(args => [args]))("rejects strict unknown/duplicate/malformed flags with zero IO: %j", async args => {
    const io = fixture(); expect(await runPrivateJobHistoryCli(args, io)).toBe(1);
    expect(io.fetcher).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled();
    expect(io.error).toHaveBeenCalledWith(PRIVATE_JOB_HISTORY_REFUSAL + " Use --help for bounded flags and explicit history-key requirements.\n");
    expect(io.error.mock.calls[0][0]).not.toContain(token);
  });
  it("missing key refuses before IO; arbitrary transport errors never leak credentials or bodies", async () => {
    const io = fixture(); io.key = () => "";
    expect(await runPrivateJobHistoryCli(["list"], io)).toBe(1); expect(io.fetcher).not.toHaveBeenCalled();
    io.key = () => token; io.fetcher.mockRejectedValue(new Error(`PRIVATE ${token} cursor_secret`)); io.error.mockClear();
    expect(await runPrivateJobHistoryCli(["list"], io)).toBe(1); expect(io.write).not.toHaveBeenCalled();
    expect(io.error.mock.calls[0][0]).not.toMatch(/PRIVATE|kx_live_|cursor_secret/);
    expect(io.fetcher).toHaveBeenCalledTimes(1);
  });
  it("pre-aborted command has zero IO and no private stdout", async () => {
    const io = fixture();
    const controller = new AbortController(); controller.abort();
    expect(await runPrivateJobHistoryCli(["list"], { ...io, signal: controller.signal })).toBe(1);
    expect(io.write).not.toHaveBeenCalled(); expect(io.fetcher).not.toHaveBeenCalled();
  });
});
