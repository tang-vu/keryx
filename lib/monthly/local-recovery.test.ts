import { expect, it } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { monthlyStorageKeys } from "./local-recovery";
const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`, id = `monthly_${"c".repeat(64)}`;
it("preserves exact historical testnet locations and requires an owner for mainnet lookup", () => {
  expect(monthlyStorageKeys(ARC_TESTNET_PROFILE)?.intent(id)).toBe(`keryx.monthly.intent.${id}`);
  expect(monthlyStorageKeys(ARC_TESTNET_PROFILE)?.request).toBe("keryx.monthly.request");
  expect(monthlyStorageKeys(ARC_MAINNET_PROFILE)).toBeNull();
});
it("mainnet state cannot collide with testnet or another payer", () => {
  const main = monthlyStorageKeys(ARC_MAINNET_PROFILE, owner)!;
  expect(main.intent(id)).not.toBe(monthlyStorageKeys(ARC_TESTNET_PROFILE, owner)?.intent(id));
  expect(main.intent(id)).not.toBe(monthlyStorageKeys(ARC_MAINNET_PROFILE, other)?.intent(id));
  expect(main.request).toContain(ARC_MAINNET_PROFILE.networkId);
  expect(main.last).toBe(monthlyStorageKeys(ARC_MAINNET_PROFILE, owner.toUpperCase().replace("0X", "0x"))?.last);
});
