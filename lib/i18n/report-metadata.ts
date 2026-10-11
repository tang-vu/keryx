import { createMessages } from "./messages";

const copy = createMessages("en");

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
