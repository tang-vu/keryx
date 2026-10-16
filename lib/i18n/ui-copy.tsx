"use client";

import { createElement, createContext, useContext, useMemo, type JSX, type ReactNode } from "react";
import { useLocale } from "./locale-context";
import { createMessages, englishMessages, type MessageCatalogue, type MessageKey } from "./messages";
import { createRichMessages } from "./rich-messages";
import { emptyUiPreview, getUiPreview, previewCopy, previewMessage, previewText } from "./ui-preview";

const english = { preview: emptyUiPreview, message: createMessages("en"), richMessage: createRichMessages("en") };
const UiCopyContext = createContext<typeof english | null>(null);

export function UiCopyProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  // LocaleProvider prepares both shell and page chunks before committing a
  // preference. Reading that snapshot avoids a mixed-language intermediate UI.
  const preview = getUiPreview(locale);
  const value = useMemo(() => {
    const catalogue: MessageCatalogue = {};
    for (const [key, source] of Object.entries(englishMessages)) {
      const text = previewMessage(preview, key, source);
      if (text !== source) catalogue[key as keyof MessageCatalogue] = text;
    }
    return { preview, message: createMessages(locale, catalogue), richMessage: createRichMessages(locale, catalogue) };
  }, [locale, preview]);
  return <UiCopyContext.Provider value={value}>{children}</UiCopyContext.Provider>;
}

export function useUiMessages() {
  const selected = useContext(UiCopyContext), shell = useLocale();
  return selected?.message ?? shell.message;
}
export function useUiRichMessages() { return (useContext(UiCopyContext) ?? english).richMessage; }

export function useUiCopy<T>(namespace: string, copy: T): T {
  const { preview } = useContext(UiCopyContext) ?? english;
  return useMemo(() => previewCopy(preview, namespace, copy), [preview, namespace, copy]);
}

export function useUiCopyFunction<T extends (...args: never[]) => string>(namespace: string, copy: T): T {
  const { preview } = useContext(UiCopyContext) ?? english;
  return useMemo(() => ((...args: Parameters<T>) => previewText(preview, copy(...args), [namespace])) as T, [preview, namespace, copy]);
}

/** Explicit authored-copy leaf for Server Components. Never wrap original report/user data. */
export function UiText({ source, namespaces, plain = false }: { source: string | number | null; namespaces?: readonly string[]; plain?: boolean }) {
  const { preview } = useContext(UiCopyContext) ?? english, { locale } = useLocale();
  if (typeof source !== "string") return source;
  const text = previewText(preview, source, namespaces);
  if (plain) return text;
  return <span lang={text === source ? "en" : locale}>{text}</span>;
}

export function UiMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, string | number>; plain?: boolean }) {
  const message = useUiMessages() as (key: MessageKey, values?: Record<string, string | number>) => string;
  const { locale } = useLocale();
  const text = message(messageKey, values);
  const original = (english.message as typeof message)(messageKey, values);
  if (plain) return text;
  return <span lang={text === original ? "en" : locale}>{text}</span>;
}

export function UiRichMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, ReactNode>; plain?: boolean }) {
  const rich = useUiRichMessages() as (key: MessageKey, values?: Record<string, ReactNode>) => ReactNode[];
  const { preview } = useContext(UiCopyContext) ?? english, { locale } = useLocale();
  const source = englishMessages[messageKey];
  if (plain) return rich(messageKey, values);
  return <span lang={previewMessage(preview, messageKey, source) === source ? "en" : locale}>{rich(messageKey, values)}</span>;
}

/** Own the native element; Server Component children are opaque Flight nodes. */
export function UiElement({ as, children, attributes, names, namespaces }: {
  as: keyof JSX.IntrinsicElements; children?: ReactNode; attributes: Record<string, unknown>;
  names: readonly string[]; namespaces?: readonly string[];
}) {
  const { preview } = useContext(UiCopyContext) ?? english;
  const props: Record<string, string> = {};
  for (const name of names) {
    const value = attributes[name];
    if (["title", "placeholder", "alt", "aria-label", "aria-description"].includes(name) && typeof value === "string") {
      props[name] = previewText(preview, value, namespaces);
    }
  }
  return createElement(as, { ...attributes, ...props }, children);
}
