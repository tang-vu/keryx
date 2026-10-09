import copy from "../../locales/en/decision-reviews.json";
export { copy as decisionReviewCopy };
export function reviewCopyText(template: string, values: Record<string, string>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => values[name] ?? "");
}
