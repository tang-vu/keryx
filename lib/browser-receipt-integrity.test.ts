import { afterEach, describe, expect, it, vi } from "vitest";
import { browserSha256, verifyBrowserReceipt } from "./browser-receipt-integrity";
import { researchReceiptDigest, sha256, verifyResearchReceipt } from "./research-receipt-integrity";
import { verifyBrowserDecisions } from "./a2a/buyer-decisions";
import { readBoundedJson } from "./read-bounded-json";

const id = `a2a_${"a".repeat(64)}`;
const answer = "Cited evidence supports recovery. 🧾";
const decision = { sourceName: "Engineering", action: "BUY", rationale: "Recovery evidence", priceUsdc: 0.002, targets: [0] };
function receipt() {
  const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { id, answer, answerSha256: sha256(answer) }, agency: { decisions: [decision] } };
  return { payload, integrity: { algorithm: "sha256", scope: "payload", canonicalization: "keryx-json-v1", digest: researchReceiptDigest(payload) } };
}
afterEach(() => vi.unstubAllGlobals());

describe("browser receipt integrity", () => {
  it.each(["", "abc", "Unicode: café 🧾", "unpaired surrogate: \ud800", "line\nbreak"])("matches Node UTF-8 SHA-256 for %j", async value => {
    expect(await browserSha256(value)).toBe(sha256(value));
  });

  it("preserves canonicalization when keys are reordered", async () => {
    const original = receipt();
    const reordered = { integrity: original.integrity, payload: {
      agency: original.payload.agency, dispatch: original.payload.dispatch, schema: original.payload.schema,
    } };
    expect(await verifyBrowserReceipt(reordered)).toEqual(verifyResearchReceipt(original));
    expect((await verifyBrowserReceipt(reordered)).valid).toBe(true);
  });

  it("rejects changed content without changing the original digest", async () => {
    const value = receipt(); value.payload.agency.decisions[0].rationale = "Tampered";
    expect(await verifyBrowserReceipt(value)).toEqual(verifyResearchReceipt(value));
    expect((await verifyBrowserReceipt(value)).valid).toBe(false);
  });

  it.each([null, {}, { ...receipt(), extra: true }, { ...receipt(), integrity: { ...receipt().integrity, algorithm: "sha1" } },
    { ...receipt(), payload: { ...receipt().payload, invalid: Infinity } },
    { ...receipt(), payload: { ...receipt().payload, invalid: BigInt(1) } },
  ])("preserves Node envelope refusal for invalid input %#", async value => {
    expect(await verifyBrowserReceipt(value)).toEqual(verifyResearchReceipt(value));
    expect((await verifyBrowserReceipt(value)).valid).toBe(false);
  });

  it("fails closed when Web Crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await verifyBrowserReceipt(receipt())).toMatchObject({ valid: false, reason: "Browser SHA-256 verification is unavailable" });
  });

  it("checks response digest, job, answer and its own hash before projecting decisions", async () => {
    const value = receipt(); const digest = value.integrity.digest;
    await expect(verifyBrowserDecisions(value, digest, id, answer)).resolves.toEqual([decision]);
    await expect(verifyBrowserDecisions(value, null, id, answer)).rejects.toThrow();
    await expect(verifyBrowserDecisions(value, `sha256:${"0".repeat(64)}`, id, answer)).rejects.toThrow();
    await expect(verifyBrowserDecisions(value, digest, `a2a_${"b".repeat(64)}`, answer)).rejects.toThrow();
    await expect(verifyBrowserDecisions(value, digest, id, "Other answer")).rejects.toThrow();
    value.payload.dispatch.answerSha256 = sha256("Wrong");
    value.integrity.digest = researchReceiptDigest(value.payload);
    await expect(verifyBrowserDecisions(value, value.integrity.digest, id, answer)).rejects.toThrow("answer digest");
  });
});

describe("portable bounded JSON decoder", () => {
  it("decodes a UTF-8 codepoint split across streamed chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ text: "🧾" }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    expect(await readBoundedJson(new Response(stream))).toEqual({ text: "🧾" });
  });

  it("cancels oversized input before JSON parsing and rejects invalid JSON", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel });
    await expect(readBoundedJson(new Response(stream))).rejects.toThrow("2 MB");
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readBoundedJson(new Response("not JSON"))).rejects.toThrow();
    await expect(readBoundedJson(new Response(null))).rejects.toThrow("Missing response body");
  });
});
