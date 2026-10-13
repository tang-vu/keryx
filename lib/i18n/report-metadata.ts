import { createMessages } from "./messages";
import type { Metadata } from "next";
import { publicReportLanguage } from "./public-metadata";

const copy = createMessages("en");

/** Replace root metadata rather than inheriting landing alternates/previews on a closed report. */
export function closedDispatchMetadata(): Metadata {
  return {
    title: copy("reportDispatch.fallbackTitle"), description: null, robots: { index: false, follow: false }, referrer: "no-referrer",
    alternates: { canonical: null, languages: {}, types: {} }, openGraph: null, twitter: null, other: {},
  };
}

/** QueryRun has no authoritative recorded answer-language field.
 * Question text, trace presentation, requested language and the English UI are not output-language proof.
 * A single public permalink remains independent of all those inputs. */
export function publicDispatchMetadata(input: {
  id: string; title: string; description: string; openGraphDescription: string;
}): Metadata {
  const language = publicReportLanguage({ id: input.id, visibility: "public", contentLanguage: null })!;
  return {
    title: input.title, description: input.description,
    alternates: { canonical: language.canonical, languages: {}, types: {} },
    other: { "DC.language": language.contentLanguage },
    openGraph: { title: input.title, description: input.openGraphDescription, url: language.canonical },
    twitter: { card: "summary_large_image", title: input.title, description: input.openGraphDescription },
  };
}

/** Complete English metadata variants; payment amounts and confidence remain recorded data. */
export function dispatchMetadataCopy(input: {
  historical: boolean; bibliographic: boolean; confidence?: string;
  count: number; spent: string; creators: string; excerpt: string;
}): { description: string; openGraph: string } {
  const history = input.historical ? "historical" : "current";
  const kind = input.bibliographic ? "bibliography" : input.confidence !== undefined ? "confidence" : "plain";
  const form = input.count === 1 ? "one" : "other";
  const values = { count: input.count, spent: input.spent, creators: input.creators,
    excerpt: input.excerpt, confidence: input.confidence ?? "" };
  return {
    description: copy(`reportMetadata.${history}.${kind}.${form}`, values),
    openGraph: copy(`reportMetadata.og.${history}.${kind}.${form}`, values),
  };
}
