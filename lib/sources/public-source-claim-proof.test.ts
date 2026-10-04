import { beforeEach, describe, expect, it, vi } from "vitest";
const { fetchDocument } = vi.hoisted(() => ({ fetchDocument: vi.fn() }));
vi.mock("../net/public-fetch", () => ({ fetchPublicDocument: fetchDocument }));
import { verifyPublicSourceClaimProof, sourceClaimProofToken } from "./public-source-claim-proof";
import { sourceClaimProof, sourceClaimProofUrl, type SourceClaimChallenge } from "./public-source-claim";
const challenge: SourceClaimChallenge = { id: "a".repeat(64), claimId: "b".repeat(64), nonce: "c".repeat(64),
  wallet: "0x1111111111111111111111111111111111111111", canonicalUrl: "https://publisher.example/path",
  rssUrl: "https://publisher.example/rss", network: "eip155:5042002", deploymentOrigin: "https://keryx.cc",
  createdAt: new Date(1000).toISOString(), expiresAt: new Date(901000).toISOString() };
const proofUrl = sourceClaimProofUrl(challenge.canonicalUrl);
beforeEach(() => { fetchDocument.mockReset(); });
describe("dedicated origin-root claim proof", () => {
  it("checks exact bounded JSON with no redirects over the DNS-pinned transport", async () => {
    fetchDocument.mockResolvedValue({ text: JSON.stringify(sourceClaimProof(challenge)), finalUrl: proofUrl, contentType: "application/json" });
    expect(await verifyPublicSourceClaimProof(challenge)).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchDocument).toHaveBeenCalledWith(proofUrl, expect.objectContaining({ maxHops: 0, maxBytes: 16384, httpsOnly: true, timeoutMs: 10000 }));
  });
  it.each(["wallet", "nonce", "network", "deploymentOrigin", "canonicalUrl", "rssUrl", "expiresAt"])("rejects a copied proof with different %s", async field => {
    const proof = { ...sourceClaimProof(challenge), [field]: field === "wallet" ? "0x2222222222222222222222222222222222222222"
      : field === "nonce" ? "d".repeat(64) : field === "network" ? "eip155:1" : field === "expiresAt" ? new Date(500000).toISOString() : "https://other.example/" };
    fetchDocument.mockResolvedValue({ text: JSON.stringify(proof), finalUrl: proofUrl });
    await expect(verifyPublicSourceClaimProof(challenge)).rejects.toThrow("does not match");
  });
  it("rejects redirects, HTML/comment tokens, malformed JSON and injected proof fields", async () => {
    fetchDocument.mockResolvedValue({ text: JSON.stringify(sourceClaimProof(challenge)), finalUrl: "https://redirect.example/proof" });
    await expect(verifyPublicSourceClaimProof(challenge)).rejects.toThrow("redirects");
    for (const text of ["<rss><item>keryx-verify:wallet</item></rss>", "broken", JSON.stringify({ ...sourceClaimProof(challenge), payoutWallet: "attacker" })]) {
      fetchDocument.mockResolvedValue({ text, finalUrl: proofUrl });
      await expect(verifyPublicSourceClaimProof(challenge)).rejects.toThrow("does not match");
    }
    fetchDocument.mockImplementation(async () => { throw new Error("private DNS address"); });
    const unavailable = await verifyPublicSourceClaimProof(challenge).catch(error => error);
    expect(unavailable).toMatchObject({ code: "proof_unavailable", status: 502 });
  });
  it("accepts RSS publisher-channel metadata, never identical item/comment/link tokens", async () => {
    const rssChallenge = { ...challenge, proofMethod: "rss-channel" as const }, token = sourceClaimProofToken(rssChallenge);
    const wrapped = (channel: string) => `<rss version="2.0"><channel><title>Publisher</title>${channel}</channel></rss>`;
    for (const xml of [wrapped(`<description>${token}</description>`), `<rss version="2.0"><channel><title>${token}</title></channel></rss>`,
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Publisher</title><subtitle>${token}</subtitle></feed>`]) {
      fetchDocument.mockResolvedValue({ text: xml, finalUrl: challenge.rssUrl });
      expect(await verifyPublicSourceClaimProof(rssChallenge)).toMatch(/^[a-f0-9]{64}$/);
    }
    for (const xml of [wrapped(`<item><description>${token}</description></item>`), wrapped(`<!-- ${token} -->`),
      wrapped(`<link>https://publisher.example/?${token}</link>`), wrapped(`<item><title>${token}</title></item>`),
      wrapped(`<description>ordinary</description><item><comments>${token}</comments></item>`),
      `<!DOCTYPE rss [<!ENTITY claim "${token}">]>${wrapped("<description>&claim;</description>")}`]) {
      fetchDocument.mockResolvedValue({ text: xml, finalUrl: challenge.rssUrl });
      await expect(verifyPublicSourceClaimProof(rssChallenge)).rejects.toThrow();
    }
    expect(fetchDocument).toHaveBeenCalledWith(challenge.rssUrl, expect.objectContaining({ maxHops: 0, maxBytes: 500000, httpsOnly: true }));
  });
});
