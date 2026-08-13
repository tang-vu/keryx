import { describe, expect, it } from "vitest";
import { classifyArcRpcProvider } from "./public-proof";

describe("classifyArcRpcProvider", () => {
  it("recognizes the tokenized Canteen endpoint without returning its secret path", () => {
    const token = "redacted-server-token";
    const label = classifyArcRpcProvider(
      `https://rpc.testnet.arc-node.thecanteenapp.com/v1/${token}`,
    );

    expect(label).toBe("Canteen Arc RPC");
    expect(label).not.toContain(token);
    expect(label).not.toContain("/v1/");
  });

  it("recognizes Arc's public endpoint", () => {
    expect(classifyArcRpcProvider("https://rpc.testnet.arc.network")).toBe("Arc public RPC");
  });

  it("labels other and malformed endpoints without reflecting their contents", () => {
    expect(classifyArcRpcProvider("https://rpc.example.com/private/key")).toBe("Custom Arc RPC");
    expect(classifyArcRpcProvider("not a URL with a secret")).toBe("Custom Arc RPC");
  });
});
