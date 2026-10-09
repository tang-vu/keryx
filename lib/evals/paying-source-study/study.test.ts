import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { GatheredContent } from "../../llm/reasoning-engine";
import type { PaymentRecord, QueryRun } from "../../types";
import { sourceItemContentVersion } from "../../sources/source-item-asset";
import { BUDGETS, PRICES, canonical, microFromUsdc, parseCorpus, retainedItem, retainedVersion, sha256, usdcFromMicro } from "./contract";
import { gradeTrial } from "./rubric";
import { assertSimulated } from "./runner";
import { studyEnvironment } from "./offline-boundary";
import { sourceInputs } from "./source-inputs";
import type { StudyArtifact } from "./report";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(root, "fixtures/evals/studies/paying-source-corpus-v1.json"), "utf8"));
const corpus = parseCorpus(raw);
function observed(free = true) {
  const question = corpus.questions[0]; const doc = question.documents.find(d => d.free === free)!;
  const item = retainedItem(question.id, doc);
  const identity = { itemId: item.id, itemUrl: item.link, contentVersion: doc.contentVersion,
    contentReceipt: { bodyHash: doc.bodyHash, deliveryKind: "full_text" as const, storageMode: "db_plaintext" as const, plaintextBytes: Buffer.byteLength(doc.body) } };
  const read = { ...identity, sourceId: item.sourceId, sourceName: doc.name, marker: "S1", text: doc.body } as GatheredContent;
  const run = { id: "study-case", subClaims: ["capacity"], answer: `${doc.body} [S1]`,
    citations: [{ ...identity, marker: "S1", sourceId: item.sourceId }],
    evidence: [{ ...identity, claimIndex: 0, marker: "S1", sourceId: item.sourceId, quote: doc.body }] } as QueryRun;
  const payment = { queryId: run.id, sourceId: item.sourceId, itemId: item.id, contentVersion: doc.contentVersion,
    kind: "fetch", network: "eip155:5042002", txHash: null, settled: false, settlementStatus: "simulated", amountUsdc: 0.001 } as PaymentRecord;
  return { question, run, reads: [read], payments: free ? [] : [payment] };
}
describe("controlled study retained inputs and exact accounting", () => {
  it("pins all16 bodies to actual Keryx article versions and declares48cells", () => {
    expect(corpus.questions.length * BUDGETS.length * PRICES.length).toBe(48);
    for (const q of corpus.questions) for (const doc of q.documents)
      expect(doc.contentVersion).toBe(sourceItemContentVersion(retainedItem(q.id, doc)));
  });
  it.each([NaN, Infinity, -0.1, 0.0000001, 0.10000000000000002, Number.MAX_SAFE_INTEGER])("refuses unsafe legacy number %s", value => {
    expect(() => microFromUsdc(value)).toThrow();
  });
  it.each(["0", "1", ...BUDGETS, ...PRICES, "1000000"])("round-trips exact micro-USDC %s", value => {
    expect(microFromUsdc(usdcFromMicro(value))).toBe(BigInt(value));
  });
  it.each(["-1", "01", "1.5", "1000001", "1e3"])("refuses invalid bounded micro input %s", value => {
    expect(() => usdcFromMicro(value)).toThrow();
  });
  it("refuses stale bodies and required-fact declarations", () => {
    const stale = structuredClone(raw); stale.questions[0].documents[0].body += " tampered";
    expect(() => parseCorpus(stale)).toThrow("version mismatch");
    const wrong = structuredClone(raw); wrong.questions[0].facts[0].literal = "Unretained fact.";
    expect(() => parseCorpus(wrong)).toThrow("Required fact");
  });
  it("measures a genuine changed required fact only after rebinding retained bytes", () => {
    const changed = structuredClone(raw); const q = changed.questions[0];
    const doc = q.documents[0]; doc.body = doc.body.replace("42", "43");
    doc.bodyHash = `0x${sha256(doc.body)}`; doc.contentVersion = retainedVersion(retainedItem(q.id, doc));
    q.facts[0].literal = doc.body; q.facts[0].documentIds = [doc.id];
    const question = parseCorpus(changed).questions[0]; const old = observed();
    expect(gradeTrial(question, old.run, old.reads, old.payments).requiredFactCompleteness.numerator).toBe(0);
  });
  it("canonicalizes object order and retains null observations", () => {
    expect(canonical({ z: null, a: { b: 1 } })).toBe(canonical({ a: { b: 1 }, z: null }));
  });
});
describe("literal/read rubric refuses unbound support", () => {
  it("separates a quote from required-fact completeness", () => {
    const x = observed(); const grade = gradeTrial(x.question, x.run, x.reads, x.payments);
    expect(grade.literalReadBoundClaimRate.value).toBe(1);
    expect(grade.requiredFactCompleteness.value).toBe(0.5);
    expect(grade.rewardHhi).toBeNull(); expect(grade.semanticCorrectness).toBeNull();
  });
  it.each(["quote", "version", "url", "marker", "receipt", "read"])("rejects %s mismatch", field => {
    const x = observed();
    if (field === "quote") x.run.evidence![0].quote = "Invented quotation.";
    if (field === "version") x.run.evidence![0].contentVersion = `sha256:${"0".repeat(64)}`;
    if (field === "url") x.reads[0].itemUrl = "https://study.invalid/foreign";
    if (field === "marker") x.run.answer = x.run.answer.replace("[S1]", "[S2]");
    if (field === "receipt") x.reads[0].contentReceipt!.bodyHash = `0x${"0".repeat(64)}`;
    if (field === "read") x.reads = [];
    expect(gradeTrial(x.question, x.run, x.reads, x.payments).literalReadBoundClaimRate.numerator).toBe(0);
  });
  it("requires the exact paid read, run and version receipt", () => {
    const x = observed(false);
    expect(gradeTrial(x.question, x.run, x.reads, x.payments).literalReadBoundClaimRate.numerator).toBe(1);
    expect(gradeTrial(x.question, x.run, x.reads, []).literalReadBoundClaimRate.numerator).toBe(0);
    x.payments[0].queryId = "another-run";
    expect(gradeTrial(x.question, x.run, x.reads, x.payments).literalReadBoundClaimRate.numerator).toBe(0);
  });
  it("does not call an empty citation set perfect or measure zero-reward concentration", () => {
    const x = observed(); x.run.citations = []; x.run.evidence = [];
    const grade = gradeTrial(x.question, x.run, x.reads, []);
    expect(grade.literalReadBoundCitationRate.value).toBeNull(); expect(grade.topRewardShare).toBeNull();
  });
  it.each(["settled", "pending", "tx", "mainnet", "foreign-query"])("refuses %s payment before canonicalization", condition => {
    const p = observed(false).payments[0];
    if (condition === "settled") { p.settled = true; p.settlementStatus = "settled"; }
    if (condition === "pending") p.settlementStatus = "pending";
    if (condition === "tx") p.txHash = `0x${"1".repeat(64)}`;
    if (condition === "mainnet") p.network = "eip155:5042";
    if (condition === "foreign-query") p.queryId = "other";
    expect(() => assertSimulated(p, "study-case")).toThrow("non-simulation");
  });
});
describe("fresh-process outbound boundary and input scope", () => {
  it("denies HTTP/DNS/sockets and app child processes before I/O, including caught attempts", () => {
    const boundary = path.join(root, "lib/evals/paying-source-study/offline-boundary.ts");
    const program = `import {denyOutbound} from ${JSON.stringify(pathToFileURL(boundary).href)}; import {createRequire} from 'node:module';
      const r=createRequire(import.meta.url), b=denyOutbound();
      for(const f of [()=>fetch('https://study.invalid'),()=>r('node:https').get('https://study.invalid'),
        ()=>r('node:dns').resolveTxt('study.invalid',()=>{}),()=>new (r('node:dns').Resolver)().resolveSrv('study.invalid',()=>{}),
        ()=>new (r('node:dns').promises.Resolver)().reverse('127.0.0.1'),()=>r('node:net').connect(1,'127.0.0.1'),
        ()=>r('node:child_process').spawn(process.execPath,['-e','process.exit(99)'])]) { try { await f(); } catch {} }
      if(b.attempts()!==7)throw Error('denial count mismatch'); console.log('7 denied before I/O');`;
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program],
      { cwd: root, env: studyEnvironment(), encoding: "utf8", timeout: 20_000, windowsHide: true });
    expect(run.error).toBeUndefined(); expect(run.status, run.stderr).toBe(0); expect(run.stdout).toContain("7 denied before I/O");
  });
  it("refuses a direct worker with an undeclared runtime credential key", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-paying-source-study.mts", "--internal-worker"],
      { cwd: root, env: { ...studyEnvironment(), KERYX_STUDY_FORBIDDEN_SENTINEL: "not-a-secret" }, encoding: "utf8", timeout: 20_000, windowsHide: true });
    expect(run.status).not.toBe(0); expect(run.stderr).toContain("isolated fresh-process environment");
  });
  it("fingerprints only reachable literal source inputs, retaining unresolved forms", () => {
    const scope = sourceInputs(root, path.join(root, "scripts/eval-paying-source-study.mts"));
    expect(scope.files["lib/agent/run-agent.ts"]).toHaveLength(64);
    expect(scope.files["lib/payments/offline-gateway.ts"]).toHaveLength(64);
    expect(scope.files["lib/llm/heuristic-engine.ts"]).toHaveLength(64);
    expect(scope.files["app/proof/page.tsx"]).toBeUndefined();
    expect(scope.files["lib/evals/paying-source-study/study.test.ts"]).toBeUndefined();
  });
});
describe("retained actual matrix invariants and declared sensitivity", () => {
  it("keeps all48 cells, a fresh empty cache, zero live calls and integer budget caps", () => {
    const result = JSON.parse(fs.readFileSync(path.join(root, "fixtures/evals/studies/paying-source-results-v1.json"), "utf8")) as StudyArtifact;
    expect(result.trials).toHaveLength(48); expect(new Set(result.trials.map(t => t.id)).size).toBe(48);
    expect(result.outboundAttempts).toBe(0);
    for (const trial of result.trials) {
      expect(trial.proposals.flat().some(proposal => proposal.action === "CACHE")).toBe(false);
      expect(trial.output.paymentMode).toBe("offline"); expect(trial.output.settledPayments).toBe(0);
      expect(trial.metrics.semanticCorrectness).toBeNull(); expect(trial.metrics.explorationEffect).toBeNull();
      expect(BigInt(trial.metrics.fetchMicro) + BigInt(trial.metrics.citationMicro) <= BigInt(trial.budgetMicro)).toBe(true);
      if (trial.budgetMicro === "0") expect(trial.metrics.paidReads).toBe(0);
      for (const payment of trial.payments) assertSimulated(payment as PaymentRecord, trial.id);
    }
  });
  it("retains measured price/budget contrasts without promoting quotation to factual completeness", () => {
    const result = JSON.parse(fs.readFileSync(path.join(root, "fixtures/evals/studies/paying-source-results-v1.json"), "utf8")) as StudyArtifact;
    const paid = (predicate: (t: StudyArtifact["trials"][number]) => boolean) => result.trials.filter(predicate).reduce((sum, t) => sum + t.metrics.paidReads, 0);
    // These are observed prespecified fixture contrasts, not a monotonicity guarantee for arbitrary questions.
    expect(paid(t => t.paidPriceMicro === PRICES[0])).toBeGreaterThan(paid(t => t.paidPriceMicro === PRICES[2]));
    expect(paid(t => t.budgetMicro === BUDGETS[3])).toBeGreaterThan(paid(t => t.budgetMicro === BUDGETS[0]));
    expect(result.trials.some(t => t.metrics.literalReadBoundClaimRate.value === 1 && t.metrics.requiredFactCompleteness.value === 0)).toBe(true);
  });
});
