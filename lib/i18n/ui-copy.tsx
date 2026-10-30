"use client";

import { createElement, useContext, useMemo, type JSX, type ReactNode } from "react";
import { englishMessages, type MessageKey } from "./messages";
import { previewCopy, previewMessage, previewText } from "./ui-preview";
import { UiCopyContext, englishUiCopy as english } from "./ui-copy-context";
import { localeDirection } from "./locales";

export function useUiMessages(fallback = english.message) {
  return useContext(UiCopyContext)?.message ?? fallback;
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

function literalContent(text: string, source: string, literals: readonly string[]): ReactNode {
  const allowed = [...new Set(literals)].filter(token => token.length > 0 && source.includes(token));
  if (!allowed.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let found = -1, literal = "";
    for (const token of allowed) {
      const index = text.indexOf(token, cursor);
      if (index >= 0 && (found < 0 || index < found || index === found && token.length > literal.length)) {
        found = index; literal = token;
      }
    }
    if (found < 0) { parts.push(text.slice(cursor)); break; }
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(<bdi key={`${found}:${literal}`} lang="en" dir="ltr" translate="no" style={{ display: "inline-block", whiteSpace: "nowrap" }}>{literal}</bdi>);
    cursor = found + literal.length;
  }
  return parts;
}

/** Explicit authored-copy leaf for Server Components. Never wrap original report/user data.
 * Optional literals must be exact technical tokens from that authored English source. */
export function UiText({ source, namespaces, plain = false, literals }: { source: string | number | null; namespaces?: readonly string[]; plain?: boolean; literals?: readonly string[] }) {
  const { preview, locale } = useContext(UiCopyContext) ?? english;
  if (typeof source !== "string") return source;
  const text = previewText(preview, source, namespaces);
  if (plain || locale === "en") return text;
  const language = text === source ? "en" : locale;
  const content = text === source || !literals ? text : literalContent(text, source, literals);
  return <span lang={language} dir={locale === "ar" ? localeDirection(language) : undefined}>{content}</span>;
}

export function UiMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, string | number>; plain?: boolean }) {
  const message = useUiMessages() as (key: MessageKey, values?: Record<string, string | number>) => string;
  const { locale } = useContext(UiCopyContext) ?? english;
  const text = message(messageKey, values);
  const original = (english.message as typeof message)(messageKey, values);
  if (plain || locale === "en") return text;
  const language = text === original ? "en" : locale;
  return <span lang={language} dir={locale === "ar" ? localeDirection(language) : undefined}>{text}</span>;
}

export function UiRichMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, ReactNode>; plain?: boolean }) {
  const rich = useUiRichMessages() as (key: MessageKey, values?: Record<string, ReactNode>) => ReactNode[];
  const { preview, locale } = useContext(UiCopyContext) ?? english;
  const source = englishMessages[messageKey];
  if (plain || locale === "en") return rich(messageKey, values);
  const language = previewMessage(preview, messageKey, source) === source ? "en" : locale;
  return <span lang={language} dir={locale === "ar" ? localeDirection(language) : undefined}>{rich(messageKey, values)}</span>;
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
