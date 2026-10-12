import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonical, microFromUsdc, parseCorpus, sha256 } from "./contract";
import { renderStudy, type StudyArtifact } from "./report";
import { assertSimulated } from "./runner";
import { sourceInputs } from "./source-inputs";
import type { PaymentRecord } from "../../types";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const text = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const corpus = parseCorpus(JSON.parse(text("fixtures/evals/studies/paying-source-corpus-v1.json")));
const prior = JSON.parse(text("fixtures/evals/studies/paying-source-results-v1.json")) as StudyArtifact;
const current = JSON.parse(text("fixtures/evals/studies/paying-source-results-v2.json")) as StudyArtifact;

describe("archive-integrated controlled study baseline", () => {
  it("binds the current literal source closure, lock and unchanged closed corpus", () => {
    const inputs = sourceInputs(root, path.join(root, "scripts/eval-paying-source-study.mts"));
    expect(current.runtimeSources).toEqual(inputs.files);
    expect(current.unresolvedSourceInputs).toEqual(inputs.unresolved);
    expect(current.lockSha256).toBe(sha256(text("package-lock.json")));
    expect(current.corpusSha256).toBe(sha256(canonical(corpus)));
    expect(current.corpusSha256).toBe(prior.corpusSha256);
    expect(current.version).toBe(1);
    expect(current.runtimeSources["lib/db/public-reference-archive.ts"]).toHaveLength(64);
  }, 60_000);

  it("preserves v1 rendering and exactly renders the separately dated current report", () => {
    expect(renderStudy(prior, corpus)).toBe(text("docs/studies/paying-for-sources-2026-10-09.md"));
    expect(renderStudy(current, corpus, "archive-v2")).toBe(text("docs/studies/paying-for-sources-2026-10-13.md"));
    expect(renderStudy(current, corpus, "archive-v2")).toContain("paying-source-results-v2.json");
  });

  it("preserves all 48 economic outcomes while permitting only isolated archive reads", () => {
    expect(current.trials).toHaveLength(48);
    expect(new Set(current.trials.map(trial => trial.id)).size).toBe(48);
    expect(current.design).toEqual(prior.design);
    expect(current.outboundAttempts).toBe(0);
    const original = new Map(prior.trials.map(trial => [trial.id, trial]));
    for (const trial of current.trials) {
      const old = original.get(trial.id)!;
      for (const field of ["proposals", "reevaluations", "reads", "payments", "output", "metrics"] as const)
        expect(trial[field], `${trial.id} ${field}`).toEqual(old[field]);
      expect(Object.keys(trial.effects).some(key => key.startsWith("db.denied."))).toBe(false);
      expect(trial.effects["db.queryPublicReferenceItems"]).toBeGreaterThan(0);
      expect(trial.output.settledPayments).toBe(0);
      expect(trial.output.pendingPayments).toBe(0);
      expect(trial.output.llmCalls ?? []).toHaveLength(0);
      const sum = trial.payments.reduce((total, payment) => {
        assertSimulated(payment as PaymentRecord, trial.id);
        return total + microFromUsdc(payment.amountUsdc);
      }, BigInt(0));
      expect(sum).toBe(microFromUsdc(trial.output.totalSpent));
      expect(sum <= BigInt(trial.budgetMicro)).toBe(true);
    }
  });
});
