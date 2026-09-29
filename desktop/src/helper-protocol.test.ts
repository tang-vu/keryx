import { describe, expect, it } from "vitest";
import { encodeResponseFrame, MAX_REQUEST_FRAME, MAX_RESPONSE_FRAME, parseRequestFrame } from "./helper-protocol";

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
});
