import { botResearchEnglish } from "../../locales/en/bot-research";
import { botResearchVietnamese } from "../../locales/vi/bot-research";
import { botResearchPortuguese } from "../../locales/pt-BR/bot-research";
import { botResearchSpanish } from "../../locales/es/bot-research";
import { answerPresentation } from "../research/answer-presentation";
import { researchAdmissionError } from "../research/availability-contract";

export const botResearchCatalogues = Object.freeze({
  en: botResearchEnglish, vi: botResearchVietnamese,
  pt: botResearchPortuguese, es: botResearchSpanish,
});
export type BotResearchMessageKey = keyof typeof botResearchEnglish;
type Parameters<Text extends string> = Text extends `${string}{${infer Name}}${infer Tail}`
  ? Name | Parameters<Tail> : never;
type Arguments<Key extends BotResearchMessageKey> = [Parameters<typeof botResearchEnglish[Key]>] extends [never]
  ? [] : [Record<Parameters<typeof botResearchEnglish[Key]>, string | number>];

/** Original question only, using the ordinary answer's finite selector. No UI
 * negotiation, preference I/O, source inference or mutable process-wide locale. */
export function botResearchMessages(originalQuestion = "") {
  const language = answerPresentation(originalQuestion, "ordinary").language;
  const catalogue = botResearchCatalogues[language];
  return function message<Key extends BotResearchMessageKey>(key: Key, ...args: Arguments<Key>): string {
    if (!Object.hasOwn(catalogue, key)) throw new Error("Unknown bot research message");
    const parameters = args[0] as Record<string, string | number> | undefined;
    return catalogue[key].replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name)
        || !["string", "number"].includes(typeof parameters[name])) throw new Error("Missing bot research parameter");
      return String(parameters[name]);
    });
  };
}

/** Translate the product-owned pause, never provider/source diagnostic bytes. */
export function botResearchFailure(error: unknown, originalQuestion = ""): string {
  const message = botResearchMessages(originalQuestion);
  const detail = researchAdmissionError(error) ? message("paused")
    : error instanceof Error ? error.message : String(error);
  return message("failure", { detail });
}
