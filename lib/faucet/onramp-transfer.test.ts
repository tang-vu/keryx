import { describe, expect, it, vi } from "vitest";
import { executeOnrampTransfer } from "./onramp-transfer";

describe("executeOnrampTransfer", () => {
  it("distinguishes failure before broadcast from an uncertain receipt after broadcast", async () => {
    const sendError = new Error("wallet unavailable");
    await expect(
      executeOnrampTransfer(
        async () => {
          throw sendError;
        },
        async () => ({ status: "success" }),
      ),
    ).resolves.toEqual({ status: "send-failed", error: sendError });

    const rpcError = new Error("receipt timeout");
    await expect(
      executeOnrampTransfer(
        async () => "0xabc",
        async () => {
          throw rpcError;
        },
      ),
    ).resolves.toEqual({
      status: "pending",
      txHash: "0xabc",
      error: rpcError,
    });
  });

  it("reports confirmed and definitely reverted receipts separately", async () => {
    const send = vi.fn(async () => "0xabc");
    await expect(
      executeOnrampTransfer(send, async () => ({ status: "success" })),
    ).resolves.toEqual({ status: "confirmed", txHash: "0xabc" });
    await expect(
      executeOnrampTransfer(send, async () => ({ status: "reverted" })),
    ).resolves.toEqual({ status: "reverted", txHash: "0xabc" });
  });
});
