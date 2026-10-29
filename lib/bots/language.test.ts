import { describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { botHelpEnglish } from "../../locales/en/bot-research";
import { botControlsEnglish } from "../../locales/en/bot-controls";
import { botControlsCatalogues, botControlResponse, botHelpLanguage, botLanguage, botPreferenceKey,
  parseBotControl, readBotHelpPreference, writeBotHelpPreference, type BotRecipient } from "./language";
import { helpText as telegram } from "../telegram/ask-message";
import { helpText as slack } from "../slack/ask-command";
import { helpText as discord, parseControlCommand } from "../discord/ask-interaction";

const recipient: BotRecipient = { platform: "telegram", scope: "telegram", userId: "789" };
describe("private bot help preferences", () => {
  it("uses existing SQLite sync-state storage across adapter calls without changing unrelated state", async () => {
    const db = new SqliteAdapter(":memory:");
    try {
      await db.init();
      await db.setSyncState("retained-control", "unchanged");
      const store = async () => db;
      expect(await readBotHelpPreference(recipient, store)).toEqual({ available: true, preference: "auto" });
      expect(await writeBotHelpPreference(recipient, "pt-BR", store)).toBe(true);
      expect(await readBotHelpPreference(recipient, store)).toEqual({ available: true, preference: "pt" });
      expect(await readBotHelpPreference({ ...recipient, userId: "790" }, store)).toEqual({ available: true, preference: "auto" });
      expect(await writeBotHelpPreference(recipient, "auto", store)).toBe(true);
      expect(await readBotHelpPreference(recipient, store)).toEqual({ available: true, preference: "auto" });
      expect(await db.getSyncState("retained-control")).toBe("unchanged");
    } finally { db.close(); }
  });
  it("separates platform, application/workspace and sender without storing tokens, channel or wallet authority", () => {
    const recipients: BotRecipient[] = [recipient, { ...recipient, userId: "790" },
      { platform: "discord", scope: "123", userId: "789" }, { platform: "discord", scope: "124", userId: "789" },
      { platform: "slack", scope: "T123", userId: "U789" }, { platform: "slack", scope: "T124", userId: "U789" }];
    const keys = recipients.map(botPreferenceKey);
    expect(new Set(keys).size).toBe(recipients.length);
    keys.forEach(key => expect(key).toMatch(/^keryx:bot-help-language:v1:[0-9a-f]{64}$/u));
    for (const invalid of [undefined, { ...recipient, userId: "unknown" }, { ...recipient, userId: "9007199254740993" },
      { platform: "slack" as const, scope: "", userId: "U789" }, { ...recipient, scope: "private-token" }])
      expect(botPreferenceKey(invalid)).toBeNull();
  });
  it("does not open storage for an unbound recipient or unsupported language", async () => {
    const store = vi.fn();
    expect(await readBotHelpPreference(undefined, store)).toEqual({ available: false, preference: "auto" });
    expect(await writeBotHelpPreference(recipient, "de", store)).toBe(false);
    expect(store).not.toHaveBeenCalled();
  });
  it("does not claim persistence when the capability, acknowledgement or readback is missing", async () => {
    for (const db of [{}, { getSyncState: async () => null },
      { getSyncState: async () => "en", setSyncState: async () => {} },
      { getSyncState: async () => { throw new Error("private backend detail"); }, setSyncState: async () => {} }]) {
      expect(await writeBotHelpPreference(recipient, "vi", async () => db)).toBe(false);
    }
    expect(await readBotHelpPreference(recipient, async () => ({ getSyncState: async () => "corrupt" })))
      .toEqual({ available: false, preference: "auto" });
    const reply = await botControlResponse({ control: { action: "language", value: "es" }, recipient }, async () => ({}));
    expect(reply.text).toContain(botControlsEnglish.languageUnavailable);
    expect(reply.text).not.toContain("private backend detail");
    expect(reply.text).not.toContain("Saved help language");
  });
  it("only explicit language commands write; help and inspection preserve preference", async () => {
    const db = { getSyncState: vi.fn(async () => "vi"), setSyncState: vi.fn() }, store = async () => db;
    expect((await botControlResponse({ control: { action: "help", value: "es" }, recipient }, store)).language).toBe("es");
    expect((await botControlResponse({ control: { action: "language" }, recipient }, store)).text)
      .toContain(botControlsCatalogues.vi.languageCurrent.replace("{preference}", "vi"));
    await botControlResponse({ control: { action: "language", value: "de" }, recipient }, store);
    expect(db.setSyncState).not.toHaveBeenCalled();
    const unavailable = vi.fn();
    const group = await botControlResponse({ control: { action: "language", value: "es" }, recipient,
      privateOnly: true, platformLocale: "vi" }, unavailable);
    expect(group.text).toBe(botControlsCatalogues.vi.languagePrivate);
    expect(unavailable).not.toHaveBeenCalled();
  });
});

describe("finite control locale authority", () => {
  it("uses explicit help locale, stored preference, supported platform hint, then English", () => {
    expect(botHelpLanguage({ explicit: "pt-BR", stored: "vi", platformLocale: "es-ES" })).toEqual({ language: "pt", source: "explicit" });
    expect(botHelpLanguage({ stored: "vi", platformLocale: "es" })).toEqual({ language: "vi", source: "stored" });
    expect(botHelpLanguage({ stored: "auto", platformLocale: "es-ES" })).toEqual({ language: "es", source: "platform" });
    expect(botHelpLanguage({ explicit: "de", platformLocale: "zh-Hans" })).toEqual({ language: "zh-Hans", source: "platform" });
    expect(botHelpLanguage({ platformLocale: "zh-TW" })).toEqual({ language: "en", source: "default" });
    expect(botLanguage("pt-PT")).toBeUndefined();
    expect(botHelpLanguage()).toEqual({ language: "en", source: "default" });
  });
  it.each(Object.entries(botControlsCatalogues))("%s keeps the closed catalogue and unchanged financial help", (language, copy) => {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(botControlsEnglish).sort());
    expect(Object.isFrozen(copy)).toBe(true);
    for (const key of Object.keys(botControlsEnglish) as (keyof typeof botControlsEnglish)[]) {
      expect(copy[key].trim()).not.toBe("");
      expect([...copy[key].matchAll(/\{(\w+)\}/gu)].map(match => match[1]))
        .toEqual([...botControlsEnglish[key].matchAll(/\{(\w+)\}/gu)].map(match => match[1]));
    }
    const locale = language as keyof typeof botControlsCatalogues;
    for (const rendered of [telegram(locale), slack(locale), discord(locale)]) {
      expect(rendered).toContain(copy.reviewBoundary);
      expect(rendered).toContain(copy.languageHelp);
      expect(rendered).toContain("/language en|vi|pt|es|fr|zh-Hans|auto");
      expect(rendered).toContain("/status");
      expect(rendered).not.toMatch(/translated|traduzid|traducid|được dịch/u);
    }
    expect(telegram(locale)).toContain(botHelpEnglish.telegramExplanation);
    expect(slack(locale)).toContain(botHelpEnglish.slackExplanation);
    expect(discord(locale)).toContain(botHelpEnglish.slackExplanation);
    expect(telegram(locale, false)).not.toContain(copy.privateQuestion);
  });
  it.each(["/help", "/start@Keryx", "/ask", "help"])("treats %s as a control without research", text => {
    expect(parseBotControl(text)).toEqual({ action: "help" });
  });
  it("keeps English command names and exact questions out of the control path", () => {
    expect(parseBotControl("/language@Keryx pt-BR")).toEqual({ action: "language", value: "pt-BR" });
    expect(parseBotControl("/help es")).toEqual({ action: "help", value: "es" });
    for (const question of ["/ask Explain language models", "Explique uma pergunta", "/idioma es"])
      expect(parseBotControl(question)).toBeNull();
    const base = { type: 2, application_id: "123", token: "isolated-interaction" };
    expect(parseControlCommand({ ...base, data: { name: "help" } })).toEqual({ action: "help" });
    expect(parseControlCommand({ ...base, data: { name: "language", options: [{ name: "value", value: "vi" }] } }))
      .toEqual({ action: "language", value: "vi" });
    expect(parseControlCommand({ ...base, data: { name: "language", options: [{ name: "unknown", value: "vi" }] } })).toBeNull();
  });
});
