import { afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each(["arc", "arcTestnet"])("binds creator offer/content proofs to the independently selected %s deployment", async network => {
  vi.resetModules(); vi.stubEnv("KERYX_NETWORK", network); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", network);
  const { articleOfferTypedData } = await import("./article-offer-proof");
  const { articleContentManifestTypedData } = await import("../sources/article-content-manifest-schema");
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`), chainId = network === "arc" ? 5042 : 5042002;
  const offer = articleOfferTypedData({ sourceId: "source", itemId: "one", contentVersion: `sha256:${"22".repeat(32)}`,
    priceUsdc6: 2000, expiresAt: 1800000000, nonce: `0x${"33".repeat(32)}` });
  const content = articleContentManifestTypedData({ sourceId: "source", itemId: "one", canonicalUrl: "https://source.example/one",
    bodyHash: `0x${"44".repeat(32)}`, plaintextBytes: 500, deliveryKind: "full_text", nonce: `0x${"55".repeat(32)}` });
  for (const typed of [offer, content]) {
    expect(typed.domain.chainId).toBe(chainId);
    const signature = await signer.signTypedData(typed as Parameters<typeof signer.signTypedData>[0]);
    expect(await recoverTypedDataAddress({ ...typed, signature } as Parameters<typeof recoverTypedDataAddress>[0])).toBe(signer.address);
    expect(await recoverTypedDataAddress({ ...typed, domain: { ...typed.domain, chainId: chainId === 5042 ? 5042002 : 5042 }, signature } as Parameters<typeof recoverTypedDataAddress>[0])).not.toBe(signer.address);
  }
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", network === "arc" ? "arcTestnet" : "arc");
  expect(articleOfferTypedData({ sourceId: "source", itemId: "one", contentVersion: "version", priceUsdc6: 2000,
    expiresAt: 1800000000, nonce: `0x${"33".repeat(32)}` }).domain.chainId).toBe(chainId);
});
