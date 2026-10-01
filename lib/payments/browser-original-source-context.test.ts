import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  articleOfferId,
  articleOfferTypedData,
} from "../offers/article-offer-proof";
import {
  browserSourceRegistryId,
  browserSourceContextDigest,
  verifyRetainedBrowserOriginalSourceContext,
  type BrowserOriginalSourceContext,
} from "./browser-original-source-context";
import {
  browserSigningOriginalV3Schema,
  browserSigningTypedData,
  serializeBrowserSigningHeader,
  verifyBrowserSigningHeader,
} from "./browser-signing-original";
import { SESSION_GATEWAY } from "../session/session-signing-policy";

const creator = privateKeyToAccount(generatePrivateKey());
const signer = privateKeyToAccount(generatePrivateKey());
const payee = "0x2222222222222222222222222222222222222222";
const admittedAt = new Date().toISOString();
const seconds = Math.floor(Date.parse(admittedAt) / 1000);
async function fixture(list: string, price: number) {
  const terms = {
    sourceId: "source",
    itemId: "item",
    contentVersion: "version",
    priceUsdc6: price,
    expiresAt: seconds + 600,
    nonce: `0x${"44".repeat(32)}` as `0x${string}`,
  };
  const signature = await creator.signTypedData(articleOfferTypedData(terms));
  const context: BrowserOriginalSourceContext = {
    version: "source-context-v1",
    service: "https://keryx.cc",
    kind: "fetch",
    source: {
      sourceId: "source",
      canonicalUrl: "https://source.example/",
      registryId: browserSourceRegistryId(
        creator.address,
        "https://source.example/"
      ),
    },
    item: { itemId: "item", contentVersion: "version" },
    endpoint: {
      method: "GET",
      path: `/api/source/source/item/item?version=version&offer=${articleOfferId(
        signature
      )}&listPriceUsdc6=${list}`,
    },
    registry: {
      network: "eip155:5042002",
      contract: payee,
      blockNumber: "1",
      blockHash: `0x${"55".repeat(32)}`,
      blockTimestamp: String(seconds),
      creator: creator.address.toLowerCase(),
      payoutWallet: payee,
      listPriceMicros: list,
      active: true,
    },
    price: {
      mode: "creator-offer",
      amountMicros: String(price),
      offer: {
        ...terms,
        id: articleOfferId(signature),
        signature,
        signer: creator.address.toLowerCase(),
        createdAt: admittedAt,
      },
    },
  };
  // Pure proof boundaries use a schema-valid synthetic original, not a fabricated DB admission.
  const bare = {
    protocol: "durable-v3" as const,
    admittedAt,
    namespace: `0x${"77".repeat(32)}`,
    queryId: crypto.randomUUID(),
    requestId: "request",
    grantEpoch: crypto.randomUUID(),
    domain: {
      name: "GatewayWalletBatched" as const,
      version: "1" as const,
      chainId: 5042002 as const,
      verifyingContract: SESSION_GATEWAY.toLowerCase(),
    },
    authorization: {
      nonce: `0x${"66".repeat(32)}`,
      from: signer.address.toLowerCase(),
      to: payee,
      value: String(price),
      validAfter: String(seconds - 600),
      validBefore: String(seconds + 691200),
    },
  };
  const original = browserSigningOriginalV3Schema.parse({
    ...bare,
    sourceContext: context,
    sourceContextDigest: browserSourceContextDigest(bare, context),
  });
  return { context, original };
}
it("rejects a real creator signature one micro above a high safe-integer ceiling despite float roundup", async () => {
  const f = await fixture("9007199254740989", 9007199254740990);
  expect(
    Math.round((Number(f.context.registry.listPriceMicros) / 1e6) * 1e6)
  ).toBe(9007199254740990);
  await expect(
    verifyRetainedBrowserOriginalSourceContext(f.context, f.original)
  ).rejects.toThrow("refused");
});
it("accepts an exact equal-price creator signature despite legacy float rounddown", async () => {
  const f = await fixture("9007199254740809", 9007199254740809);
  expect(
    Math.round((Number(f.context.registry.listPriceMicros) / 1e6) * 1e6)
  ).toBe(9007199254740808);
  const retained = await verifyRetainedBrowserOriginalSourceContext(
    f.context,
    f.original
  );
  expect(Object.isFrozen(retained.registry)).toBe(true);
  expect(retained.price.amountMicros).toBe("9007199254740809");
});
it("keeps Gateway header bytes unchanged and rejects a changed retained context before callback metadata", async () => {
  const f = await fixture("1000", 100);
  const signature = await signer.signTypedData(
    browserSigningTypedData(f.original)
  );
  const header = serializeBrowserSigningHeader(f.original, signature);
  expect(Object.keys(JSON.parse(atob(header))).sort()).toEqual([
    "authorization",
    "signature",
  ]);
  expect(await verifyBrowserSigningHeader(f.original, header)).toHaveProperty(
    "headerHash"
  );
  f.original.sourceContext.registry.blockNumber = "2";
  await expect(verifyBrowserSigningHeader(f.original, header)).rejects.toThrow(
    "refused"
  );
});
