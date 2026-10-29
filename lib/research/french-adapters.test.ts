import { afterEach, expect, it, vi } from "vitest";
import { clientLanguageNames, clientPresentationLanguage, clientPresentationMessages } from "../../shared/i18n/client-language";
import { desktopNeutralCatalogues } from "../../shared/i18n/desktop-neutral";
import { researchPresentationCatalogues } from "./presentation-messages";
import { botResearchCatalogues } from "../bots/research-messages";
import { botControlResponse, botControlsCatalogues, botPreferenceKey, type BotRecipient } from "../bots/language";
import { botAnswerPreferenceKey, botAnswerPresentation, readBotAnswerPreference } from "../bots/answer-preference";
import { readRecipientLanguage, writeRecipientLanguage } from "../notify/recipient-language";
import { buildCitationEmailContent } from "../notify/citation-email";
import { CITATION_EVENT, type CitationWebhookPayload } from "../notify/citation-webhook";
import { citationEmailMessages } from "../notify/citation-messages";
import { openapiSpec } from "../openapi-spec";
import { canonicalPresentationLanguages, isPresentationLanguage } from "../../shared/i18n/presentation-language";

afterEach(() => vi.unstubAllGlobals());

it("selects French client and complete neutral desktop controls without granting UI, payment or storage authority", () => {
  expect(Object.isFrozen(canonicalPresentationLanguages)).toBe(true);
  expect(isPresentationLanguage("fr")).toBe(true);
  for (const value of ["fr-FR", "pt-BR", "zz-unsupported", { toString: () => "fr" }, null])
    expect(isPresentationLanguage(value)).toBe(false);
  expect(clientPresentationLanguage("fr-FR")).toBe("fr");
  expect(clientPresentationLanguage("vi-VN", "fr")).toBe("fr");
  expect(clientPresentationLanguage("fr-CA", "auto")).toBe("fr");
  expect(clientLanguageNames.fr).toBe("Français");
  expect(clientPresentationMessages("fr").controls.answer).toBe("Réponse");
  expect(clientPresentationMessages("fr").research("reportSources")).toBe("## Sources citées");
  expect(Object.keys(desktopNeutralCatalogues.fr).sort()).toEqual(Object.keys(desktopNeutralCatalogues.en).sort());
  expect(desktopNeutralCatalogues.fr["nativeDesktop.workspace.open"]).toBe("Ouvrir un espace de travail");
});

it("keeps French financial, settlement, pause and private-boundary authority exactly English", () => {
  for (const key of ["citations", "apiAllocations", "apiTotal", "noRewards", "remoteTotal", "reportPayments"] as const)
    expect(researchPresentationCatalogues.fr[key]).toBe(researchPresentationCatalogues.en[key]);
  for (const key of ["citationHeading", "slackCitationHeading", "recordedCreators", "recordedCreatorTotal", "settlementNotice",
    "slackSettlementNotice", "discordSettlementNotice", "paused", "treasuryUnavailable", "sponsoredLimited", "dispatching"] as const)
    expect(botResearchCatalogues.fr[key]).toBe(botResearchCatalogues.en[key]);
  expect(botControlsCatalogues.fr.reviewBoundary).toBe(botControlsCatalogues.en.reviewBoundary);
  for (const key of ["subject", "textBody", "textRate", "htmlTitle", "htmlHeading", "htmlBody", "htmlRate"] as const)
    expect(citationEmailMessages.fr[key]).toBe(citationEmailMessages.en[key]);
});

it("saves French only through an authenticated recipient-scoped explicit command and gives original output intent priority", async () => {
  const fetch = vi.fn(async () => { throw new Error("No external request admitted"); }); vi.stubGlobal("fetch", fetch);
  const recipient: BotRecipient = { platform: "telegram", scope: "telegram", userId: "789" };
  const state = new Map<string, string>(), store = async () => ({
    getSyncState: async (key: string) => state.get(key) ?? null,
    setSyncState: async (key: string, value: string) => { state.set(key, value); },
  });
  const response = await botControlResponse({ control: { action: "language", value: "fr" }, recipient }, store);
  expect(response.language).toBe("fr");
  expect(response.text).toContain("Préférence de langue des réponses et de l'aide enregistrée : fr.");
  expect(response.text).toContain("en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|auto");
  expect(state.get(botPreferenceKey(recipient)!)).toBe("fr");
  expect(state.get(botAnswerPreferenceKey(recipient)!)).toBe("fr");
  const question = "Keep original <question> {count} 日本語";
  expect(await botAnswerPresentation(question, recipient, store)).toEqual({ language: "fr", input: { presentationLanguage: "fr" } });
  expect(await botAnswerPresentation("Answer in English. " + question, recipient, store)).toEqual({ language: "en", input: { presentationLanguage: "en" } });
  expect(await readBotAnswerPreference({ ...recipient, userId: "790" }, store)).toEqual({ available: true, preference: "auto" });
  expect(fetch).not.toHaveBeenCalled();
});

it("accepts a source recipient's French preference with unchanged recipient rotation and no email/reader identity join", async () => {
  const state = new Map<string, string>();
  const db = { getSyncState: async (key: string) => state.get(key) ?? null,
    setSyncState: async (key: string, value: string) => { state.set(key, value); } };
  const recipient = { sourceId: "original-source", email: "creator@example.invalid", unsubToken: "a".repeat(64) };
  expect(await writeRecipientLanguage(db, recipient, "fr")).toBe(true);
  expect(await readRecipientLanguage(db, recipient)).toEqual({ language: "fr", available: true });
  expect(await readRecipientLanguage(db, { ...recipient, email: "changed@example.invalid" })).toEqual({ language: "en", available: true });
  expect(await readRecipientLanguage(db, { ...recipient, unsubToken: "b".repeat(64) })).toEqual({ language: "en", available: true });
});

it("renders French email navigation without changing canonical financial bytes, original source text or URLs", () => {
  const input: CitationWebhookPayload = { event: CITATION_EVENT, deliveryId: "synthetic", timestamp: "2026-10-28T00:00:00Z",
    source: { id: "original-source", name: 'Source <日本語> & "original"' },
    query: { id: "original-query", question: "PRIVATE original reader question" }, weight: 0.6, amountUsdc: 0.015, network: "arcTestnet",
    payments: [{ payee: "0xabc", amountUsdc: 0.015, txHash: "0xsynthetic", settled: true }] };
  const before = JSON.stringify(input), options = { base: "https://example.invalid", unsubToken: "original-token" };
  const english = buildCitationEmailContent(input, { ...options, language: "en" });
  const french = buildCitationEmailContent(input, { ...options, language: "fr" });
  expect(french.subject).toBe(english.subject);
  expect(french.text.split("\n")[0]).toBe(english.text.split("\n")[0]);
  expect(french.text).toContain("Trace complète de la recherche");
  expect(french.html).toContain("Se désabonner");
  expect(french.html).toContain("The Keryx agent relied on");
  for (const body of [french.text, french.html]) {
    expect(body).toContain("$0.015");
    expect(body).toContain("https://example.invalid/dispatch/original-query");
    expect(body).not.toContain(input.query.question);
  }
  expect(french.html).toContain("Source &lt;日本語&gt; &amp; &quot;original&quot;");
  expect(JSON.stringify(input)).toBe(before);
});

it("advertises French in the actual labels-only API schema without changing the machine contract's role", () => {
  const language = openapiSpec.components.schemas.ChatCompletionRequest.properties.language;
  expect(language.enum).toContain("fr");
  expect(language.description).toContain("does not translate the answer");
});
