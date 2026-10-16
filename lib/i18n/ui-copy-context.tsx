"use client";
import { createContext } from "react";
import { createMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { emptyUiPreview } from "./ui-preview";
import type { UiLocale } from "./locales";

/** Leaf renderers remain usable without wallet/network providers or locale assets. */
export const englishUiCopy = { locale: "en" as UiLocale, preview: emptyUiPreview,
  message: createMessages("en"), richMessage: createRichMessages("en") };
export const UiCopyContext = createContext<typeof englishUiCopy | null>(null);
