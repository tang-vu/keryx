import { expect, it } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { browserSessionCustodyContext, LEGACY_SESSION_DERIVATION_MESSAGE } from "./browser-session-custody";
import { privateKeyToAccount } from "viem/accounts";
import { concatHex, keccak256, recoverMessageAddress } from "viem";
it("retains the funded legacy testnet message and gives mainnet separate recoverable custody", async () => {
  const owner=privateKeyToAccount(`0x${"11".repeat(32)}`), origin="https://keryx.cc";
  const legacy=browserSessionCustodyContext(ARC_TESTNET_PROFILE,origin,owner.address),context=browserSessionCustodyContext(ARC_MAINNET_PROFILE,origin,owner.address);
  expect(legacy.derivationMessage).toBe(LEGACY_SESSION_DERIVATION_MESSAGE);
  const signature=await owner.signMessage({message:context.derivationMessage});
  expect((await recoverMessageAddress({message:context.derivationMessage,signature})).toLowerCase()).toBe(context.owner);
  const key=keccak256(concatHex([context.digest,signature]));
  const restored=browserSessionCustodyContext(ARC_MAINNET_PROFILE,origin,owner.address.toLowerCase());
  expect(keccak256(concatHex([restored.digest,await owner.signMessage({message:restored.derivationMessage})]))).toBe(key);
  expect(key).not.toBe(keccak256(await owner.signMessage({message:LEGACY_SESSION_DERIVATION_MESSAGE})));
  expect(context.storageNamespace).not.toBe(legacy.storageNamespace);
  expect(browserSessionCustodyContext(ARC_MAINNET_PROFILE,"https://other.test",owner.address).digest).not.toBe(context.digest);
  expect(()=>browserSessionCustodyContext(ARC_MAINNET_PROFILE,"http://localhost:3939",owner.address)).toThrow();
});
