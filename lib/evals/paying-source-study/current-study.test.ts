import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { canonical, microFromUsdc, parseCorpus, sha256 } from "./contract";
import { renderStudy, type StudyArtifact } from "./report";
import { sourceInputs } from "./source-inputs";
import { assertSimulated } from "./runner";
import type { PaymentRecord } from "../../types";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const text = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const corpus = parseCorpus(JSON.parse(text("fixtures/evals/studies/paying-source-corpus-v1.json")));
const archived = JSON.parse(text("fixtures/evals/studies/paying-source-results-v2.json")) as StudyArtifact;
const current = JSON.parse(text("fixtures/evals/studies/paying-source-results-v3.json")) as StudyArtifact;

it("binds revision3 to the current literal source closure, lock and unchanged corpus", () => {
  const inputs = sourceInputs(root, path.join(root, "scripts/eval-paying-source-study.mts"));
  expect(current.runtimeSources).toEqual(inputs.files);
  expect(current.unresolvedSourceInputs).toEqual(inputs.unresolved);
  expect(current.lockSha256).toBe(sha256(text("package-lock.json")));
  expect(current.corpusSha256).toBe(sha256(canonical(corpus)));
  expect(current.corpusSha256).toBe(archived.corpusSha256);
  expect(current.version).toBe(1);
  expect(current.baselineRevision).toBe(3);
  expect(current.design).toEqual(archived.design);
}, 60_000);

it("exactly renders the separately dated v3 report and points to its own actual outputs", () => {
  const report = renderStudy(current, corpus, "counterparts-v3");
  expect(report).toBe(text("docs/studies/paying-for-sources-2026-11-04.md"));
  expect(report).toContain("paying-source-results-v3.json");
  expect(report).toContain("frozen historical records");
});

it("records changed counterpart attribution while retaining all48 simulated budgets and input decisions", () => {
  expect(current.trials).toHaveLength(48);
  expect(new Set(current.trials.map(trial => trial.id)).size).toBe(48);
  expect(current.outboundAttempts).toBe(0);
  const previous = new Map(archived.trials.map(trial => [trial.id, trial]));
  let changedPayments = 0;
  for (const trial of current.trials) {
    const old = previous.get(trial.id)!;
    for (const field of ["proposals", "reevaluations", "reads"] as const)
      expect(trial[field], `${trial.id} ${field}`).toEqual(old[field]);
    for (const metric of ["actualReads", "paidReads", "fetchMicro", "citationMicro"] as const)
      expect(trial.metrics[metric], `${trial.id} ${metric}`).toBe(old.metrics[metric]);
    if (canonical(trial.payments) !== canonical(old.payments)) changedPayments++;
    expect(trial.output.provenance).toStrictEqual({ version: 1, surface: "unknown", ownershipMethod: "unknown" });
    expect(Object.keys(trial.effects).some(key => key.startsWith("db.denied."))).toBe(false);
    expect(trial.effects["db.queryPublicReferenceItems"]).toBeGreaterThan(0);
    expect(trial.output.settledPayments).toBe(0);
    expect(trial.output.pendingPayments).toBe(0);
    expect(trial.output.llmCalls ?? []).toHaveLength(0);
    expect(trial.metrics.semanticCorrectness).toBeNull();
    expect(trial.metrics.realLlmSpend).toBeNull();
    const sum = trial.payments.reduce((total, payment) => {
      assertSimulated(payment as PaymentRecord, trial.id);
      return total + microFromUsdc(payment.amountUsdc);
    }, BigInt(0));
    expect(sum).toBe(microFromUsdc(trial.output.totalSpent));
    expect(sum <= BigInt(trial.budgetMicro)).toBe(true);
  }
  expect(changedPayments).toBe(12);
  expect(archived.trials.reduce((sum, trial) => sum + trial.metrics.completeFactIds.length, 0)).toBe(30);
  expect(current.trials.reduce((sum, trial) => sum + trial.metrics.completeFactIds.length, 0)).toBe(42);
});
