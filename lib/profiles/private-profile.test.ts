import { describe, expect, it } from "vitest";
import { canonicalProfileLink, privateProfileInputSchema, requirePrivateProfiles, RESERVED_PROFILE_HANDLES } from "./private-profile";
const profile = { displayName: "<img src=x onerror=alert(1)>", handle: "Reader_01", bio: "Researcher", purpose: "Read papers", links: [] };
describe("private profile contract", () => {
  it("normalizes case and retains text as data without adding identity or activity fields", () => {
    expect(privateProfileInputSchema.parse(profile)).toEqual({ ...profile, handle: "reader_01" });
    for (const extra of ["wallet", "role", "visibility", "questions", "creatorsPaid", "payTo"]) expect(privateProfileInputSchema.safeParse({ ...profile, [extra]: "forged" }).success).toBe(false);
  });
  it("blocks every reserved handle case-insensitively", () => { for (const handle of RESERVED_PROFILE_HANDLES) expect(privateProfileInputSchema.safeParse({ ...profile, handle: handle.toUpperCase() }).success).toBe(false); });
  it.each(["ab", "0xalice", "reader-name", "réader", "аdmin", "a".repeat(33), "reader\nadmin"])("refuses unsupported handle %s", handle => expect(privateProfileInputSchema.safeParse({ ...profile, handle }).success).toBe(false));
  it.each(["line\nline", "line\rline", "line\u2028line", "name\u202Etext", "\uD800", "a".repeat(161)])("refuses multi-line/control/unbounded text", bio => expect(privateProfileInputSchema.safeParse({ ...profile, bio }).success).toBe(false));
  it("bounds name/purpose and duplicate links", () => {
    expect(privateProfileInputSchema.safeParse({ ...profile, displayName: "a".repeat(81) }).success).toBe(false);
    expect(privateProfileInputSchema.safeParse({ ...profile, purpose: "a".repeat(161) }).success).toBe(false);
    expect(privateProfileInputSchema.safeParse({ ...profile, links: [{ kind: "github", url: "https://github.com/alice" }, { kind: "github", url: "https://github.com/bob" }] }).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "http://github.com/alice", "https://github.com.evil.org/alice", "https://github.com@evil.org/alice", "https://github.com:8443/alice", "https://github.com/alice?token=secret", "https://github.com/alice#fragment", "https://127.0.0.1/a", "https://local.internal/a", "https://github.com/", "https://github.com/a\n"])("refuses malicious/unsupported URL", url => expect(() => canonicalProfileLink("github", url)).toThrow());
  it("allows explicit provider profiles and a public HTTPS personal website without fetching it", () => {
    for (const [kind, url] of [["orcid", "https://orcid.org/0000-0001-2345-6789"], ["linkedin", "https://www.linkedin.com/in/alice"], ["x", "https://x.com/alice"], ["telegram", "https://t.me/alice"], ["website", "https://alice.org/"]]) expect(canonicalProfileLink(kind, url)).toBe(url);
  });
  it("bounds the canonical URL after Unicode escaping", () => expect(() => canonicalProfileLink("website", "https://alice.org/" + "界".repeat(100))).toThrow("Canonical profile link too long"));
  it("a missing or rejected port remains unavailable without invoking another storage operation", () => {
    expect(() => requirePrivateProfiles({})).toThrow("profile_unavailable");
    const proxy = new Proxy({}, { get() { throw new Error("sealed capability absent"); } });
    expect(() => requirePrivateProfiles(proxy)).toThrow("profile_unavailable");
  });
});
