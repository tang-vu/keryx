"use client";

import { cloneElement, createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import { useLocale } from "./locale-context";
import { createMessages, englishMessages, type MessageCatalogue, type MessageKey } from "./messages";
import { createRichMessages } from "./rich-messages";
import { emptyUiPreview, getUiPreview, previewCopy, previewText } from "./ui-preview";

const english = { preview: emptyUiPreview, message: createMessages("en"), richMessage: createRichMessages("en") };
const UiCopyContext = createContext(english);

export function UiCopyProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  // LocaleProvider prepares both shell and page chunks before committing a
  // preference. Reading that snapshot avoids a mixed-language intermediate UI.
  const preview = getUiPreview(locale);
  const value = useMemo(() => {
    const catalogue: MessageCatalogue = {};
    for (const [key, source] of Object.entries(englishMessages)) {
      const text = previewText(preview, source);
      if (text !== source) catalogue[key as keyof MessageCatalogue] = text;
    }
    return { preview, message: createMessages(locale, catalogue), richMessage: createRichMessages(locale, catalogue) };
  }, [locale, preview]);
  return <UiCopyContext.Provider value={value}>{children}</UiCopyContext.Provider>;
}

export function useUiMessages() { return useContext(UiCopyContext).message; }
export function useUiRichMessages() { return useContext(UiCopyContext).richMessage; }

export function useUiCopy<T>(namespace: string, copy: T): T {
  const { preview } = useContext(UiCopyContext);
  return useMemo(() => previewCopy(preview, namespace, copy), [preview, namespace, copy]);
}

export function useUiCopyFunction<T extends (...args: never[]) => string>(namespace: string, copy: T): T {
  const { preview } = useContext(UiCopyContext);
  return useMemo(() => ((...args: Parameters<T>) => previewText(preview, copy(...args), [namespace])) as T, [preview, namespace, copy]);
}

/** Explicit authored-copy leaf for Server Components. Never wrap original report/user data. */
export function UiText({ source, namespaces }: { source: string | number | null; namespaces?: readonly string[] }) {
  const { preview } = useContext(UiCopyContext), { locale } = useLocale();
  if (typeof source !== "string") return source;
  const text = previewText(preview, source, namespaces);
  return <span lang={text === source ? "en" : locale}>{text}</span>;
}

export function UiMessage({ messageKey, values }: { messageKey: MessageKey; values?: Record<string, string | number> }) {
  const message = useUiMessages() as (key: MessageKey, values?: Record<string, string | number>) => string;
  const { locale } = useLocale();
  const text = message(messageKey, values);
  const original = (english.message as typeof message)(messageKey, values);
  return <span lang={text === original ? "en" : locale}>{text}</span>;
}

export function UiRichMessage({ messageKey, values }: { messageKey: MessageKey; values?: Record<string, ReactNode> }) {
  const rich = useUiRichMessages() as (key: MessageKey, values?: Record<string, ReactNode>) => ReactNode[];
  const { preview } = useContext(UiCopyContext), { locale } = useLocale();
  const source = englishMessages[messageKey];
  return <span lang={previewText(preview, source) === source ? "en" : locale}>{rich(messageKey, values)}</span>;
}

/** Native attributes cannot contain React nodes. Clone only these explicit copy attributes. */
export function UiAttributes({ children, names, namespaces }: {
  children: ReactElement<Record<string, unknown>>; names: readonly string[]; namespaces?: readonly string[];
}) {
  const { preview } = useContext(UiCopyContext);
  const props: Record<string, string> = {};
  for (const name of names) {
    const value = children.props[name];
    if (["title", "placeholder", "alt", "aria-label", "aria-description"].includes(name) && typeof value === "string") {
      props[name] = previewText(preview, value, namespaces);
    }
  }
  return cloneElement(children, props);
}
