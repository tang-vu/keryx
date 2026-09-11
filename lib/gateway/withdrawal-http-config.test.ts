import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolve } from "node:path";
import { withdrawalHttpConfiguration } from "./withdrawal-http-config";
const chain = { networkId: "eip155:5042002", rpcUrl: "https://rpc.synthetic.invalid", cctpDomain: 26,
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  usdcAddress: "0x3600000000000000000000000000000000000000" };
function fixture(): Record<string, string> {
  const key = generatePrivateKey();
  return { KERYX_WITHDRAWAL_HTTP_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: key, KERYX_WITHDRAWAL_RELAY_ADDRESS: privateKeyToAccount(key).address,
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: resolve("synthetic-unused-relay"), AGENT_FUNDER_PRIVATE_KEY: generatePrivateKey(),
    KERYX_WITHDRAWAL_MAX_VALUE_MICROS: "50000", KERYX_WITHDRAWAL_MAX_FEE_MICROS: "2010000", KERYX_WITHDRAWAL_GAS_CEILING_WEI: "600000000000000",
    KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: "2000", KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS: "10" };
}
it("requires explicit HTTP opt-in without treating relay enablement as public admission", () => {
  expect(withdrawalHttpConfiguration({}, chain)).toBeNull();
  const env = fixture(); env.KERYX_WITHDRAWAL_HTTP_ENABLED = "0";
  expect(withdrawalHttpConfiguration(env, chain)).toBeNull();
});
it("snapshots exact integer limits and allows a zero vendor fee cap", () => {
  const env = fixture(); env.KERYX_WITHDRAWAL_MAX_FEE_MICROS = "0";
  const config = withdrawalHttpConfiguration(env, chain)!;
  env.KERYX_WITHDRAWAL_MAX_VALUE_MICROS = "999";
  expect(config.limits).toMatchObject({ maxValueMicros: "50000", maxFeeMicros: "0", domain: 26 });
  expect(config.env.KERYX_WITHDRAWAL_MAX_VALUE_MICROS).toBe("50000");
});
it("denies missing/fractional/overflow caps, reused keys, offline mode and other networks", () => {
  const env = fixture();
  for (const value of ["", "01", "1.5", "1e6", "-1", "9".repeat(79)])
    expect(() => withdrawalHttpConfiguration({ ...env, KERYX_WITHDRAWAL_MAX_VALUE_MICROS: value }, chain)).toThrow();
  for (const delta of [{ KERYX_WITHDRAWAL_GAS_CEILING_WEI: "0" }, { KERYX_WITHDRAWAL_RELAY_ENABLED: "0" },
    { KERYX_FORCE_OFFLINE: "1" }, { AGENT_FUNDER_PRIVATE_KEY: env.KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY }])
    expect(() => withdrawalHttpConfiguration({ ...env, ...delta }, chain)).toThrow();
  for (const delta of [{ networkId: "eip155:1" }, { cctpDomain: 1 }, { rpcUrl: "https://user:secret@rpc.invalid" }])
    expect(() => withdrawalHttpConfiguration(env, { ...chain, ...delta })).toThrow();
});
