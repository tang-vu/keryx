import { describe, expect, it } from "vitest";
import { flowChallenge, identityCookieValue, identityContinuationCookie, identityContinuationCookieName, identityProviderConfiguration, newIdentityFlow, readIdentityContinuation, readIdentityFlow, sealIdentityContinuation, sealIdentityFlow, stateMatches, uniqueIdentityCookieValue } from "./identity-flow";
import { identitySnapshotSchema, providerIdentitySchema, validOrcid } from "./verified-identities";
const wallet = `0x${"a".repeat(40)}`, sessionHash = "b".repeat(64), secret = "c".repeat(48), now = Date.parse("2026-10-09T06:00:00.000Z");
describe("private identity state and data boundary", () => {
  it.each(["github", "orcid"] as const)("%s continuation is encrypted, domain-separated, short-lived and bound to exact original flow", async provider => {
    const { flow } = newIdentityFlow(wallet, sessionHash, provider, now), flowToken = await sealIdentityFlow(flow, secret, now);
    const token = await sealIdentityContinuation(flow, flowToken, { denied: false, code: "private-code" }, secret, now);
    expect(token.length).toBeLessThan(4096); expect(token).not.toContain("private-code"); expect(token).not.toContain(wallet);
    expect(await readIdentityFlow(token, secret, now)).toBeNull();
    expect(await readIdentityContinuation(flowToken, flow, flowToken, secret, now)).toBeNull();
    expect(await readIdentityContinuation(token, flow, flowToken, secret, now + 1000)).toMatchObject({ provider, denied: false, code: "private-code" });
    for (const candidate of [undefined, "invalid", token.slice(0, -8) + "tampered", "x".repeat(4097)])
      expect(await readIdentityContinuation(candidate, flow, flowToken, secret, now)).toBeNull();
    expect(await readIdentityContinuation(token, flow, flowToken, "d".repeat(48), now)).toBeNull();
    expect(await readIdentityContinuation(token, flow, flowToken, secret, now - 1000)).toBeNull();
    expect(await readIdentityContinuation(token, flow, flowToken, secret, now + 60000)).toBeNull();
    const other = newIdentityFlow(wallet, sessionHash, provider, now), otherToken = await sealIdentityFlow(other.flow, secret, now);
    expect(await readIdentityContinuation(token, other.flow, otherToken, secret, now)).toBeNull();
    expect(await readIdentityContinuation(token, { ...flow, provider: provider === "github" ? "orcid" : "github" }, flowToken, secret, now)).toBeNull();
    const denial = await sealIdentityContinuation(flow, flowToken, { denied: true }, secret, now);
    expect(await readIdentityContinuation(denial, flow, flowToken, secret, now)).toMatchObject({ denied: true });
    for (const input of [{ denied: true, code: "code" }, { denied: false }, { denied: false, code: "x".repeat(2049) }, { denied: false, code: "code\n" }])
      await expect(sealIdentityContinuation(flow, flowToken, input, secret, now)).rejects.toThrow();
    await expect(sealIdentityContinuation(flow, flowToken, { denied: true }, "weak", now)).rejects.toThrow();
    const late = now + 280000, capped = await sealIdentityContinuation(flow, flowToken, { denied: true }, secret, late);
    expect((await readIdentityContinuation(capped, flow, flowToken, secret, late))?.expiresAt).toBe(flow.expiresAt);
    expect(await readIdentityContinuation(capped, flow, flowToken, secret, now + 300000)).toBeNull();
    const cookie = identityContinuationCookie(provider, token);
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax; Max-Age=60"); expect(cookie).not.toContain("Domain=");
    expect(identityContinuationCookie(provider)).toContain("Max-Age=0");
    const pair = cookie.split(";")[0];
    expect(uniqueIdentityCookieValue(new Request("https://keryx.cc", { headers: { Cookie: `${pair}; ${pair}` } }), identityContinuationCookieName(provider))).toBeUndefined();
  });
  it("bounds final continuation ciphertext and complete cookie bytes without widening the reader", async () => {
    const { flow } = newIdentityFlow(wallet, sessionHash, "github", now), flowToken = await sealIdentityFlow(flow, secret, now);
    const code = "a".repeat(2048), token = await sealIdentityContinuation(flow, flowToken, { denied: false, code }, secret, now);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(identityContinuationCookie("github", token), "utf8")).toBeLessThanOrEqual(4096);
    expect((await readIdentityContinuation(token, flow, flowToken, secret, now))?.code).toBe(code);
    for (const value of ["\\".repeat(2048), '"'.repeat(2048), "\u00e9".repeat(2048)])
      await expect(sealIdentityContinuation(flow, flowToken, { denied: false, code: value }, secret, now)).rejects.toThrow("Identity continuation unavailable");
    const boundary = 4096 - Buffer.byteLength(identityContinuationCookie("github", "x"), "utf8") + 1;
    expect(Buffer.byteLength(identityContinuationCookie("github", "x".repeat(boundary)), "utf8")).toBe(4096);
    expect(() => identityContinuationCookie("github", "x".repeat(boundary + 1))).toThrow("Identity continuation unavailable");
    expect(() => identityContinuationCookie("github", "x".repeat(4097))).toThrow("Identity continuation unavailable");
    expect(() => identityContinuationCookie("github", "\u00e9".repeat(boundary))).toThrow("Identity continuation unavailable");
  });
  it("validates ORCID checksum and provider ID without accepting asserted profile data", () => {
    expect(validOrcid("0000-0002-1825-0097")).toBe(true);
    expect(validOrcid("0000-0002-1825-0098")).toBe(false);
    for (const value of ["https://orcid.org/0000-0002-1825-0097", "0000-0002-1825-0097\n"]) expect(validOrcid(value)).toBe(false);
    expect(providerIdentitySchema.safeParse({ provider: "github", externalId: "0123", label: "alice" }).success).toBe(false);
    expect(providerIdentitySchema.safeParse({ provider: "github", externalId: "123", label: "alice", token: "private" }).success).toBe(false);
    expect(providerIdentitySchema.safeParse({ provider: "orcid", externalId: "0000-0002-1825-0097", label: "Name\nOrganization" }).success).toBe(false);
  });
  it("refuses mismatched owners and duplicate provider projections", () => {
    const identity = { provider: "github", externalId: "123", label: "alice", verifiedAt: new Date(now).toISOString(), wallet };
    expect(identitySnapshotSchema.safeParse({ wallet, identities: [identity, identity] }).success).toBe(false);
    expect(identitySnapshotSchema.safeParse({ wallet: `0x${"d".repeat(40)}`, identities: [identity] }).success).toBe(false);
  });
  it.each(["github", "orcid"] as const)("encrypts %s cookie; bound state is opaque, purpose-specific and expires", async provider => {
    const { state, flow, codeChallenge } = newIdentityFlow(wallet, sessionHash, provider, now);
    expect(state).toHaveLength(43); expect(stateMatches(state, flow)).toBe(true);
    expect(stateMatches("x".repeat(43), flow)).toBe(false); expect(stateMatches(state + "x", flow)).toBe(false);
    expect(!!codeChallenge).toBe(provider === "github");
    expect(Object.keys(flowChallenge(flow)).sort()).toEqual(["expiresAt", "provider", "sessionHash", "stateHash", "wallet"]);
    const sealed = await sealIdentityFlow(flow, secret, now);
    expect(sealed).not.toContain(wallet); expect(sealed).not.toContain(state); expect(sealed).not.toContain(flow.codeVerifier ?? "cannot-match");
    expect(await readIdentityFlow(sealed, secret, now + 1000)).toEqual(flow);
    for (const candidate of [sealed.slice(0, -8) + "tampered", "not-jwe", "x".repeat(2049)]) expect(await readIdentityFlow(candidate, secret, now)).toBeNull();
    expect(await readIdentityFlow(sealed, "d".repeat(48), now)).toBeNull();
    expect(await readIdentityFlow(sealed, secret, now + 300000)).toBeNull();
    expect(await readIdentityFlow(sealed, secret, now - 1000)).toBeNull();
  });
  it("rejects weak secrets and duplicate/oversized cookies", async () => {
    const { flow } = newIdentityFlow(wallet, sessionHash, "github", now);
    await expect(sealIdentityFlow(flow, "weak", now)).rejects.toThrow();
    const cookie = "__Host-keryx_identity_github=value";
    expect(identityCookieValue(new Request("https://keryx.cc", { headers: { Cookie: cookie } }), "github")).toBe("value");
    expect(identityCookieValue(new Request("https://keryx.cc", { headers: { Cookie: `${cookie}; ${cookie}` } }), "github")).toBeUndefined();
    expect(identityCookieValue(new Request("https://keryx.cc", { headers: { Cookie: "x".repeat(17000) } }), "github")).toBeUndefined();
  });
  it("accepts only fixed complete HTTPS deployment config", () => {
    const env = { KERYX_IDENTITY_OAUTH_ORIGIN: "https://keryx.cc", KERYX_GITHUB_OAUTH_CLIENT_ID: "public-client", KERYX_GITHUB_OAUTH_CLIENT_SECRET: "private-secret" };
    expect(identityProviderConfiguration("github", env)?.redirectUri).toBe("https://keryx.cc/api/me/profile/identities/github/callback");
    for (const origin of ["http://keryx.cc", "https://keryx.cc/", "https://user:password@keryx.cc", "https://keryx.cc/path", "https://keryx.cc?redirect=evil"])
      expect(identityProviderConfiguration("github", { ...env, KERYX_IDENTITY_OAUTH_ORIGIN: origin })).toBeNull();
    expect(identityProviderConfiguration("orcid", env)).toBeNull();
    expect(identityProviderConfiguration("github", { ...env, KERYX_GITHUB_OAUTH_CLIENT_SECRET: "" })).toBeNull();
  });
});
