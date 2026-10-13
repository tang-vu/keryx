import { expect, it, vi } from "vitest";
import { recipientLanguageKey, readRecipientLanguage, writeRecipientLanguage } from "./recipient-language";

const recipient = { sourceId: "source-a", email: "reader@example.org", unsubToken: "a".repeat(64) };
it("scopes language to the exact configured recipient and rotation, with no visible identifiers", async () => {
  const state = new Map<string, string>();
  const db = { getSyncState: vi.fn(async (key: string) => state.get(key) ?? null), setSyncState: vi.fn(async (key: string, value: string) => { state.set(key, value); }) };
  expect(await readRecipientLanguage(db, recipient)).toEqual({ language: "en", available: true });
  expect(await writeRecipientLanguage(db, recipient, "pt-BR")).toBe(true);
  expect(await readRecipientLanguage(db, recipient)).toEqual({ language: "pt", available: true });
  expect(recipientLanguageKey(recipient)).not.toContain(recipient.email);
  for (const changed of [{ ...recipient, email: "next@example.org" }, { ...recipient, sourceId: "source-b" }, { ...recipient, unsubToken: "b".repeat(64) }])
    expect(await readRecipientLanguage(db, changed)).toEqual({ language: "en", available: true });
});
it("falls back to English after malformed state/read failure and refuses unconfirmed writes", async () => {
  expect(await readRecipientLanguage({ getSyncState: async () => "fr" }, recipient)).toEqual({ language: "en", available: false });
  expect(await readRecipientLanguage({ getSyncState: async () => { throw new Error("private backend"); } }, recipient)).toEqual({ language: "en", available: false });
  const set = vi.fn();
  expect(await writeRecipientLanguage({ setSyncState: set, getSyncState: async () => null }, recipient, "vi")).toBe(false);
  expect(set).toHaveBeenCalledOnce(); set.mockClear();
  expect(await writeRecipientLanguage({ setSyncState: set, getSyncState: async () => null }, recipient, "fr")).toBe(false);
  expect(await writeRecipientLanguage({ setSyncState: set }, { ...recipient, unsubToken: "invalid" }, "vi")).toBe(false);
  expect(set).not.toHaveBeenCalled();
});
