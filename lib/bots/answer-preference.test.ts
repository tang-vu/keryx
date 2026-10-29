import { expect, it, vi } from "vitest";
import { botAnswerPreferenceKey, botAnswerPresentation, readBotAnswerPreference, writeBotAnswerPreference } from "./answer-preference";
import { botPreferenceKey, type BotRecipient } from "./language";
const recipient: BotRecipient = { platform: "telegram", scope: "telegram", userId: "789" };
it("does not migrate help-only intent, rewrites no question, and scopes new answer preferences to the verified recipient", async () => {
  const values = new Map<string, string>([[botPreferenceKey(recipient)!, "es"]]);
  const store = async () => ({ getSyncState: async (key: string) => values.get(key) ?? null,
    setSyncState: async (key: string, value: string) => { values.set(key, value); } });
  expect(await readBotAnswerPreference(recipient, store)).toEqual({ available: true, preference: "auto" });
  expect(await writeBotAnswerPreference(recipient, "vi", store)).toBe(true);
  const question = "Explain this unchanged question.";
  expect(await botAnswerPresentation(question, recipient, store)).toEqual({ language: "vi", input: { presentationLanguage: "vi" } });
  expect(await botAnswerPresentation("Answer in English. Explain this.", recipient, store)).toEqual({ language: "en", input: { presentationLanguage: "en" } });
  expect(await readBotAnswerPreference({ ...recipient, userId: "790" }, store)).toEqual({ available: true, preference: "auto" });
  expect(botAnswerPreferenceKey(recipient)).not.toBe(botPreferenceKey(recipient));
  expect(values.get(botPreferenceKey(recipient)!)).toBe("es");
});
it("fails closed on unbound identity, unsupported values, outage and unconfirmed writes", async () => {
  const store = vi.fn();
  expect(await writeBotAnswerPreference(undefined, "vi", store)).toBe(false);
  expect(await writeBotAnswerPreference(recipient, "zz-unsupported", store)).toBe(false); expect(store).not.toHaveBeenCalled();
  expect(await writeBotAnswerPreference(recipient, "vi", async () => ({ getSyncState: async () => null, setSyncState: async () => {} }))).toBe(false);
  expect(await readBotAnswerPreference(recipient, async () => { throw new Error("private backend"); })).toEqual({ available: false, preference: "auto" });
});
