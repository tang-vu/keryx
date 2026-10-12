import copy from "../../locales/en/evidence-procurement.json";
export { copy as evidenceProcurementCopy };

/** English source only; named interpolation, plain text and no locale activation. */
export function evidenceProcurementCopyText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error("Missing evidence procurement copy parameter");
    return String(values[key]);
  });
}
