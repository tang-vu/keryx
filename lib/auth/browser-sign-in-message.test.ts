import { describe, expect, it } from "vitest";
import { SiweMessage } from "siwe";
import { privateKeyToAccount } from "viem/accounts";
import { prepareBrowserSignInMessage } from "./browser-sign-in-message";

// Deterministic fixture only; signatures are generated and verified offline.
const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
const fixture = {
  domain: "keryx.cc", uri: "https://keryx.cc", address: account.address,
  chainId: 5042, nonce: "0123456789abcdef", issuedAt: "2026-10-28T00:00:00.000Z",
  expirationTime: "2026-11-04T00:00:00.000Z",
};
const original = (fields: typeof fixture) => new SiweMessage({
  ...fields, statement: "Sign in to Keryx. Citations are currency.", version: "1",
}).prepareMessage();

describe("deferred browser sign-in serializer", () => {
  for (const chainId of [5042, 5042002]) {
    for (const origin of ["https://keryx.cc", "http://localhost:3939", "http://127.0.0.1:3939", "http://[::1]:3939"]) {
      for (const address of [account.address, `0x${"11".repeat(20)}` as const]) {
        it(`retains signed bytes for ${origin}, chain ${chainId}, wallet ${address}`, () => {
          const url = new URL(origin), fields = { ...fixture, domain: url.host, uri: url.origin, chainId, address };
          const message = prepareBrowserSignInMessage(fields);
          expect(message).toBe(original(fields));
          const parsed = new SiweMessage(message);
          expect(parsed.domain).toBe(url.host); expect(parsed.uri).toBe(url.origin);
          expect(parsed.chainId).toBe(chainId); expect(parsed.nonce).toBe(fixture.nonce);
          expect(parsed.issuedAt).toBe(fixture.issuedAt); expect(parsed.expirationTime).toBe(fixture.expirationTime);
        });
      }
    }
  }

  it.each([
    { nonce: "bad-nonce" }, { address: "0xinvalid" }, { issuedAt: "invalid time" },
  ])("retains the original refusal for malformed fields %j", invalid => {
    const fields = { ...fixture, ...invalid } as typeof fixture;
    expect(() => original(fields)).toThrow();
    expect(() => prepareBrowserSignInMessage(fields)).toThrow();
  });

  it("verifies an actual offline EOA signature with the unchanged server library", async () => {
    const message = prepareBrowserSignInMessage(fixture);
    const signature = await account.signMessage({ message });
    const result = await new SiweMessage(message).verify({ signature, domain: fixture.domain,
      nonce: fixture.nonce, time: "2026-10-28T00:00:01.000Z" });
    expect(result.success).toBe(true); expect(result.data.address).toBe(account.address);
    for (const wrong of [{ domain: "other.example" }, { nonce: "anothernonce" }]) {
      await expect(new SiweMessage(message).verify({ signature, domain: fixture.domain,
        nonce: fixture.nonce, time: "2026-10-28T00:00:01.000Z", ...wrong })).rejects.toBeDefined();
    }
    await expect(new SiweMessage(message).verify({ signature, domain: fixture.domain,
      nonce: fixture.nonce, time: "2026-11-05T00:00:00.000Z" })).rejects.toBeDefined();
  });
});
