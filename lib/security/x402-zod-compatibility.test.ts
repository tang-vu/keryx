import { expect, it } from "vitest";
import { createRequire } from "node:module";
import * as schemas from "@x402/core/schemas";

const require = createRequire(import.meta.url);
const cjs = require("@x402/core/schemas") as typeof schemas;
const nested = require(require.resolve("@x402/core/schemas", { paths: [require.resolve("@x402/evm")] })) as typeof schemas;
const requirement = { scheme: "exact", network: "eip155:5042", amount: "2000", asset: `0x${"11".repeat(20)}`,
  payTo: `0x${"22".repeat(20)}`, maxTimeoutSeconds: 300, extra: { name: "GatewayWalletBatched", version: "1" } };

for (const [name, runtime] of [["ESM", schemas], ["CJS", cjs], ["nested EVM core", nested]] as const) {
  it(`${name} preserves nonempty x402 metadata and rejects malformed requirements`, () => {
    const challenge = { x402Version: 2, resource: { url: "https://synthetic.invalid/read" }, accepts: [requirement], extensions: { fixture: { enabled: true } } };
    const payload = { x402Version: 2, accepted: requirement, payload: { signature: "synthetic-no-payment", authorization: { value: "2000" } }, extensions: { fixture: true } };
    expect(runtime.validatePaymentRequired(challenge)).toEqual(challenge);
    expect(runtime.validatePaymentPayload(payload)).toEqual(payload);
    expect(runtime.parsePaymentRequired({ ...challenge, accepts: [{ ...requirement, maxTimeoutSeconds: -1 }] }).success).toBe(false);
    expect(runtime.parsePaymentRequired({ ...challenge, accepts: [{ ...requirement, amount: "" }] }).success).toBe(false);
  });
}

it("retains the actual legacy Circle adapter function schemas", async () => {
  const sdk = await import("@circle-fin/adapter-viem-v2");
  const adapter = await sdk.createViemAdapterFromProvider({ provider: { request: async () => { throw new Error("Synthetic provider must remain lazy"); } } });
  expect(adapter).toBeDefined();
  await expect(sdk.createViemAdapterFromProvider({ provider: { request: 1 } } as never)).rejects.toThrow();
});
