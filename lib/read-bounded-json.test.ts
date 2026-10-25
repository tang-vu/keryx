import { describe, expect, it, vi } from "vitest";
import { readBoundedJson } from "./read-bounded-json";
import { researchReceiptDigest } from "./research-receipt-integrity";
import { verifyBrowserReceipt } from "./browser-receipt-integrity";

const encode = (text: string) => new TextEncoder().encode(text);
const quotedBytes = (bytes: number[]) => Uint8Array.from([...encode('{"text":"'), ...bytes, ...encode('"}')]);

describe("bounded JSON transport byte integrity", () => {
  it.each([
    ["lone continuation", [0x80]],
    ["overlong slash", [0xc0, 0xaf]],
    ["unfinished multibyte sequence", [0xe2, 0x82]],
    ["UTF-8 encoded surrogate", [0xed, 0xa0, 0x80]],
    ["codepoint above Unicode maximum", [0xf4, 0x90, 0x80, 0x80]],
  ])("refuses %s instead of manufacturing replacement characters", async (_name, bytes) => {
    await expect(readBoundedJson(new Response(quotedBytes(bytes as number[])))).rejects.toThrow();
  });

  it("does not let corrupted transport bytes match a checksum of repaired receipt text", async () => {
    const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { answer: "before\ufffdafter" } };
    const receipt = { payload, integrity: { algorithm: "sha256", scope: "payload", canonicalization: "keryx-json-v1",
      digest: researchReceiptDigest(payload) } };
    const serialized = JSON.stringify(receipt);
    const valid = encode(serialized), marker = encode("before");
    const replacement = valid.findIndex((_, index) => marker.every((byte, offset) => valid[index + offset] === byte)) + marker.length;
    const corrupted = Uint8Array.from([...valid.slice(0, replacement), 0xff, ...valid.slice(replacement + 3)]);
    // The old replacement-mode decoder accepted these bytes as the signed value.
    expect((await verifyBrowserReceipt(JSON.parse(new TextDecoder().decode(corrupted)))).valid).toBe(true);
    await expect(readBoundedJson(new Response(corrupted))).rejects.toThrow();
    expect((await verifyBrowserReceipt(await readBoundedJson(new Response(valid)))).valid).toBe(true);
  });

  it("preserves valid Unicode including a real replacement character at the exact byte limit", async () => {
    const input = { text: "Tiếng Việt café 🧾 \ufffd" }, bytes = encode(JSON.stringify(input));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    expect(await readBoundedJson(new Response(stream), bytes.length)).toEqual(input);
    await expect(readBoundedJson(new Response(bytes), bytes.length - 1)).rejects.toThrow("Response exceeds size limit");
  });

  it("retains the existing refusal of a leading BOM and does not strip an in-string BOM", async () => {
    await expect(readBoundedJson(new Response(Uint8Array.from([0xef, 0xbb, 0xbf, ...encode("{}")])))).rejects.toThrow();
    expect(await readBoundedJson(new Response(JSON.stringify({ text: "\ufeffinside" })))).toEqual({ text: "\ufeffinside" });
  });

  it("releases the reader after invalid UTF-8 and propagates upstream read failures", async () => {
    const invalid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(quotedBytes([0xff])); controller.close(); } });
    await expect(readBoundedJson(new Response(invalid))).rejects.toThrow();
    expect(invalid.locked).toBe(false);
    const upstream = new Error("upstream read failed");
    const failed = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(upstream); } });
    await expect(readBoundedJson(new Response(failed))).rejects.toBe(upstream);
    expect(failed.locked).toBe(false);
  });

  it("cancels an oversize open stream without masking the size error when cancellation fails", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode('{"private":"oversize"}')); }, cancel });
    await expect(readBoundedJson(new Response(stream), 4)).rejects.toThrow("Response exceeds size limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
