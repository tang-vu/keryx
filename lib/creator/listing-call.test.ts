import { expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "../registry/registry-abi";
import { listingDeactivateCall, listingPriceCall, listingUpdateCall } from "./listing-call";
const value = { mode: "onchain", active: true, fetchPrice: 0.002,
  registryAddress: `0x${"a".repeat(40)}`, onchainId: `0x${"1".repeat(64)}`, creator: `0x${"b".repeat(40)}`,
  current: { payoutWallet: `0x${"c".repeat(40)}`, authors: [{ wallet: `0x${"c".repeat(40)}`, basisPoints: 10000 }], fetchPriceUsdc6: "2000", contentCid: "cid", tags: "research" } };

it("retains reviewed V1 full-record price updates and legacy delisting", () => {
  const price = listingPriceCall(value, BigInt(3000));
  if (price.functionName !== "update") throw new Error("Expected V1 full-record price update");
  expect(decodeFunctionData({ abi: REGISTRY_ABI, data: encodeFunctionData(price) }).functionName).toBe("update");
  expect(price.args).toEqual([value.onchainId, value.current.payoutWallet, value.current.authors, BigInt(3000), "cid", "research"]);
  expect(listingDeactivateCall(value).args).toEqual([value.onchainId]);
});

it.each([2, 3])("encodes only price plus exact uint64 revision for V%s", registryVersion => {
  const fresh = { ...value, registryVersion, revision: "9007199254740993" };
  const price = listingPriceCall(fresh, BigInt(3000));
  if (price.functionName !== "updatePrice") throw new Error("Expected revisioned price update");
  const decoded = decodeFunctionData({ abi: REVISIONED_REGISTRY_ABI, data: encodeFunctionData(price) });
  expect(decoded.functionName).toBe("updatePrice");
  expect(decoded.args).toEqual([value.onchainId, BigInt("9007199254740993"), BigInt(3000)]);
  expect(listingUpdateCall(fresh).args).toEqual([value.onchainId, BigInt("9007199254740993"), value.current.payoutWallet,
    value.current.authors, BigInt(2000), "cid", "research"]);
  expect(listingDeactivateCall(fresh).args).toEqual([value.onchainId, BigInt("9007199254740993")]);
});

it("never emits unchecked edits for a V3 snapshot lacking revision authority", () => {
  for (const revision of [undefined, "0", "01", "18446744073709551616"]) {
    for (const call of [listingDeactivateCall, listingUpdateCall, (snapshot: unknown) => listingPriceCall(snapshot, BigInt(3000))]) {
      expect(() => call({ ...value, registryVersion: 3, revision })).toThrow("Listing data is unavailable");
    }
  }
});

it("contains no legacy unchecked selectors in the revisioned ABI", () => {
  for (const name of ["update", "updatePrice", "deactivate"]) {
    const entry = REVISIONED_REGISTRY_ABI.find(item => item.type === "function" && item.name === name);
    expect(entry?.type).toBe("function");
    if (entry?.type !== "function") throw new Error("Missing revisioned mutation");
    expect(entry.inputs[1]).toEqual({ name: "expectedRevision", type: "uint64" });
  }
});
