"use client";
import { useMemo, type ReactNode } from "react";
import { useLocale } from "./locale-context";
import { UiCopyContext } from "./ui-copy-context";
import { createMessages, englishMessages, type MessageCatalogue } from "./messages";
import { createRichMessages } from "./rich-messages";
import { previewMessage } from "./ui-preview";
import { getUiPreview } from "./ui-preview-catalogues";

export function UiCopyProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  // The application prepares both shell and page chunks before this commit.
  const preview = getUiPreview(locale);
  const value = useMemo(() => {
    const catalogue: MessageCatalogue = {};
    for (const [key, source] of Object.entries(englishMessages)) {
      const text = previewMessage(preview, key, source);
      if (text !== source) catalogue[key as keyof MessageCatalogue] = text;
    }
    return { locale, preview, message: createMessages(locale, catalogue), richMessage: createRichMessages(locale, catalogue) };
  }, [locale, preview]);
  return <UiCopyContext.Provider value={value}>{children}</UiCopyContext.Provider>;
}
