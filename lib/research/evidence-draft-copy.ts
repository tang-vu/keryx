import copy from "../../locales/en/evidence-drafts.json";
export { copy as evidenceDraftCopy };

/** English source only; named interpolation, plain text and no locale activation. */
export function evidenceDraftCopyText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error("Missing evidence draft copy parameter");
    return String(values[key]);
  });
}
