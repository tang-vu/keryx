"use client";

import { Fragment, useContext, type ReactNode } from "react";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { englishUiCopy, UiCopyContext } from "@/lib/i18n/ui-copy-context";
import { localeDirection } from "@/lib/i18n/locales";

const parameterNames = (template: string) => [...new Set([...template.matchAll(/\{([A-Za-z]+)\}/gu)].map(match => match[1]))].sort();

/** Authored evidence-draft templates only. Insert original nodes after lookup. */
export function EvidenceDraftText({ source, values }: { source: string; values: Record<string, ReactNode> }) {
  const translated = useUiCopy("evidence-drafts", source);
  const { locale } = useContext(UiCopyContext) ?? englishUiCopy;
  const names = parameterNames(source), parameters = Object.getOwnPropertyDescriptors(values);
  if (Reflect.ownKeys(parameters).some(name => typeof name !== "string" || !names.includes(name))) {
    throw new Error("Unexpected evidence draft display parameter");
  }
  for (const name of names) {
    if (!Object.hasOwn(parameters, name) || !("value" in parameters[name]) || parameters[name].value === undefined) {
      throw new Error("Missing evidence draft display parameter");
    }
  }
  // A malformed preview must not lose original slots or introduce new ones.
  const template = JSON.stringify(parameterNames(translated)) === JSON.stringify(names) ? translated : source;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of template.matchAll(/\{([A-Za-z]+)\}/gu)) {
    parts.push(template.slice(offset, match.index));
    parts.push(<Fragment key={`${match[1]}:${match.index}`}>{parameters[match[1]].value}</Fragment>);
    offset = match.index + match[0].length;
  }
  parts.push(template.slice(offset));
  if (locale === "en") return <>{parts}</>;
  const language = template === source ? "en" : locale;
  return <span lang={language} dir={locale === "ar" ? localeDirection(language) : undefined}>{parts}</span>;
}
