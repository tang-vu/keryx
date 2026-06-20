/**
 * The Keryx agent orchestrator — the brain.
 *
 * Streams a human-readable reasoning trace while it: decomposes the question, discovers candidate
 * sources, DECIDES buy/skip/cache (engine reasons value, code enforces the hard budget), fetches
 * via x402, stops early once it has read enough, synthesizes a cited answer, attributes contribution,
 * and settles a weighted citation reward to every source it actually used. Multi-author = split.
 *
 * Yields TraceStep events; returns the final QueryRun. Visible agency is the product.
 */

import { config } from "../config";
import type {
  Citation,
  Decision,
  PaymentOrigin,
  PaymentRecord,
  QueryRun,
  TracePhase,
  TraceStep,
} from "../types";
import type { GatheredContent, SourceCandidate } from "../llm";
import type { AgentDeps } from "./deps";
import { discoverExternalCandidates } from "./external-discovery";

export interface RunInput {
  question: string;
  budget?: number;
  queryId?: string;
  /** Who triggered this run — stamped on every payment so traction can separate genuine external
   *  usage (web askers, A2A callers) from the autonomous volume engine. Defaults to "engine". */
  origin?: PaymentOrigin;
}

export async function* runAgent(
  input: RunInput,
  deps: AgentDeps,
): AsyncGenerator<TraceStep, QueryRun, void> {
  const { engine, db, gateway } = deps;
  const budget = input.budget ?? config.defaultBudget;
  const queryId = input.queryId ?? crypto.randomUUID();
  // Stamp every payment from this run with its origin (engine | web | a2a) for honest traction split.
  const origin: PaymentOrigin = input.origin ?? "engine";
  const trace: TraceStep[] = [];
  const payments: PaymentRecord[] = [];
  let finalDecisions: Decision[] = [];
  let citations: Citation[] = [];

  const fetchBudget = budget * (1 - config.citationPoolRatio);
  const citationPool = budget * config.citationPoolRatio;
  let spentTolls = 0;

  function emit(phase: TracePhase, message: string, detail?: unknown): TraceStep {
    const s: TraceStep = { phase, message, detail, ts: Date.now() };
    trace.push(s);
    return s;
  }

  // 1) DECOMPOSE
  yield emit("decompose", `Breaking down: "${input.question}"`);
  const subClaims = await engine.decompose(input.question);
  yield emit("decompose", `Identified ${subClaims.length} sub-claim(s) to support`, subClaims);

  // 2) DISCOVER
  const sources = await db.listSources();
  const candidates: SourceCandidate[] = [];
  for (const s of sources) {
    const items = await db.getItems(s.id);
    const preview = items
      .slice(0, 4)
      .map((i) => `- ${i.title}: ${i.summary}`)
      .join("\n");
    candidates.push({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      fetchPrice: s.fetchPrice,
      cached: (await db.getCached(s.id)) !== null,
      preview,
    });
  }
  yield emit("discover", `Discovered ${candidates.length} registered source(s)`, candidates.map((c) => c.name));

  // Probe the live open x402 marketplace (Circle services) — real third-party endpoints the agent
  // can reason over alongside its creators. They settle off Keryx's Arc rail, so they're
  // discovery-only: evaluated and logged, never purchased.
  const external = await discoverExternalCandidates(input.question, subClaims);
  if (external.length > 0) {
    candidates.push(...external);
    const chains = [...new Set(external.flatMap((c) => c.external!.chains))].join(", ");
    yield emit(
      "discover",
      `Probed the live x402 marketplace — surfaced ${external.length} external endpoint(s)${chains ? ` (settle on ${chains})` : ""}. Off Keryx's Arc rail, so evaluated for discovery only.`,
      external.map((c) => c.name),
    );
  }

  if (candidates.length === 0) {
    return finish("No sources are registered yet — nothing to read.");
  }

  // 3) DECIDE (engine proposes value; code enforces budget AND the Arc-rail constraint)
  const proposed = await engine.decide({ question: input.question, subClaims, candidates, budget, spentSoFar: 0 });
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const isExternal = (id: string) => id.startsWith("ext:");
  const externalById = new Map(external.map((c) => [c.id, c]));

  // External marketplace endpoints are discovery-only: the engine judges their value, but the
  // orchestrator never settles to them (off Keryx's Arc rail) — enforced here like the budget cap,
  // so a model BUY can never leak into a real off-rail purchase.
  const internalProposed = proposed.filter((d) => !isExternal(d.sourceId));
  const externalProposed = proposed.filter((d) => isExternal(d.sourceId));

  // rank internal BUY proposals by value-per-dollar; flip to SKIP when the fetch budget can't cover them
  const ranked = [...internalProposed].sort(
    (a, b) => b.expectedValue / (b.price || 1e-9) - a.expectedValue / (a.price || 1e-9),
  );
  for (const d of ranked) {
    if (d.action === "BUY") {
      if (spentTolls + d.price > fetchBudget + 1e-9) {
        finalDecisions.push({
          ...d,
          action: "SKIP",
          rationale: `${d.rationale} — but the fetch budget ($${fetchBudget.toFixed(4)}) is exhausted, so skipping.`,
        });
        continue;
      }
      spentTolls += d.price; // reserve
    }
    finalDecisions.push(d);
  }

  // record external evaluations — always SKIP (discovery only), keeping the engine's value reasoning
  for (const d of externalProposed) {
    const ext = externalById.get(d.sourceId);
    const chain = ext?.external?.chains.join("/") || "another chain";
    const base = d.rationale?.trim() || "Topically considered.";
    finalDecisions.push({
      ...d,
      action: "SKIP",
      external: true,
      rationale: `${base} External x402 endpoint on ${chain} (~$${d.price.toFixed(4)}/call) — off Keryx's Arc rail, so discovered & evaluated but not purchased this run.`,
    });
  }

  for (const d of finalDecisions) {
    yield emit("decide", `${d.action} ${d.sourceName} — ${d.rationale}`, d);
  }

  // 4) FETCH (+ stop-early sufficiency)
  const gathered: GatheredContent[] = [];
  let markerN = 0;
  let fetchFailures = 0;
  const buys = finalDecisions.filter(
    (d) => (d.action === "BUY" || d.action === "CACHE") && !isExternal(d.sourceId),
  );

  // Ensure the spend wallet holds a settle-able Gateway balance before any payment
  // (real mode tops up from the funder once; offline is a no-op). Cached sources still earn
  // citation rewards, so fund whenever any source will be used.
  if (buys.length > 0) {
    const funded = await gateway.ensureFunded(budget);
    if (gateway.mode === "real") {
      yield emit("fetch", `Agent spend wallet ready: ${funded.address}${funded.depositTx ? ` (topped up ${short(funded.depositTx)})` : " (balance sufficient)"}`);
    }
  }

  for (const d of buys) {
    const source = sourceById.get(d.sourceId)!;
    const marker = `S${++markerN}`;
    if (d.action === "CACHE") {
      const cached = (await db.getCached(d.sourceId)) ?? "";
      gathered.push({ sourceId: source.id, sourceName: source.name, marker, text: cached });
      yield emit("fetch", `Reused cached ${source.name} (free) — ${marker}`);
    } else {
      yield emit("fetch", `Paying $${source.fetchPrice} toll to ${source.name}…`);
      try {
        const { content, payment } = await gateway.payFetch({ source, queryId });
        payment.origin = origin;
        await db.setCached(source.id, content);
        await db.recordPayment(payment);
        payments.push(payment);
        gathered.push({ sourceId: source.id, sourceName: source.name, marker, text: content });
        yield emit(
          "fetch",
          `Paid $${payment.amountUsdc} to ${source.name} ${payment.settled ? `(settled ${short(payment.txHash)})` : "(simulated)"} — ${marker}`,
          payment,
        );
      } catch (err) {
        // One toll failing (transient settlement error, exhausted grant, sign timeout) must not
        // kill the whole run — skip this source and answer from whatever was already read.
        fetchFailures++;
        const reason = err instanceof Error ? err.message : String(err);
        yield emit("fetch", `Couldn't buy ${source.name} (${reason}) — skipping it, continuing with what's read.`);
        continue;
      }

      // stop-early check after each paid read
      const suf = await engine.sufficiency({ question: input.question, subClaims, gathered });
      yield emit("sufficiency", suf.rationale, { sufficient: suf.sufficient });
      if (suf.sufficient) {
        const remaining = buys.slice(buys.indexOf(d) + 1).filter((x) => x.action === "BUY");
        if (remaining.length) {
          yield emit("sufficiency", `Stopping early — skipping ${remaining.length} further paid fetch(es) to save budget.`);
        }
        break;
      }
    }
  }

  if (gathered.length === 0) {
    return finish(
      fetchFailures > 0
        ? "The agent tried to buy sources but every purchase failed — likely an exhausted budget or a temporary settlement error. Nothing was charged for the failed attempts; please try again."
        : "The agent decided no source was worth paying for this question.",
    );
  }

  // 5) SYNTHESIZE
  yield emit("synthesize", `Synthesizing a grounded answer from ${gathered.length} source(s)…`);
  const synthesized = await engine.synthesize({ question: input.question, subClaims, gathered });
  const citedMarkers = synthesized.citedMarkers;
  // Guard against an empty body (e.g. the model returned unparseable JSON) so the run never
  // completes "done" showing a blank answer after real money was spent.
  const answer = synthesized.answer?.trim()
    ? synthesized.answer
    : `Read and paid for ${gathered.length} source(s) (${gathered.map((g) => g.sourceName).join(", ")}), but couldn't compose a written summary this run. Please try again.`;
  const citedSet = new Set(citedMarkers.length ? citedMarkers : gathered.map((g) => g.marker));
  const used = gathered.filter((g) => citedSet.has(g.marker));
  yield emit("synthesize", `Drafted answer citing ${used.length} source(s)`, { answer });

  // 6) ATTRIBUTE contribution weights
  const attributions = await engine.attribute({ question: input.question, answer, used });
  const weightById = new Map(attributions.map((a) => [a.sourceId, a]));
  citations = used.map((g) => {
    const a = weightById.get(g.sourceId);
    const weight = a?.weight ?? 1 / used.length;
    return {
      marker: g.marker,
      sourceId: g.sourceId,
      sourceName: g.sourceName,
      weight,
      reward: round(citationPool * weight),
      rationale: a?.rationale ?? "Equal contribution.",
    };
  });
  for (const c of citations) {
    yield emit("attribute", `${c.sourceName} contributed ${(c.weight * 100).toFixed(0)}% → reward $${c.reward}`, c);
  }

  // 7) SETTLE weighted citation rewards (split across authors)
  for (const c of citations) {
    const source = sourceById.get(c.sourceId)!;
    if (c.reward <= 0) continue;
    const authors = source.authors.length ? source.authors : [{ name: source.name, walletAddress: source.walletAddress, splitWeight: 1 }];
    for (const author of authors) {
      // TODO: settle from on-chain bp, not float splitWeight, to eliminate
      // rounding drift. Read contract.get(source.id).authors[i].basisPoints and compute
      // amount = round(c.reward * basisPoints / 10_000) directly from the integer.
      const amount = round(c.reward * author.splitWeight);
      if (amount <= 0) continue;
      const rationale = `Citation reward (${(c.weight * 100).toFixed(0)}% contribution${authors.length > 1 ? `, ${(author.splitWeight * 100).toFixed(0)}% author split` : ""}).`;
      try {
        const payment = await gateway.payCitation({ source, author, amount, weight: c.weight, queryId, rationale });
        payment.origin = origin;
        await db.recordPayment(payment);
        payments.push(payment);
        yield emit(
          "settle",
          `Settled $${payment.amountUsdc} citation reward → ${author.name} ${payment.settled ? `(${short(payment.txHash)})` : "(simulated)"}`,
          payment,
        );
      } catch (err) {
        // The answer is already written — a citation-settlement hiccup must not discard it.
        const reason = err instanceof Error ? err.message : String(err);
        yield emit("settle", `Couldn't settle the reward to ${author.name} (${reason}) — the answer stands.`, { error: reason });
      }
    }
  }

  return finish(answer);

  // ── helpers ──
  function finish(answer: string): QueryRun {
    const totalSpent = round(payments.reduce((s, p) => s + p.amountUsdc, 0));
    const run: QueryRun = {
      id: queryId,
      question: input.question,
      budget,
      engine: engine.name,
      subClaims,
      decisions: finalDecisions,
      citations,
      answer,
      totalSpent,
      totalToCreators: totalSpent, // 100% of spend reaches creator wallets
      trace,
      createdAt: new Date().toISOString(),
    };
    emit("done", `Done. Spent $${totalSpent} across ${payments.length} payment(s) to creators.`);
    return run;
  }
}

function short(tx?: string | null): string {
  return tx ? `${tx.slice(0, 10)}…` : "no-tx";
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
