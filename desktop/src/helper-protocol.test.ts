import { describe, expect, it } from "vitest";
import { PrivateTextExportError } from "../../lib/operator/private-text-export";
import { boundErrorMessage, encodeResponseFrame, MAX_ERROR_BYTES, MAX_REQUEST_FRAME, MAX_RESPONSE_FRAME,
  parseRequestFrame } from "./helper-protocol";

function request(id: number, action = "refresh", payload = "{}") {
  return Buffer.from(JSON.stringify({ id, action, payload }));
}

describe("desktop helper framing", () => {
  it("requires monotonic single-flight IDs and a known operation", () => {
    expect(parseRequestFrame(request(1), 0)).toEqual({ id: 1, action: "refresh", payload: "{}" });
    expect(() => parseRequestFrame(request(1), 1)).toThrow("Invalid request envelope");
    expect(() => parseRequestFrame(request(3), 1)).toThrow("Invalid request envelope");
    expect(() => parseRequestFrame(request(2, "run_shell"), 1)).toThrow("Invalid request envelope");
  });

  it("refuses oversized or malformed UTF-8 frames before an operation", () => {
    expect(() => parseRequestFrame(Buffer.alloc(MAX_REQUEST_FRAME + 1, 65), 0)).toThrow("Invalid request frame");
    expect(() => parseRequestFrame(Buffer.from([0xff]), 0)).toThrow();
    expect(() => parseRequestFrame(Buffer.from(JSON.stringify({ id: 1, action: "refresh", payload: "{}", path: "C:\\secret" })), 0))
      .toThrow("Invalid request envelope");
  });

  it("keeps lone-surrogate domain JSON opaque in its result string", () => {
    const answer = JSON.stringify({ answer: "\ud800" });
    const frame = encodeResponseFrame({ id: 1, ok: true, result: answer });
    const decoded = JSON.parse(frame.toString("utf8"));
    expect(JSON.parse(decoded.result).answer).toBe("\ud800");
    expect(() => encodeResponseFrame({ id: 1, ok: true, result: "x".repeat(MAX_RESPONSE_FRAME) })).toThrow();
  });

  it("bounds error strings by UTF-8 bytes, keeping the leading state on multibyte text", () => {
    const lead = "Workspace was created, but the selection could not be saved. " +
      "Do not create a replacement yet; reopen the created folder at ";
    const message = lead + "界".repeat(1200);
    const bound = boundErrorMessage(message);
    expect(bound).toBe(lead + "界".repeat(Math.floor((MAX_ERROR_BYTES - Buffer.byteLength(lead)) / 3)));
    expect(Buffer.byteLength(bound, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
    expect(bound.startsWith(lead)).toBe(true);
    const frame = encodeResponseFrame({ id: 1, ok: false, error: bound });
    expect(Buffer.byteLength(JSON.parse(frame.toString("utf8")).error, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
  });

  it("never splits a surrogate pair at the byte boundary", () => {
    const bound = boundErrorMessage("a".repeat(MAX_ERROR_BYTES - 1) + "📁");
    expect(bound).toBe("a".repeat(MAX_ERROR_BYTES - 1));
    expect(boundErrorMessage("a".repeat(MAX_ERROR_BYTES - 4) + "📁")).toBe("a".repeat(MAX_ERROR_BYTES - 4) + "📁");
  });

  it("never splits a two-byte character at the byte boundary", () => {
    const bound = boundErrorMessage("a".repeat(MAX_ERROR_BYTES - 1) + "é");
    expect(bound).toBe("a".repeat(MAX_ERROR_BYTES - 1));
    const exact = "a".repeat(MAX_ERROR_BYTES - 2) + "é";
    expect(Buffer.byteLength(exact, "utf8")).toBe(MAX_ERROR_BYTES);
    expect(boundErrorMessage(exact)).toBe(exact);
  });

  it("retains an exact 2048-byte ASCII prefix ahead of multibyte text", () => {
    const prefix = "x".repeat(MAX_ERROR_BYTES);
    const bound = boundErrorMessage(prefix + "界".repeat(10));
    expect(bound).toBe(prefix);
    expect(Buffer.byteLength(bound, "utf8")).toBe(MAX_ERROR_BYTES);
  });

  it("bounds a realistic long-path operation error on the wire, keeping the recovery instruction", () => {
    const instruction = "Creation could not be confirmed. Do not retry at the same location; keep this path for inspection: ";
    const message = instruction + "D:\\资料\\Keryx\\" + "研究报告-草稿-✓\\".repeat(200);
    const bound = boundErrorMessage(message);
    expect(bound).toContain("Creation could not be confirmed");
    expect(bound).toContain("Do not retry at the same location");
    expect(bound).toContain("for inspection");
    expect(message.startsWith(bound)).toBe(true);
    const wire = JSON.parse(encodeResponseFrame({ id: 1, ok: false, error: bound }).toString("utf8"));
    expect(wire.error).toBe(bound);
    expect(Buffer.byteLength(wire.error, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
  });

  it("keeps export recovery instructions when a long multi-byte path fills the bound", () => {
    const parent = "D:\\资料\\Keryx\\" + "研究报告-草稿-✓\\".repeat(200);
    const error = new PrivateTextExportError("published", "remove staging file",
      `${parent}brief.md`, `${parent}.keryx-brief-0123456789abcdef.tmp`, true, new Error("injected cleanup failure"));
    const bound = boundErrorMessage(error.message);
    expect(bound).toContain("complete final file was published; staging cleanup failed");
    expect(bound).toContain("Inspect and remove the owned staging file");
    const wire = JSON.parse(encodeResponseFrame({ id: 1, ok: false, error: bound }).toString("utf8"));
    expect(wire.error).toBe(bound);
    expect(Buffer.byteLength(wire.error, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
  });

  it("keeps the wire error valid when the message holds a lone surrogate", () => {
    const bound = boundErrorMessage("Private export broke \ud800 midway");
    expect(bound).toBe("Private export broke \ufffd midway");
    const wire = JSON.parse(encodeResponseFrame({ id: 1, ok: false, error: bound }).toString("utf8"));
    expect(wire.error).toBe("Private export broke \ufffd midway");
    expect(wire.error).not.toContain("\ud800");
  });
});
