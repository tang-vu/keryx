import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { walkthroughMessages } from "@/locales/en/walkthrough";
import { checkRecordedReceipt, readRecordedReceipt, recordedWalkthrough } from "./recorded-walkthrough";

const receipt = JSON.parse(readFileSync("fixtures/walkthrough/recorded-mainnet-receipt.json", "utf8"));

it("labels the payout check as retained V1 and the question speaker as a test persona", () => {
  expect(walkthroughMessages.registryNote).toContain("0x42a64061b6cd84067bb660b2a9b8aa881fd225bb");
  expect(walkthroughMessages.registryRegistered).toContain("Retained SourceRegistry V1");
  expect(walkthroughMessages.registryRegistered).toContain("not the V3 registry in health");
  expect(walkthroughMessages.limitation).toContain("test persona");
  expect(walkthroughMessages.steps[2].limit).toContain("retained V1 registry");
});

it("matches the independently retained public QA digest and refuses altered payloads or self-asserted digests", async () => {
  expect(await checkRecordedReceipt(receipt)).toBe("matched");
  const altered = structuredClone(receipt); altered.payload.dispatch.answer += " changed";
  expect(await checkRecordedReceipt(altered)).toBe("changed");
  expect(await checkRecordedReceipt({ integrity: receipt.integrity, payload: {} })).toBe("changed");
});

it("reads only the fixed public original with one credential-free bounded GET", async () => {
  const fetcher = vi.fn(async () => Response.json(receipt));
  expect(await readRecordedReceipt(new AbortController().signal, fetcher)).toBe("matched");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([recordedWalkthrough.receiptPath, expect.objectContaining({
    method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
  })]);
});

it("reports unavailable hashing separately from a changed receipt", async () => {
  const denied = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(new Error("Denied"));
  try { expect(await checkRecordedReceipt(receipt)).toBe("unavailable"); }
  finally { denied.mockRestore(); }
});

it("refuses failed or oversized responses without a retry or research fallback", async () => {
  const denied = vi.fn(async () => new Response("Unavailable", { status: 503 }));
  await expect(readRecordedReceipt(new AbortController().signal, denied)).rejects.toThrow("unavailable");
  expect(denied).toHaveBeenCalledTimes(1);
  const oversized = vi.fn(async () => new Response("x".repeat(262_145)));
  await expect(readRecordedReceipt(new AbortController().signal, oversized)).rejects.toThrow("size limit");
  expect(oversized).toHaveBeenCalledTimes(1);
});
