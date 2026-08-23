import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./safe-error-message";

describe("safeErrorMessage", () => {
  it("removes credential-bearing HTTP and websocket URLs while retaining status context", () => {
    const message = safeErrorMessage(
      new Error(
        "HTTP request failed\nStatus: 401\nURL: https://rpc.example/v1/secret-token?key=also-secret\nWS: wss://rpc.example/ws/secret",
      ),
    );
    expect(message).toContain("Status: 401");
    expect(message).toContain("[redacted URL]");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("also-secret");
    expect(message).not.toContain("/ws/secret");
  });

  it("caps unusually large provider messages", () => {
    expect(safeErrorMessage("x".repeat(2_000))).toHaveLength(1_000);
  });
});
