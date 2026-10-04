import { expect, it } from "vitest";
import { registrationConnectHref, registrationDraft, registrationOwnerMatches, registrationTarget, safeRegistrationReturn, sourceClaimDraft, sourceClaimTarget, sourceReturnWithOwner, sourceClaimConnectHref } from "./registration-return";
const owner = `0x${"a".repeat(40)}`;
it("roundtrips the prepared feed and paired Wanted context with wallet binding", () => {
  const draft = { rssUrl: "https://publisher.example/feed?a=1&b=2", gapId: "gap-123", matchedItemLink: "https://publisher.example/post", owner };
  const target = registrationTarget(draft);
  expect(safeRegistrationReturn(target)).toBe(target);
  expect(registrationDraft(new URL(target, "https://test.example").searchParams)).toEqual(draft);
  expect(registrationOwnerMatches(target, owner.toUpperCase())).toBe(true);
  expect(registrationOwnerMatches(target, `0x${"b".repeat(40)}`)).toBe(false);
});
it.each(["https://evil.example/register", "//evil.example/register", "/\\evil.example/register", "/register\\@evil.example", "/register\n?rss=x", "/register%3freturnTo=//evil.example", "/%252f%252fevil.example", "/register#evil", "/register?rss=\tbad", "/register?name=\u007f", "javascript:alert(1)", "/api/auth/signout", "/connect", "/register/../connect"])("rejects unsafe return %s", value => expect(safeRegistrationReturn(value)).toBeNull());
it("canonicalizes only allowed draft fields and rejects credential/protocol URLs and unpaired intent", () => {
  expect(safeRegistrationReturn("/register?returnTo=https://evil.example&rss=javascript:alert(1)&post=https://post.example&owner=bad")).toBeNull();
  expect(() => registrationDraft(new URLSearchParams({ rss: "https://user:pass@example.com/feed", gap: "../evil", post: "https://post.example" }))).toThrow();
  expect(registrationDraft(new URLSearchParams({ rss: "https://feed.example", gap: "gap-1" }))).toEqual({ rssUrl: "https://feed.example/" });
});
it("refuses escaped transport overflow without truncating multibyte draft fields", () => {
  const description = String.fromCharCode(0x4e2d).repeat(2000);
  const draft = registrationDraft(new URLSearchParams({ name: "Publisher", desc: description }));
  expect(draft.description).toBe(description);
  expect(registrationConnectHref(draft)).toBeNull();
  expect(safeRegistrationReturn(registrationTarget(draft))).toBeNull();
});
it("bounds maximal escaped RSS/Wanted fields including the later owner binding", () => {
  const escaped = `https://publisher.example/?q=${"%2F".repeat(650)}`;
  const draft = registrationDraft(new URLSearchParams({ rss: escaped, gap: "gap-1", post: escaped }));
  expect(draft.rssUrl).toBe(escaped); expect(draft.matchedItemLink).toBe(escaped);
  expect(registrationConnectHref(draft)).toBeNull();
  expect(safeRegistrationReturn(registrationTarget(draft))).toBeNull();
  const ordinary = { rssUrl: "https://publisher.example/feed", description: String.fromCharCode(0x4e2d).repeat(100) };
  const href = registrationConnectHref(ordinary)!;
  expect(href.length).toBeLessThanOrEqual(6000);
  expect(safeRegistrationReturn(new URL(href, "https://test.example").searchParams.get("returnTo"))).toBe(registrationTarget(ordinary));
});
it("checks normalized URL length when Unicode expands into escaped bytes", () => {
  const url = `https://publisher.example/${String.fromCharCode(0x4e2d).repeat(300)}`;
  expect(url.length).toBeLessThan(2048);
  expect(() => registrationDraft(new URLSearchParams({ rss: url }))).toThrow(/2048 normalized/);
});
it("retains a claim registration and its exact zero-price review through sign-in", () => {
  const draft = { url: "https://publisher.example/article", name: "Publisher", sourceClaimId: "a".repeat(64), fetchPrice: 0, owner };
  const target = registrationTarget(draft);
  expect(registrationDraft(new URL(target, "https://test.example").searchParams)).toEqual(draft);
  expect(safeRegistrationReturn(target)).toBe(target);
  expect(new URL(registrationConnectHref(draft)!, "https://test.example").searchParams.get("returnTo")).toBe(target);
  expect(() => registrationDraft(new URLSearchParams({ fetchPrice: "0.0000001" }))).toThrow();
  expect(() => registrationDraft(new URLSearchParams({ sourceClaimId: "../invalid" }))).toThrow();
});
it("roundtrips only bounded claim context and retains the original initiating wallet", () => {
  const draft = { url: "https://publisher.example/article", referenceId: "public:publisher", challengeId: "b".repeat(64), owner };
  const target = sourceClaimTarget(draft);
  expect(sourceClaimDraft(new URL(target, "https://test.example").searchParams)).toEqual(draft);
  expect(safeRegistrationReturn(target + "&returnTo=https://evil.example")).toBe(target);
  expect(sourceReturnWithOwner(target, `0x${"c".repeat(40)}`)).toBe(target);
  expect(registrationOwnerMatches(target, `0x${"c".repeat(40)}`)).toBe(false);
  expect(sourceClaimConnectHref(draft)).not.toBeNull();
});
it.each(["/claim-source#x", "/claim-source/../connect", "/claim-source?url=http://publisher.example", "/claim-source?url=https://user:pass@publisher.example", "/claim-source?referenceId=../wrong", "/claim-source?challengeId=wrong", "/claim-source\\@evil.example", "/claim-source?url=javascript:alert(1)"])("rejects unsafe source claim return %s", value => expect(safeRegistrationReturn(value)).toBeNull());
