import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { AnswerCard } from "../../components/keryx/answer-card";
import { deriveConfidence } from "./confidence";
import { projectRunConfidence } from "../research/recorded-confidence";
import { presentationRun } from "../research/presentation.test-fixture";
import { validatePrivacyRun } from "../run-privacy/contracts";

const id = "eaf71ac0-cbf3-4c6d-b691-0c45ffcb6ba1";
const malformed: { name: string; confidence: unknown }[] = [
  { name: "object", confidence: { level: "High", reason: { privateNote: "PRIVATE_CONFIDENCE_VALUE" } } },
  { name: "object nested in an array", confidence: { level: "Moderate", reason: ["legacy", { privateNote: "PRIVATE_CONFIDENCE_VALUE" }] } },
  { name: "unconvertible JSON object", confidence: { level: "Low", reason: { toString: null } } },
  { name: "numeric explanation", confidence: { level: "High", reason: 42 } },
  { name: "boolean explanation", confidence: { level: "Moderate", reason: true } },
  { name: "missing explanation", confidence: { level: "High" } },
  { name: "null explanation", confidence: { level: "Low", reason: null } },
  { name: "array explanation", confidence: { level: "High", reason: [] } },
];

function admitted(confidence: unknown) {
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id, confidence,
    trace: [{ phase: "verdict", ts: 1, message: "Older assessment", detail: { level: "High", reason: "OLDER_VERDICT_MUST_NOT_REVIVE" } }] })), id);
}

it.each(malformed)("renders the admitted original report with an unavailable $name assessment", ({ confidence }) => {
  const run = admitted(confidence), before = JSON.stringify(run);
  expect(projectRunConfidence(run)).toBeUndefined();
  const html = renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, showFeedback: false }));
  const dom = new JSDOM(html);
  try {
    const body = dom.window.document.body;
    expect(body.textContent).toContain("Exact “quote” <unmodified> & 日本語");
    expect(body.textContent).toContain("0.000001");
    expect([...body.querySelectorAll("span")].filter(node => ["High", "Moderate", "Low"].includes(node.textContent ?? ""))).toHaveLength(0);
    expect(body.textContent).not.toContain("PRIVATE_CONFIDENCE_VALUE");
    expect(body.textContent).not.toContain("OLDER_VERDICT_MUST_NOT_REVIVE");
    expect(deriveConfidence(run)).toBeNull();
    expect(JSON.stringify(run)).toBe(before);
  } finally { dom.window.close(); }
});

it.each(["High", "Moderate", "Low"] as const)("retains the exact valid stored %s assessment in the real report", level => {
  const run = admitted({ level, reason: "Original stored explanation" }), before = JSON.stringify(run);
  expect(deriveConfidence(run)).toBe(run.confidence);
  const dom = new JSDOM(renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, showFeedback: false })));
  try {
    expect([...dom.window.document.querySelectorAll("span")].some(node => node.textContent === level)).toBe(true);
    expect(dom.window.document.body.textContent).toContain("Original stored explanation");
    expect(dom.window.document.body.textContent).not.toContain("OLDER_VERDICT_MUST_NOT_REVIVE");
    expect(JSON.stringify(run)).toBe(before);
  } finally { dom.window.close(); }
});
