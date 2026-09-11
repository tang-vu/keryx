import { expect, it } from "vitest";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { withdrawalRelayRuntime } from "./withdrawal-relay-runtime";

function fixture() {
  const relay = generatePrivateKey(), funder = generatePrivateKey();
  return { KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: resolve("synthetic-relay"), KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: relay,
    KERYX_WITHDRAWAL_RELAY_ADDRESS: privateKeyToAccount(relay).address, AGENT_FUNDER_PRIVATE_KEY: funder };
}
it("defaults to disabled without inspecting keys or enabling a network", () => {
  expect(withdrawalRelayRuntime({}, "eip155:1")).toBeNull();
  expect(withdrawalRelayRuntime({ KERYX_WITHDRAWAL_RELAY_ENABLED: "0", KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY: "invalid" }, "eip155:1")).toBeNull();
});
it("binds the relay to the actual key and derives a distinct configured signer inventory", () => {
  const env = fixture(), runtime = withdrawalRelayRuntime(env, "eip155:5042002")!;
  expect(runtime.signer.address).toBe(env.KERYX_WITHDRAWAL_RELAY_ADDRESS);
  expect(runtime.otherSigners).toEqual([privateKeyToAccount(env.AGENT_FUNDER_PRIVATE_KEY).address.toLowerCase()]);
});
it("refuses reused keys across current or additional loaded roles", () => {
  const env = fixture();
  for (const name of ["AGENT_FUNDER_PRIVATE_KEY", "BUYER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "KERYX_RETIRED_PRIVATE_KEY"])
    expect(() => withdrawalRelayRuntime({ ...env, [name]: env.KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY }, "eip155:5042002")).toThrow("runtime unavailable");
});
it("requires complete active private-treasury configuration and valid additional keys", () => {
  const env = fixture();
  expect(() => withdrawalRelayRuntime({ ...env, KERYX_PRIVATE_RESEARCH_ENABLED: "1" }, "eip155:5042002")).toThrow("runtime unavailable");
  expect(() => withdrawalRelayRuntime({ ...env, OTHER_PRIVATE_KEY: "secret malformed key" }, "eip155:5042002")).toThrow("runtime unavailable");
  expect(withdrawalRelayRuntime({ ...env, KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_TREASURY_PRIVATE_KEY: generatePrivateKey() }, "eip155:5042002")?.otherSigners).toHaveLength(2);
});
it("rejects unsupported network, ambiguous enablement, missing isolation or mismatched address/path", () => {
  const env = fixture();
  expect(() => withdrawalRelayRuntime(env, "eip155:1")).toThrow("runtime unavailable");
  for (const changes of [{ KERYX_WITHDRAWAL_RELAY_ENABLED: "true" }, { KERYX_WITHDRAWAL_RELAY_ISOLATED: "0" },
    { KERYX_WITHDRAWAL_RELAY_DIRECTORY: "relative" }, { AGENT_FUNDER_PRIVATE_KEY: "" },
    { KERYX_WITHDRAWAL_RELAY_ADDRESS: `0x${"00".repeat(20)}` }, { SELLER_ADDRESS: env.KERYX_WITHDRAWAL_RELAY_ADDRESS }])
    expect(() => withdrawalRelayRuntime({ ...env, ...changes }, "eip155:5042002")).toThrow("runtime unavailable");
});
