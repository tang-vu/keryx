import { createMessages, englishMessages, validateMessageCatalogue, type MessageCatalogue, type MessageKey } from "./messages";
import { preparedLocales, type UiLocale } from "./locales";

export type ShellMessageKey = Extract<MessageKey, `shellNavigation.${string}` | `shellHeader.${string}` | `shellFooter.${string}`>;
export type ShellDraft = Partial<Record<ShellMessageKey, { source: string; text: string }>>;
export type ShellReporter = (locale: UiLocale, key: ShellMessageKey) => void;
export type NamespaceSource = {
  namespace: string;
  sourcePath: string;
  /** Trusted, build/source-bound SHA256 of UTF-8 source normalized to LF. */
  sourceSha256: string;
  entries: Readonly<Record<string, string>>;
};
export type NamespaceDraft = {
  status: "machineDraft";
  review: null;
  sourcePath: string;
  sourceSha256: string;
  entries: Record<string, { source: string; text: string } | { source: string; term: string }>;
};
const namespaceNames = new Set([
  "account-membership", "bibliographies", "bot-controls", "bot-research", "checked-bibliography-exports",
  "claimant-history", "completed-evidence-draft-selection", "creator-registration", "creator", "decision-reviews",
  "deliverable-acceptance", "draft-check", "evidence-audit", "evidence-drafts", "evidence-procurement", "get-started",
  "integrations", "job-targets", "landing", "ledger", "legal", "my-history", "native-desktop", "operations",
  "operator-obligations", "owned-history", "paid-job-escalation", "personal-history", "product-guide", "profile-identities",
  "proof", "public-profiles", "purchase-outcome-aggregate", "purchase-outcomes", "quality", "registration",
  "report-presentation", "reports", "research-flow", "research-funding", "research-mandates", "research-presentation",
  "run-claim-research", "run-claims", "run-privacy", "shared-helpers", "shell", "source-archive", "source-claims",
  "source-directory", "source-leaderboard", "specialist-briefs", "ui-preference", "usage", "walkthrough", "wanted",
  "web-header", "withdrawal", "zotero", "core-inline",
]);
function draftFields(value: unknown): Record<string, PropertyDescriptor> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(fields).length ||
    Object.values(fields).some(field => !field.enumerable || !("value" in field))) return;
  return fields;
}
// Library bulk changes and cleared-data recovery require consent review as a whole.
const criticalCopy = /payment|consent|legal|privacy|terms|authoriz|signature|signing|settle|refund|withdraw|deposit|budget|spend|funding|sponsor|purchase|pay\b|paid\b|wallet|receipt|reserv|uncertain|pending|simulat|failed|expired|balance|transaction|obligation|toll|reward|payout|publication|publish|ownership|visibility|private|unlisted|erased|\bfees?\b|\bcap\b|literature-(?:bulk-screening|clear-recovery)/iu;
const consentKey = /(?:^|[.])confirm(?:ation)?(?:[A-Z_]|$)|Confirm(?:ation)?$/u;
function preservedTokens(text: string, pattern: RegExp): string {
  return JSON.stringify([...text.matchAll(pattern)].map(match => match[0]).sort());
}
function validDraftText(key: string, source: string, text: unknown): text is string {
  if (typeof text !== "string" || !text.trim() || text.length > 16000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return false;
  // Reuse the runtime validator for keys already in the shared message catalogue.
  if (Object.hasOwn(englishMessages, key) && (englishMessages[key as MessageKey] !== source ||
    validateMessageCatalogue({ [key]: text } as MessageCatalogue).invalid.length)) return false;
  return preservedTokens(source, /\$\{[^}]+\}|\{[A-Za-z][A-Za-z0-9]*\}/gu) ===
    preservedTokens(text, /\$\{[^}]+\}|\{[A-Za-z][A-Za-z0-9]*\}/gu) &&
    preservedTokens(source, /(?<![A-Za-z0-9])(?:USDC|Arc|x402|BUY|SKIP|CACHE)(?![A-Za-z0-9])/gu) ===
    preservedTokens(text, /(?<![A-Za-z0-9])(?:USDC|Arc|x402|BUY|SKIP|CACHE)(?![A-Za-z0-9])/gu);
}

/** Explicit developer preview only. A source binding is trusted input, never draft metadata.
 * Unreviewed critical prose/term references stay English even in an enabled preview.
 * previewKeys is the caller's explicit presentation scope, not locale release authority.
 */
export function validateNamespacePreview(draft: unknown, source: NamespaceSource, previewKeys: readonly string[]): Readonly<Record<string, string>> {
  const selected: Record<string, string> = Object.create(null);
  const fields = draftFields(draft);
  if (!namespaceNames.has(source.namespace) || !/^[a-f0-9]{64}$/u.test(source.sourceSha256) ||
    !(source.namespace === "core-inline" ? source.sourcePath === "lib/i18n/messages.ts" :
      new RegExp(`^locales/en/${source.namespace}\\.(?:ts|json|cjs)$`, "u").test(source.sourcePath)) ||
    !fields || Object.keys(fields).sort().join(",") !== "entries,review,sourcePath,sourceSha256,status" ||
    fields.status.value !== "machineDraft" || fields.review.value !== null ||
    fields.sourcePath.value !== source.sourcePath || fields.sourceSha256.value !== source.sourceSha256) return Object.freeze(selected);
  const entries = draftFields(fields.entries.value);
  if (!entries || Object.keys(entries).length > Object.keys(source.entries).length ||
    Object.keys(entries).some(key => !Object.hasOwn(source.entries, key))) return Object.freeze(selected);
  for (const [key, descriptor] of Object.entries(entries)) {
    const entry = draftFields(descriptor.value), english = source.entries[key];
    if (!entry || entry.source?.value !== english) continue;
    const names = Object.keys(entry).sort().join(",");
    if (names !== "source,text" || !previewKeys.includes(key) ||
      criticalCopy.test(`${source.namespace} ${key} ${english}`) || consentKey.test(key) || !validDraftText(key, english, entry.text.value)) continue;
    selected[key] = entry.text.value;
  }
  return Object.freeze(selected);
}
/** No import or loader call occurs without an explicit namespace request and enabled target.
 * Callers supply just the selected lazy chunk and its independently bound English leaves.
 */
export async function loadUiNamespaceCatalogue(locale: UiLocale, enabled: readonly UiLocale[], request: {
  source: NamespaceSource;
  previewKeys: readonly string[];
  load: () => Promise<unknown>;
} | undefined): Promise<Readonly<Record<string, string>>> {
  if (!request || locale === "en" || !preparedLocales.includes(locale) || !enabled.includes(locale) ||
    !namespaceNames.has(request.source.namespace) || !request.previewKeys.length) return Object.freeze({});
  try { return validateNamespacePreview(await request.load(), request.source, request.previewKeys); }
  catch { return Object.freeze({}); }
}
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
  const descriptors = draftFields(draft);
  if (!descriptors || Reflect.ownKeys(draft).length > 64 ||
    Object.keys(descriptors).some(key => !shellKeys.includes(key as ShellMessageKey))) return Object.freeze(selected);
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
    if (validateMessageCatalogue(candidate).invalid.length || !validDraftText(key, englishMessages[key], fields.text.value)) { report?.(locale, key); continue; }
    selected[key] = fields.text.value;
  }
  return Object.freeze(selected);
}

const loaders = {
  vi: () => import("@/locales/vi/ui-shell-preview").then(module => module.uiShellPreview),
  "zh-Hans": () => import("@/locales/zh-Hans/ui-shell-preview").then(module => module.uiShellPreview),
  es: () => import("@/locales/es/ui-shell-preview").then(module => module.uiShellPreview),
  "pt-BR": () => import("@/locales/pt-BR/ui-shell-preview").then(module => module.uiShellPreview),
  fr: () => import("@/locales/fr/ui-shell-preview").then(module => module.uiShellPreview),
  de: () => import("@/locales/de/ui-shell-preview").then(module => module.uiShellPreview),
  ja: () => import("@/locales/ja/ui-shell-preview").then(module => module.uiShellPreview),
  ko: () => import("@/locales/ko/ui-shell-preview").then(module => module.uiShellPreview),
  hi: () => import("@/locales/hi/ui-shell-preview").then(module => module.uiShellPreview),
  id: () => import("@/locales/id/ui-shell-preview").then(module => module.uiShellPreview),
};
/** No target import for English or a disabled/unsupported locale. Only the selected chunk loads. */
export async function loadUiShellCatalogue(locale: UiLocale, enabled: readonly UiLocale[], report = reportShellFallback,
  selectedLoaders: Partial<Record<Exclude<UiLocale, "en">, () => Promise<ShellDraft>>> = loaders): Promise<MessageCatalogue> {
  if (locale === "en" || !enabled.includes(locale) || !Object.hasOwn(selectedLoaders, locale)) return {};
  const load = selectedLoaders[locale];
  if (!load) return {};
  try { return validateShellDraft(locale, await load(), report); }
  catch { return Object.freeze({}); }
}
export function createShellMessages(locale: UiLocale, catalogue: MessageCatalogue = {}, report = reportShellFallback) {
  return createMessages(locale, catalogue, (selected, key) => { if (shellKeys.includes(key as ShellMessageKey)) report(selected, key as ShellMessageKey); });
}
