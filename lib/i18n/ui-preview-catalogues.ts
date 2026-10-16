import type { UiLocale } from "./locales";
import { emptyUiPreview, type UiPreview } from "./ui-preview";

const loaders = {
  vi: () => import("@/locales/generated/vi-ui-preview").then(module => module.default),
  "zh-Hans": () => import("@/locales/generated/zh-Hans-ui-preview").then(module => module.default),
};
const cache = new Map<UiLocale, Promise<UiPreview>>();
const loaded = new Map<UiLocale, UiPreview>();
export function getUiPreview(locale: UiLocale): UiPreview { return loaded.get(locale) ?? emptyUiPreview; }

/** Load only the selected language; rejected chunks remain retryable. */
export function loadUiPreview(locale: UiLocale): Promise<UiPreview> {
  if (locale === "en") return Promise.resolve(emptyUiPreview);
  if (!cache.has(locale)) cache.set(locale, loaders[locale]().then(preview => {
    loaded.set(locale, preview); return preview;
  }).catch(error => { cache.delete(locale); throw error; }));
  return cache.get(locale)!;
}
