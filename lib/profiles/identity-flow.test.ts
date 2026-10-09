import { describe, expect, it } from "vitest";
import { flowChallenge, identityCookieValue, identityProviderConfiguration, newIdentityFlow, readIdentityFlow, sealIdentityFlow, stateMatches } from "./identity-flow";
import { identitySnapshotSchema, providerIdentitySchema, validOrcid } from "./verified-identities";
const wallet = `0x${"a".repeat(40)}`, sessionHash = "b".repeat(64), secret = "c".repeat(48), now = Date.parse("2026-10-09T06:00:00.000Z");
describe("private identity state and data boundary", () => {
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
