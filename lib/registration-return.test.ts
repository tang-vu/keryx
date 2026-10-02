import { expect, it } from "vitest";
import { registrationDraft, registrationOwnerMatches, registrationTarget, safeRegistrationReturn } from "./registration-return";
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
  expect(safeRegistrationReturn("/register?returnTo=https://evil.example&rss=javascript:alert(1)&post=https://post.example&owner=bad")).toBe("/register");
  expect(registrationDraft(new URLSearchParams({ rss: "https://user:pass@example.com/feed", gap: "../evil", post: "https://post.example" }))).toEqual({});
  expect(registrationDraft(new URLSearchParams({ rss: "https://feed.example", gap: "gap-1" }))).toEqual({ rssUrl: "https://feed.example/" });
});
