import { createMessages, englishMessages, validateMessageCatalogue, type MessageCatalogue, type MessageKey } from "./messages";
import { preparedLocales, type UiLocale } from "./locales";

export type ShellMessageKey = Extract<MessageKey, `shellNavigation.${string}` | `shellHeader.${string}` | `shellFooter.${string}`>;
export type ShellDraft = Partial<Record<ShellMessageKey, { source: string; text: string }>>;
export type ShellReporter = (locale: UiLocale, key: ShellMessageKey) => void;
export const shellKeys = Object.keys(englishMessages).filter(key => /^shell(?:Navigation|Header|Footer)\./u.test(key)) as ShellMessageKey[];

/** A bounded key-only reporter. No question, parameter, invalid key or translated value is logged. */
export function boundedShellReporter(report: ShellReporter, maximum = 32): ShellReporter {
  const seen = new Set<string>();
  const limit = Math.min(32, Math.max(0, Number.isSafeInteger(maximum) ? maximum : 0));
  return (locale, key) => {
    const id = `${locale}:${key}`;
    if (!preparedLocales.includes(locale) || !shellKeys.includes(key) || seen.has(id) || seen.size >= limit) return;
    seen.add(id); report(locale, key);
  };
}
export const reportShellFallback = boundedShellReporter((locale, key) => {
  if (process.env.NODE_ENV !== "production" || process.env.CI === "true" || process.env.CI === "1") console.warn("[i18n] English fallback", locale, key);
});

/** Validate descriptors before reading values. Stale source bindings fall back per key. */
export function validateShellDraft(locale: UiLocale, draft: unknown, report?: ShellReporter): MessageCatalogue {
  const selected: MessageCatalogue = {};
  if (!draft || typeof draft !== "object" || Array.isArray(draft) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(draft))) return selected;
  const descriptors = Object.getOwnPropertyDescriptors(draft);
  if (Reflect.ownKeys(draft).length > 64) return selected;
  for (const key of shellKeys) {
    const entry = descriptors[key];
    if (!entry) continue;
    if (!("value" in entry) || !entry.enumerable || !entry.value || typeof entry.value !== "object") { report?.(locale, key); continue; }
    const value = entry.value;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 2 ||
      Object.keys(fields).sort().join(",") !== "source,text" ||
      Object.values(fields).some(field => !field.enumerable || !("value" in field)) ||
      fields.source.value !== englishMessages[key] || typeof fields.text.value !== "string" || fields.text.value.length > 2000) {
      report?.(locale, key); continue;
    }
    const candidate = { [key]: fields.text.value } as MessageCatalogue;
    if (validateMessageCatalogue(candidate).invalid.length) { report?.(locale, key); continue; }
    selected[key] = fields.text.value;
  }
  return Object.freeze(selected);
}

const loaders = {
  vi: () => import("@/locales/vi/ui-shell-preview").then(module => module.uiShellPreview),
  "zh-Hans": () => import("@/locales/zh-Hans/ui-shell-preview").then(module => module.uiShellPreview),
};
/** No target import for English or a disabled/unsupported locale. Only the selected chunk loads. */
export async function loadUiShellCatalogue(locale: UiLocale, enabled: readonly UiLocale[], report = reportShellFallback,
  selectedLoaders: Record<Exclude<UiLocale, "en">, () => Promise<ShellDraft>> = loaders): Promise<MessageCatalogue> {
  if (locale === "en" || !enabled.includes(locale) || !Object.hasOwn(selectedLoaders, locale)) return {};
  return validateShellDraft(locale, await selectedLoaders[locale as keyof typeof loaders](), report);
}
export function createShellMessages(locale: UiLocale, catalogue: MessageCatalogue = {}, report = reportShellFallback) {
  return createMessages(locale, catalogue, (selected, key) => { if (shellKeys.includes(key as ShellMessageKey)) report(selected, key as ShellMessageKey); });
}
