import { MAX_RESEARCH_TARGETS } from "./research-target-limits";

interface CallerPart { text: string; role: string }
type ScopePart = CallerPart & { role: "target" | "scope" | "delivery" | "framing" };
type Result = { claims: string[] } | { reason: "invalid_output" | "expanded_output" };

/** Rebind trimmed boundaries without accepting omitted or model-authored wording. */
export function restoreCallerParts<T extends CallerPart>(question: string, parts: T[]): CallerPart[] | null {
  if (parts.map(part => part.text).join("") === question) return parts;
  if (question.length > 64 * 600) return null;
  const restored: CallerPart[] = [];
  let offset = 0;
  for (const part of parts) {
    const text = part.text.trim();
    if (!text) { if (part.role !== "framing") return null; continue; }
    const whitespace = question.slice(offset).match(/^\s*/u)![0];
    if (whitespace) { restored.push({ text: whitespace, role: "framing" }); offset += whitespace.length; }
    if (!question.startsWith(text, offset)) return null;
    restored.push({ text, role: part.role }); offset += text.length;
  }
  const trailing = question.slice(offset);
  if (trailing.trim()) return null;
  if (trailing) restored.push({ text: trailing, role: "framing" });
  return restored;
}

/** Preserve each whole caller URL in shared scope, including its exact version/query. */
export function callerUrlsInScope(question: string, parts: CallerPart[]): boolean {
  let offset = 0;
  const scopeIntervals = parts.flatMap(part => {
    const start = offset; offset += part.text.length;
    return part.role === "scope" ? [{ start, end: offset }] : [];
  });
  for (const match of question.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/giu)) {
    let token = match[0];
    const before = question[match.index - 1];
    if (!before || !/[<"'`]/u.test(before)) token = token.replace(/[.,;]+$/u, "");
    while (token.endsWith(")") && (token.match(/\)/gu)?.length ?? 0) > (token.match(/\(/gu)?.length ?? 0)) token = token.slice(0, -1);
    while (token.endsWith("]") && !token.includes("[")) token = token.slice(0, -1);
    if (!before || !/[<"'`]/u.test(before)) token = token.replace(/[.,;]+$/u, "");
    if (!scopeIntervals.some(part => part.start <= match.index && part.end >= match.index + token.length)) return false;
  }
  return true;
}

/** The model classifies caller spans; it cannot author extra completion requirements.
 * Literal provenance does not prove correct roles, complete coverage or factual truth.
 * Delivery instructions stay in the original question passed to synthesis. */
export function callerScopeResearchPlan(question: string, raw: unknown, constraints: readonly string[]): Result {
  const invalid: Result = { reason: "invalid_output" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid;
  const proposal = raw as Record<string, unknown>;
  const roles = ["target", "scope", "delivery", "framing"];
  if (Object.keys(proposal).some(key => key !== "parts") || !Array.isArray(proposal.parts) ||
    proposal.parts.length === 0 || proposal.parts.length > 64 || !proposal.parts.every(part =>
      part && typeof part === "object" && !Array.isArray(part) && Object.keys(part).length === 2 &&
      typeof part.text === "string" && part.text.length > 0 && part.text.length <= 600 && part.text.isWellFormed() &&
      typeof part.role === "string" && roles.includes(part.role))) return invalid;
  const parts = restoreCallerParts(question, proposal.parts as ScopePart[]);
  if (!parts || !callerUrlsInScope(question, parts)) return invalid;
  const texts = (role: string) => parts.filter(part => part.role === role).map(part => part.text.trim());
  const targets = texts("target"), scope = texts("scope"), delivery = texts("delivery");
  if (!targets.length || targets.some(text => !text) || scope.some(text => !text) || delivery.some(text => !text) ||
    new Set(targets).size !== targets.length || constraints.some(value => ![...scope, ...delivery].includes(value.trim()))) return invalid;
  if (targets.length > MAX_RESEARCH_TARGETS) return { reason: "expanded_output" };
  const claims = targets.map(target => target + (scope.length ? `\n${scope.join(" ")}` : ""));
  if (claims.some(claim => claim.length > 600) || new Set(claims).size !== claims.length) return invalid;
  return { claims };
}
