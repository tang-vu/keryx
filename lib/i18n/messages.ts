import type { UiLocale } from "./locales";

/** English source keys. Payment/legal prose remains in its separate review gate. */
export const englishMessages = {
  "navigation.home": "Home",
  "navigation.archive": "The archive",
  "navigation.newDispatch": "New dispatch",
  "locale.label": "Interface language",
  "report.question": "Question: {question}",
  "report.citedSources.one": "{count} source cited",
  "report.citedSources.other": "{count} sources cited",
  "format.unavailable": "Unavailable",
} as const;
export type MessageKey = keyof typeof englishMessages;
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Tail}` ? Name | Placeholders<Tail> : never;
type Parameters<K extends MessageKey> = Record<Placeholders<typeof englishMessages[K]>, string | number>;
type MessageArguments<K extends MessageKey> = [Placeholders<typeof englishMessages[K]>] extends [never] ? [] : [Parameters<K>];
export type MessageCatalogue = Partial<Record<MessageKey, string>>;
export type MissingMessageReporter = (locale: UiLocale, key: MessageKey) => void;

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]))].sort();
}

/** Used by CI/review and by an eventual selected-locale loader; no implicit approval. */
export function validateMessageCatalogue(catalogue: MessageCatalogue): { missing: MessageKey[]; invalid: string[] } {
  const keys = Object.keys(englishMessages) as MessageKey[];
  const invalid = Object.keys(catalogue).filter(key => !Object.hasOwn(englishMessages, key));
  const missing = keys.filter(key => !Object.hasOwn(catalogue, key) || catalogue[key] === undefined);
  for (const key of keys) {
    const text = catalogue[key];
    if (text === undefined) continue;
    if (typeof text !== "string" || !text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
      JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(englishMessages[key]))) invalid.push(key);
  }
  return { missing, invalid };
}

/** Pass only the selected catalogue to a client. Missing translations render English. */
export function createMessages(locale: UiLocale, catalogue: MessageCatalogue = {}, reportMissing?: MissingMessageReporter) {
  const checked = validateMessageCatalogue(catalogue);
  if (checked.invalid.length) throw new Error(`Invalid message catalogue: ${checked.invalid.join(", ")}`);
  return function message<K extends MessageKey>(key: K, ...args: MessageArguments<K>): string {
    if (!Object.hasOwn(englishMessages, key)) throw new Error("Unknown English source message");
    const translated = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
    if (translated === undefined && locale !== "en") reportMissing?.(locale, key);
    const text = translated ?? englishMessages[key];
    const parameters = args[0] as Record<string, string | number> | undefined;
    return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name) || !["string", "number"].includes(typeof parameters[name])) {
        throw new Error(`Missing message parameter: ${name}`);
      }
      return String(parameters[name]);
    });
  };
}
