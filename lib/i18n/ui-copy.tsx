"use client";

import { createElement, useContext, useMemo, type JSX, type ReactNode } from "react";
import { englishMessages, type MessageKey } from "./messages";
import { previewCopy, previewMessage, previewText } from "./ui-preview";
import { UiCopyContext, englishUiCopy as english } from "./ui-copy-context";

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

/** Explicit authored-copy leaf for Server Components. Never wrap original report/user data. */
export function UiText({ source, namespaces, plain = false }: { source: string | number | null; namespaces?: readonly string[]; plain?: boolean }) {
  const { preview, locale } = useContext(UiCopyContext) ?? english;
  if (typeof source !== "string") return source;
  const text = previewText(preview, source, namespaces);
  if (plain || locale === "en") return text;
  return <span lang={text === source ? "en" : locale}>{text}</span>;
}

export function UiMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, string | number>; plain?: boolean }) {
  const message = useUiMessages() as (key: MessageKey, values?: Record<string, string | number>) => string;
  const { locale } = useContext(UiCopyContext) ?? english;
  const text = message(messageKey, values);
  const original = (english.message as typeof message)(messageKey, values);
  if (plain || locale === "en") return text;
  return <span lang={text === original ? "en" : locale}>{text}</span>;
}

export function UiRichMessage({ messageKey, values, plain = false }: { messageKey: MessageKey; values?: Record<string, ReactNode>; plain?: boolean }) {
  const rich = useUiRichMessages() as (key: MessageKey, values?: Record<string, ReactNode>) => ReactNode[];
  const { preview, locale } = useContext(UiCopyContext) ?? english;
  const source = englishMessages[messageKey];
  if (plain || locale === "en") return rich(messageKey, values);
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
