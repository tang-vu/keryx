"use client";
import { useId } from "react";
import { useLocale } from "@/lib/i18n/locale-context";
import { uiPreferenceCopy } from "@/locales/en/ui-preference";
import type { UiLocale } from "@/lib/i18n/locales";

/** Reused in desktop header, mobile menu and footer; native select provides keyboard/AT behavior. */
export function LanguageSwitcher() {
  const id = useId(), { locale, ready, status, enabledLocales, selectLocale } = useLocale();
  const preview = locale !== "en";
  return <div className="max-w-full py-1 font-mono text-[10px] text-ink-3" lang="en" data-language-switcher>
    <label htmlFor={id} className="sr-only">{uiPreferenceCopy("language")}</label>
    <select id={id} value={locale} disabled={!ready} onChange={event => selectLocale(event.target.value as UiLocale)}
      title={preview ? uiPreferenceCopy("previewNotice") : undefined}
      aria-describedby={`${id}-notice ${id}-status`} className="min-h-11 max-w-full border border-line bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal">
      {enabledLocales.map(value => <option key={value} value={value} lang={value}>{uiPreferenceCopy(value === "en" ? "english" : value === "vi" ? "vietnamesePreview" : "chinesePreview")}</option>)}
    </select>
    <p id={`${id}-notice`} className={preview ? "mt-1 max-w-[32ch] text-[10px] normal-case lg:sr-only" : "sr-only"}>
      {uiPreferenceCopy(preview ? "previewNotice" : "englishOnly")}
    </p>
    <p id={`${id}-status`} role="status" aria-live="polite" className="sr-only">{status ? uiPreferenceCopy(status) : ""}</p>
  </div>;
}
