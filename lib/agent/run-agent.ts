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
  ClaimCoverageRecord,
  Citation,
  Confidence,
  Decision,
  EvidenceRecord,
  PaymentOrigin,
  McpClientChannel,
  PaymentRecord,
  PreviewCoverage,
  QueryRun,
  ResearchMode,
  Source,
  SourceItem,
  ArticleOfferRef,
  TracePhase,
  TraceStep,
} from "../types";
import type {
  GatheredContent,
  SourceCandidate,
  SufficiencyResult,
} from "../llm";
import { effectiveEngineName, reasoningAttempts } from "../llm/resilient-engine";
import type { AgentDeps } from "./deps";
import { discoverExternalCandidates } from "./external-discovery";
import { buildDecisionContext, saveMemory } from "./query-memory";
import { dispatchCitationNotify } from "../notify/citation-webhook";
import { dispatchCitationEmail } from "../notify/citation-email";
import { allocateSplit } from "../payments/split-allocation";
import {
  paymentCountsAsSpent,
  paymentSettlementStatus,
  pendingPaymentFrom,
  settledPaymentFrom,
} from "../payments/payment-state";
import { sendAlert } from "../notify/alert";
import { normalizePreviewDepth, previewSummary } from "../sources/preview-depth";
import { isCacheFresh, newestPublishedAt } from "./cache-freshness";
import {
  selectRelevantSourceItem,
  sourceItemAssetId,
  sourceItemCacheKey,
  sourceItemContentVersion,
  sourceItemIdentity,
} from "../sources/source-item-asset";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import { resolveValidArticleOffer } from "../offers/resolve-article-offer";
import {
  buildEvidenceLedger,
  MIN_REWARD_SUPPORT,
  removeUnsupportedCitationMarkers,
} from "./evidence-ledger";
import {
  buildPreviewCoverage,
  normalizeClaimTargets,
  previewCoverageBlockReason,
} from "./coverage-precheck";
import { recordActivationEvent } from "../activation";

export interface RunInput {
  question: string;
  budget?: number;
  /** Quick bounds attention/expansion for latency; Deep preserves the full research pass. */
  researchMode?: ResearchMode;
  queryId?: string;
  /** Who triggered this run — stamped on every payment so traction can separate genuine external
   *  usage (web, A2A, MCP) from the autonomous volume engine. Defaults to "engine". */
  origin?: PaymentOrigin;
  /** Normalized MCP setup channel. Self-declared telemetry, never caller authority. */
  mcpClient?: McpClientChannel;
  /** Stable actor verified by the server (SIWE/API key). Never accept an unverified client value. */
  asker?: string;
  /** Catalog model id the asker picked (model-catalog.ts). Read by collectRun when it builds
   *  deps; unknown/unset → default engine. Every pick falls back so the run always answers. */
  model?: string;
  /** Set when this dispatch re-asks a question the corpus previously left under-covered. Recorded
   *  on the run so the demand board can tell an independent dispatch from the agent's own retry. */
  retryOf?: string;
  /**
   * Exact creator response admitted for a wanted-claim retry. This is discovery coordination,
   * never a forced purchase or payout authority: the asset is guaranteed a candidate slot, while
   * the reasoning engine still emits BUY/SKIP and every payment still resolves registry terms.
   */
  targetAsset?: {
    sourceId: string;
    itemId: string;
    contentVersion: string;
    articleOfferId?: string;
  };
}

interface InternalAsset {
  candidate: SourceCandidate;
  source: Source;
  item?: SourceItem;
  cacheKey: string;
  priceUsdc: number;
  listPriceUsdc: number;
  offer?: ArticleOfferRef;
}

export async function* runAgent(
  input: RunInput,
  deps: AgentDeps,
): AsyncGenerator<TraceStep, QueryRun, void> {
  const { engine, db, gateway } = deps;
  const startedAt = Date.now();
  const budget = input.budget ?? config.defaultBudget;
  const queryId = input.queryId ?? crypto.randomUUID();
  // Stamp every payment from this run with its origin for the honest traction split.
  const origin: PaymentOrigin = input.origin ?? "engine";
  const trace: TraceStep[] = [];
  const payments: PaymentRecord[] = [];
  let paymentAttempts = 0;
  let settledPayments = 0;
  let pendingPayments = 0;
  let finalDecisions: Decision[] = [];
  let citations: Citation[] = [];
  let evidence: EvidenceRecord[] = [];
  let claimCoverage: ClaimCoverageRecord[] = [];
  let previewCoverage: PreviewCoverage | undefined;
  let evidenceMeasured = false;
  // Set once the verdict is computed; read by finish(). A `let` (not the closure-captured const)
  // so the early-return paths, which never reach the verdict step, still produce a valid run.
  let runConfidence: Confidence | undefined;

  const fetchBudget = budget * (1 - config.citationPoolRatio);
  const citationPool = budget * config.citationPoolRatio;
  const researchMode: ResearchMode = input.researchMode ?? "deep";
  const attentionLimit =
    researchMode === "quick" ? Math.min(2, config.maxAttentionSources) : config.maxAttentionSources;
  const reevaluateRounds = researchMode === "quick" ? 0 : config.reevaluateRounds;
  let spentTolls = 0;

  function emit(phase: TracePhase, message: string, detail?: unknown): TraceStep {
    const s: TraceStep = { phase, message, detail, ts: Date.now() };
    trace.push(s);
    return s;
  }

  async function persistPaymentRecord(payment: PaymentRecord): Promise<string | null> {
    try {
      await db.recordPayment(payment);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void sendAlert(
        "payment ledger write failed",
        `${payment.kind} $${payment.amountUsdc} for ${payment.sourceName} (${payment.queryId}): ${message}`,
      );
      return message;
    }
  }

  // 1) DECOMPOSE
  yield emit("decompose", `Breaking down: "${input.question}"`);
  const subClaims = await engine.decompose(input.question);
  yield emit("decompose", `Identified ${subClaims.length} sub-claim(s) to support`, subClaims);
  yield emit(
    "decompose",
    researchMode === "quick"
      ? `Quick mode: at most ${attentionLimit} paid/cached reads, with no marketplace probe or gap-expansion round.`
      : `Deep mode: up to ${attentionLimit} paid/cached reads plus one bounded gap-expansion pass when needed.`,
    { researchMode, attentionLimit, reevaluateRounds },
  );

  // 2) DISCOVER
  // Earning gate: only feed-ownership-verified sources are discoverable to the agent, so a wallet
  // that lists a feed it doesn't own (and can't put `keryx-verify:<wallet>` in) is never read,
  // cited, or paid. Listing stays permissionless — unverified rows show in the directory, just
  // off the money path. Undefined verified = grandfathered true (curated seed + pre-flag rows).
  const allSources = await db.listSources();
  const sources = allSources.filter((s) => s.verified !== false);
  const unverifiedCount = allSources.length - sources.length;
  const candidates: SourceCandidate[] = [];
  const assetById = new Map<string, InternalAsset>();
  // Sources whose cached copy still matches what they publish. A copy the source has published
  // past is not a free read of it any more, so it is offered as a paid fetch instead — otherwise
  // the first purchase of a source would be the last toll it ever earned, and every later answer
  // would be built from text the source has moved on from. See ./cache-freshness.ts.
  const freshCache = new Set<string>();
  let signedOfferCount = 0;
  for (const s of sources) {
    const terms = await sourceFetchTerms(s);
    if (!terms.active) continue;
    const items = await db.getItems(s.id);
    // Honor the creator's preview-depth: the agent scores on exactly what a paying reader would see
    // for free. Article selection never inspects paid full text.
    const depth = normalizePreviewDepth(s.previewDepth);
    const target = input.targetAsset?.sourceId === s.id ? input.targetAsset : undefined;
    const item = target
      ? items.find((candidate) => candidate.id === target.itemId) ?? null
      : selectRelevantSourceItem(input.question, subClaims, s.tags, items);

    if (target && (!item || sourceItemContentVersion(item) !== target.contentVersion)) {
      throw new Error("wanted response article changed or disappeared before discovery");
    }

    if (item) {
      const id = sourceItemAssetId(item.id);
      const identity = sourceItemIdentity(item);
      const cacheKey = sourceItemCacheKey(s.id, item);
      const cached = Boolean(await db.getCachedAt(cacheKey));
      if (cached) freshCache.add(id);
      const summary = previewSummary(item.summary, depth);
      const resolvedOffer = await resolveValidArticleOffer(db, s, item, terms);
      if (target?.articleOfferId && resolvedOffer?.offer.id !== target.articleOfferId) {
        throw new Error("wanted response article offer expired or was replaced before discovery");
      }
      if (resolvedOffer) signedOfferCount++;
      const priceUsdc = resolvedOffer?.ref.priceUsdc ?? terms.listPriceUsdc;
      const candidate: SourceCandidate = {
        id,
        sourceId: s.id,
        item: identity,
        name: `${s.name} — ${item.title}`,
        description: s.description,
        tags: s.tags,
        fetchPrice: priceUsdc,
        ...(resolvedOffer
          ? {
              offer: {
                id: resolvedOffer.offer.id,
                listPriceUsdc: terms.listPriceUsdc,
                expiresAt: resolvedOffer.offer.expiresAt,
              },
            }
          : {}),
        cached,
        preview: summary ? `- ${item.title}: ${summary}` : `- ${item.title}`,
      };
      // Put the offered work first so large catalogs cannot hide it from a bounded model prompt.
      // Position is not a recommendation: the engine still prices and decides it normally.
      if (target) candidates.unshift(candidate);
      else candidates.push(candidate);
      assetById.set(id, {
        candidate,
        source: s,
        item,
        cacheKey,
        priceUsdc,
        listPriceUsdc: terms.listPriceUsdc,
        offer: resolvedOffer
          ? { ...resolvedOffer.ref, proof: resolvedOffer.offer }
          : undefined,
      });
      continue;
    }

    // Historical source rows with no articles retain the original source-level purchase path.
    const cached = isCacheFresh(
      await db.getCachedAt(s.id),
      newestPublishedAt(items),
      Date.now(),
    );
    if (cached) freshCache.add(s.id);
    const candidate: SourceCandidate = {
      id: s.id,
      sourceId: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      fetchPrice: terms.listPriceUsdc,
      cached,
      preview: s.description,
    };
    candidates.push(candidate);
    assetById.set(s.id, {
      candidate,
      source: s,
      cacheKey: s.id,
      priceUsdc: terms.listPriceUsdc,
      listPriceUsdc: terms.listPriceUsdc,
    });
  }

  if (input.targetAsset) {
    const admitted = assetById.get(sourceItemAssetId(input.targetAsset.itemId));
    if (!admitted || admitted.source.id !== input.targetAsset.sourceId) {
      throw new Error("wanted response source is not active, verified, or payable");
    }
  }
  if (input.targetAsset) {
    yield emit(
      "discover",
      "Admitted the creator's exact article response as a candidate; the agent still decides BUY or SKIP",
      input.targetAsset,
    );
  }
  yield emit(
    "discover",
    `Discovered ${candidates.length} verified source(s)${unverifiedCount > 0 ? ` — skipped ${unverifiedCount} unverified (feed ownership unproven, off the money path)` : ""}`,
    candidates.map((c) => c.name),
  );
  if (signedOfferCount > 0) {
    yield emit(
      "discover",
      `Verified ${signedOfferCount} creator-signed article offer${signedOfferCount === 1 ? "" : "s"}; discounted prices are version-bound and capped by SourceRegistry.`,
      { signedOfferCount },
    );
  }

  // Probe the live open x402 marketplace (Circle services) — real third-party endpoints the agent
  // can reason over alongside its creators. They settle off Keryx's Arc rail, so they're
  // discovery-only: evaluated and logged, never purchased.
  const external =
    researchMode === "deep"
      ? await discoverExternalCandidates(input.question, subClaims)
      : [];
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
  // Load query memory — aggregated source performance from past runs
  const candidateIds = sources.map((s) => s.id);
  let memoryContext: string | undefined;
  let reputationContext: string | undefined;
  try {
    // One read of the log serves both halves: the per-source track record and the composite
    // reputation are two readings of the same scored set, and re-loading it would only risk them
    // disagreeing. Both are scoped to past runs about *this* subject, so both are absent on a
    // question the corpus has not been asked before — see query-memory.ts.
    const ctx = await buildDecisionContext(db, input.question, sources.map((s) => ({ id: s.id, name: s.name })));
    memoryContext = ctx.memory;
    reputationContext = ctx.reputation;
    if (memoryContext) {
      yield emit(
        "discover",
        `Recalled ${ctx.sample} past run${ctx.sample === 1 ? "" : "s"} on this subject — how these sources performed when they were available.`,
        { memory: true, sample: ctx.sample },
      );
    }
    if (reputationContext) {
      yield emit("discover", "ERC-8004 reputation loaded — composite scores on this subject.", { reputation: true });
    }
  } catch {
    // Memory is best-effort — never block a run on memory load failure
  }
  // Combine memory + reputation into a single context string for the decide prompt
  const fullContext = [memoryContext, reputationContext].filter(Boolean).join("\n\n") || undefined;
  const proposed = await engine.decide({ question: input.question, subClaims, candidates, budget, spentSoFar: 0, memoryContext: fullContext });
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const assetBySourceId = new Map(
    [...assetById.values()].map((asset) => [asset.source.id, asset]),
  );
  const isExternal = (id: string) => id.startsWith("ext:");
  const externalById = new Map(external.map((c) => [c.id, c]));

  // External marketplace endpoints are discovery-only: the engine judges their value, but the
  // orchestrator never settles to them (off Keryx's Arc rail) — enforced here like the budget cap,
  // so a model BUY can never leak into a real off-rail purchase.
  const proposedAssetIds = new Set<string>();
  const internalProposed = proposed
    .filter((d) => !isExternal(d.sourceId))
    .flatMap((d) => {
      // Current engines return candidate ids. Accept a registry source id too so an in-flight
      // fallback/custom engine cannot erase all decisions during this additive rollout.
      const asset = assetById.get(d.sourceId) ?? assetBySourceId.get(d.sourceId);
      if (!asset) return [];
      if (proposedAssetIds.has(asset.candidate.id)) return [];
      proposedAssetIds.add(asset.candidate.id);
      return [{
        ...d,
        assetId: asset.candidate.id,
        sourceId: asset.source.id,
        sourceName: asset.candidate.name,
        // The engine judges value; authoritative marketplace terms decide the amount reserved.
        price: asset.priceUsdc,
        targets: normalizeClaimTargets(d.targets, subClaims.length),
        ...(asset.offer
          ? { offerId: asset.offer.id, listPrice: asset.listPriceUsdc }
          : {}),
        ...asset.candidate.item,
      }];
    });
  const externalProposed = proposed.filter((d) => isExternal(d.sourceId));

  // rank internal BUY proposals by value-per-dollar; flip to SKIP when the fetch budget can't cover them
  const ranked = [...internalProposed].sort(
    (a, b) => b.expectedValue / (b.price || 1e-9) - a.expectedValue / (a.price || 1e-9),
  );
  let attentionUsed = 0;
  for (const r of ranked) {
    // A CACHE proposal against a copy the source has published past is not a free read of that
    // source. Charge for it — here, before the budget guard, so the re-read is reserved like any
    // other purchase: converting it later at fetch time would settle a toll the fetch budget never
    // accounted for. If the budget can't cover it, the guard below turns it into a SKIP.
    const d =
      r.action === "CACHE" && !freshCache.has(r.assetId ?? r.sourceId)
        ? {
            ...r,
            action: "BUY" as const,
            rationale: `${r.rationale} — no cache exists for this exact content version, so buying a fresh read.`,
          }
        : r;
    const coverageBlock = previewCoverageBlockReason(d, subClaims.length);
    if (coverageBlock) {
      finalDecisions.push({
        ...d,
        action: "SKIP",
        rationale: `${d.rationale} — ${coverageBlock}, so no toll is authorized.`,
      });
      continue;
    }
    if (
      d.action === "CACHE" &&
      ((d.targets?.length ?? 0) === 0 || d.expectedValue < config.minCacheExpectedValue)
    ) {
      finalDecisions.push({
        ...d,
        action: "SKIP",
        rationale: `${d.rationale} — cached bytes are free, but this read does not clear the attention gate (EV ${d.expectedValue.toFixed(2)}, minimum ${config.minCacheExpectedValue.toFixed(2)}, with a required claim target).`,
      });
      continue;
    }
    if (
      (d.action === "BUY" || d.action === "CACHE") &&
      attentionUsed >= attentionLimit
    ) {
      finalDecisions.push({
        ...d,
        action: "SKIP",
        rationale: `${d.rationale} — the ${attentionLimit}-source ${researchMode} attention budget is full, so lower-ranked evidence is skipped.`,
      });
      continue;
    }
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
    if (d.action === "BUY" || d.action === "CACHE") attentionUsed++;
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

  previewCoverage = buildPreviewCoverage(subClaims, finalDecisions);
  const coveragePct = Math.round(previewCoverage.ratio * 100);
  yield emit(
    "coverage",
    previewCoverage.status === "ready"
      ? `Free-preview pre-check maps an actionable source to every sub-claim (${previewCoverage.coveredClaims}/${previewCoverage.totalClaims}); paid reading may proceed within the budget.`
      : previewCoverage.status === "partial"
        ? `Free-preview pre-check covers ${previewCoverage.coveredClaims}/${previewCoverage.totalClaims} sub-claims (${coveragePct}%). The agent may buy only claim-targeted sources and will label the answer provisional if paid evidence stays thin.`
        : "Free-preview pre-check found no claim-targeted source worth its toll. No paid fetch will be attempted.",
    previewCoverage,
  );

  for (const d of finalDecisions) {
    yield emit("decide", `${d.action} ${d.sourceName} — ${d.rationale}`, d);
  }

  // 4) FETCH (+ stop-early sufficiency)
  const gathered: GatheredContent[] = [];
  let markerN = 0;
  let fetchFailures = 0;
  const buys = finalDecisions.filter(
    (d) => (d.action === "BUY" || d.action === "CACHE") && !d.external,
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

  let lastSufficient = false;
  let lastGaps = 0; // sub-claims with coverage < 0.4 from the most recent sufficiency check

  for (const d of buys) {
    const asset = assetById.get(d.assetId ?? d.sourceId);
    if (!asset) continue;
    const { source, item, cacheKey } = asset;
    const itemIdentity = asset.candidate.item ?? {};
    const assetLabel = item ? `${source.name} — ${item.title}` : source.name;
    const marker = `S${++markerN}`;
    if (d.action === "CACHE") {
      const cached = (await db.getCached(cacheKey)) ?? "";
      gathered.push({
        assetId: asset.candidate.id,
        sourceId: source.id,
        sourceName: source.name,
        ...itemIdentity,
        marker,
        text: cached,
      });
      yield emit("fetch", `Reused cached ${assetLabel} (free) — ${marker}`);
    } else {
      yield emit(
        "fetch",
        `Paying $${asset.priceUsdc} toll to read ${assetLabel}${asset.offer ? ` (signed offer; list $${asset.listPriceUsdc})` : ""}…`,
      );
      try {
        paymentAttempts++;
        const { content, payment } = await gateway.payFetch({
          source,
          item,
          queryId,
          priceUsdc: asset.priceUsdc,
          offer: asset.offer,
        });
        if (payment.settled) settledPayments++;
        if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
        payment.origin = origin;
        payments.push(payment);
        const ledgerError = await persistPaymentRecord(payment);
        try {
          await db.setCached(cacheKey, content);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield emit("fetch", `Read ${assetLabel}, but its cache could not be refreshed (${message}).`);
        }
        gathered.push({
          assetId: asset.candidate.id,
          sourceId: source.id,
          sourceName: source.name,
          ...itemIdentity,
          marker,
          text: content,
        });
        yield emit(
          "fetch",
          `${fetchPaymentMessage(payment, assetLabel)} — ${marker}`,
          payment,
        );
        if (ledgerError) {
          yield emit("fetch", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
        }
      } catch (err) {
        // One toll failing (transient settlement error, exhausted grant, sign timeout) must not
        // kill the whole run — skip this source and answer from whatever was already read.
        fetchFailures++;
        const reason = err instanceof Error ? err.message : String(err);
        const settled = settledPaymentFrom(err);
        if (settled) {
          settled.origin = origin;
          settledPayments++;
          payments.push(settled);
          const ledgerError = await persistPaymentRecord(settled);
          yield emit(
            "fetch",
            `Paid $${settled.amountUsdc} to ${assetLabel}, but its content response failed after settlement; receipt retained and the run continues without that article.`,
            settled,
          );
          if (ledgerError) {
            yield emit("fetch", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        const pending = pendingPaymentFrom(err);
        if (pending) {
          pending.origin = origin;
          pendingPayments++;
          payments.push(pending);
          const ledgerError = await persistPaymentRecord(pending);
          yield emit(
            "fetch",
            `Signed $${pending.amountUsdc} authorization for ${assetLabel}; confirmation is pending, so it is not counted as spent — skipping this article and continuing.`,
            pending,
          );
          if (ledgerError) {
            yield emit("fetch", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        // This is a definite pre-submission failure: typed pending/settled errors above are the
        // only post-authorization exits. Release the query-local reservation so another source can
        // fill the evidence gap without weakening the browser grant's independent atomic cap.
        spentTolls = Math.max(0, round(spentTolls - asset.priceUsdc));
        yield emit("fetch", `Couldn't buy ${assetLabel} (${reason}) — skipping it, continuing with what's read.`);
        continue;
      }

      // stop-early check after each paid read — now with per-claim coverage
      const suf = await engine.sufficiency({ question: input.question, subClaims, gathered });
      if (suf.perClaim && suf.perClaim.length > 0) {
        for (const c of suf.perClaim) {
          const pct = Math.round(c.coverage * 100);
          const by = c.coveredBy.length ? ` by ${c.coveredBy.join(", ")}` : "";
          yield emit("sufficiency", `Sub-claim "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% covered${by}`);
        }
      }
      yield emit("sufficiency", suf.rationale, { sufficient: suf.sufficient, perClaim: suf.perClaim });
      lastSufficient = suf.sufficient;
      lastGaps = suf.perClaim ? suf.perClaim.filter((c) => c.coverage < 0.4).length : 0;
      if (suf.sufficient) {
        const remaining = buys.slice(buys.indexOf(d) + 1).filter((x) => x.action === "BUY");
        if (remaining.length) {
          yield emit("sufficiency", `Stopping early — skipping ${remaining.length} further paid fetch(es) to save budget.`);
        }
        break;
      }
    }
  }

  // 4b) RE-EVALUATE — after the initial fetch pass, assess per-claim coverage and
  // potentially buy additional previously-skipped sources to fill gaps. Multi-pass
  // reasoning: the agent "thinks twice" about whether its initial buy/skip choices
  // left any sub-claim unsupported, and spends remaining budget to close the gap.
  // The selection pass reserves context slots, but failed/stop-early fetches never entered the
  // synthesis context and therefore must not block a useful gap-filling read.
  attentionUsed = gathered.length;
  const gatheredIds = new Set(gathered.map((g) => g.assetId ?? g.sourceId));
  let remainingBudget = fetchBudget - spentTolls;

  // Skip re-evaluation when the last sufficiency check already confirmed full coverage —
  // no point burning an LLM call to discover there are no gaps.
  if (lastSufficient && lastGaps === 0 && reevaluateRounds > 0) {
    yield emit("reevaluate", `All sub-claims already well-covered (sufficiency passed with 0 gaps) — skipping re-evaluation to save latency.`);
  } else if (gathered.length > 0 && reevaluateRounds > 0) {
    for (let round = 0; round < reevaluateRounds; round++) {
      if (attentionUsed >= attentionLimit) {
        yield emit(
          "reevaluate",
          `Attention budget is full at ${attentionLimit} source(s); no broader context will be purchased.`,
        );
        break;
      }
      const skipped = finalDecisions
        .filter(
          (d) =>
            d.action === "SKIP" &&
            !d.external &&
            !isExternal(d.sourceId) &&
            !gatheredIds.has(d.assetId ?? d.sourceId),
        )
        .map((d) => {
          const asset = assetById.get(d.assetId ?? d.sourceId);
          return {
            id: d.assetId ?? d.sourceId,
            name: d.sourceName,
            price: asset?.priceUsdc ?? 0,
            preview: asset?.candidate.preview ?? "",
          };
        });

      if (skipped.length === 0 || remainingBudget <= 0) break;

      const reeval = await engine.reevaluate({
        question: input.question,
        subClaims,
        gathered,
        skippedSources: skipped,
        remainingBudget,
      });

      // Emit per-claim coverage assessment — visible multi-pass reasoning
      for (const c of reeval.claims) {
        const pct = Math.round(c.coverage * 100);
        yield emit(
          "reevaluate",
          `Sub-claim "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% covered${c.coveredBy.length ? ` by ${c.coveredBy.join(", ")}` : ""} — ${c.rationale}`,
          c,
        );
      }
      lastSufficient =
        reeval.claims.length > 0 &&
        reeval.claims.every(
          (claim) => claim.coverage >= MIN_REWARD_SUPPORT,
        );
      lastGaps = reeval.claims.filter(
        (claim) => claim.coverage < MIN_REWARD_SUPPORT,
      ).length;

      yield emit("reevaluate", reeval.rationale, {
        shouldBuyMore: reeval.shouldBuyMore,
        recommended: reeval.recommendedIds,
      });

      if (!reeval.shouldBuyMore || reeval.recommendedIds.length === 0) break;

      // Buy additional sources the engine recommended to fill coverage gaps
      for (const recId of reeval.recommendedIds) {
        if (attentionUsed >= attentionLimit) {
          yield emit(
            "reevaluate",
            `Attention budget reached ${attentionLimit} source(s); stopping gap expansion.`,
          );
          break;
        }
        const asset = assetById.get(recId);
        const source = asset?.source;
        // Guard against an engine recommending a source we already read (duplicate marker +
        // double payment) or that no longer fits the remaining budget.
        if (!asset || !source || gatheredIds.has(recId) || asset.priceUsdc > remainingBudget + 1e-9) continue;

        const marker = `S${++markerN}`;
        const assetLabel = asset.item ? `${source.name} — ${asset.item.title}` : source.name;
        const itemIdentity = asset.candidate.item ?? {};
        yield emit("reevaluate", `Filling gap — buying ${assetLabel} ($${asset.priceUsdc})…`);

        try {
          paymentAttempts++;
          const { content, payment } = await gateway.payFetch({
            source,
            item: asset.item,
            queryId,
            priceUsdc: asset.priceUsdc,
            offer: asset.offer,
          });
          if (payment.settled) settledPayments++;
          if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
          payment.origin = origin;
          payments.push(payment);
          const ledgerError = await persistPaymentRecord(payment);
          try {
            await db.setCached(asset.cacheKey, content);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield emit("reevaluate", `Read ${assetLabel}, but its cache could not be refreshed (${message}).`);
          }
          gathered.push({
            assetId: asset.candidate.id,
            sourceId: source.id,
            sourceName: source.name,
            ...itemIdentity,
            marker,
            text: content,
          });
          attentionUsed++;
          gatheredIds.add(asset.candidate.id);
          remainingBudget -= asset.priceUsdc;
          spentTolls += asset.priceUsdc;

          yield emit(
            "reevaluate",
            `${fetchPaymentMessage(payment, assetLabel)} — ${marker}`,
            payment,
          );
          if (ledgerError) {
            yield emit("reevaluate", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const settled = settledPaymentFrom(err);
          if (settled) {
            settled.origin = origin;
            settledPayments++;
            payments.push(settled);
            const ledgerError = await persistPaymentRecord(settled);
            // This source was selected only during re-evaluation, so consume its query slice here.
            remainingBudget -= asset.priceUsdc;
            spentTolls += asset.priceUsdc;
            yield emit(
              "reevaluate",
              `Paid $${settled.amountUsdc} to ${assetLabel}, but its content response failed after settlement; receipt retained and the gap remains open.`,
              settled,
            );
            if (ledgerError) {
              yield emit("reevaluate", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
            }
            continue;
          }
          const pending = pendingPaymentFrom(err);
          if (pending) {
            pending.origin = origin;
            pendingPayments++;
            payments.push(pending);
            const ledgerError = await persistPaymentRecord(pending);
            // It may already have settled, so this reservation still consumes the per-query slice.
            remainingBudget -= asset.priceUsdc;
            spentTolls += asset.priceUsdc;
            yield emit(
              "reevaluate",
              `Signed $${pending.amountUsdc} authorization for ${assetLabel}; confirmation is pending and the reserved budget stays consumed.`,
              pending,
            );
            if (ledgerError) {
              yield emit("reevaluate", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
            }
            continue;
          }
          yield emit("reevaluate", `Couldn't buy ${assetLabel} to fill gap (${reason}) — continuing.`);
        }
      }
    }
  }

  if (gathered.length === 0) {
    return finish(
      fetchFailures > 0
        ? pendingPayments > 0
          ? "The agent submitted one or more signed source payments, but no settlement confirmation returned. Those amounts remain pending and are not counted as spent; the session reservation stays consumed until its live balance is refreshed."
          : "The agent tried to buy sources but every purchase failed before submission — likely an exhausted budget or a temporary settlement error. No payment authorization was submitted; please try again."
        : "The agent decided no source was worth paying for this question.",
    );
  }

  // 4c) FINAL COVERAGE — always reassess after every cache read and re-evaluation purchase.
  // Earlier snapshots help decide whether to spend more, but cannot authorize confidence or
  // citation rewards: CACHE-only runs used to keep an unmeasured lastGaps=0, while re-evaluation
  // purchases left the pre-purchase coverage snapshot behind.
  let finalSufficiency: SufficiencyResult;
  let finalAssessmentAvailable = true;
  try {
    finalSufficiency = await engine.sufficiency({
      question: input.question,
      subClaims,
      gathered,
    });
  } catch (error) {
    finalAssessmentAvailable = false;
    const reason =
      error instanceof Error ? error.message : "unknown assessment error";
    finalSufficiency = {
      sufficient: false,
      rationale:
        "Final evidence assessment was unavailable; coverage defaults to zero and citation rewards are withheld.",
      perClaim: subClaims.map((claim) => ({
        claim,
        coverage: 0,
        coveredBy: [],
      })),
    };
    yield emit(
      "sufficiency",
      `Final coverage assessment failed (${reason}); continuing conservatively with zero coverage.`,
      { final: true, failed: true },
    );
  }
  for (const c of finalSufficiency.perClaim ?? []) {
    const pct = Math.round(c.coverage * 100);
    const by = c.coveredBy.length
      ? ` by ${c.coveredBy.join(", ")}`
      : "";
    yield emit(
      "sufficiency",
      `Final check — "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% assessed${by}`,
      c,
    );
  }
  yield emit(
    "sufficiency",
    `Final coverage assessment — ${finalSufficiency.rationale}`,
    {
      final: true,
      sufficient: finalSufficiency.sufficient,
      perClaim: finalSufficiency.perClaim,
    },
  );

  // 5) SYNTHESIZE
  yield emit("synthesize", `Synthesizing a grounded answer from ${gathered.length} source(s)…`);
  const synthesized = await engine.synthesize({ question: input.question, subClaims, gathered });

  // 5b) ADJUDICATE — when the sources disagreed, the synthesizer trusted one over another rather
  // than averaging them. Surface each resolution so the reasoning behind the answer stays visible.
  for (const cf of synthesized.conflicts ?? []) {
    const positions = cf.positions.map((p) => `${p.marker} ${p.stance}`).join("  vs  ");
    yield emit(
      "adjudicate",
      `⚖️ Sources disagreed on ${cf.point} — ${positions} → trusted ${cf.trusted} (${cf.reason})`,
      cf,
    );
  }

  // Guard against an empty body (e.g. the model returned unparseable JSON) so the run never
  // completes "done" showing a blank answer after real money was spent.
  let answer = synthesized.answer?.trim()
    ? synthesized.answer
    : `Read and paid for ${gathered.length} source(s) (${gathered.map((g) => g.sourceName).join(", ")}), but couldn't compose a written summary this run. Please try again.`;
  const ledger = buildEvidenceLedger({
    subClaims,
    gathered,
    answer,
    declaredMarkers: synthesized.citedMarkers,
    proposedEvidence: synthesized.evidence ?? [],
    finalAssessment: finalSufficiency.perClaim,
    rewardAuthorizationAvailable: finalAssessmentAvailable,
  });
  evidence = ledger.evidence;
  claimCoverage = ledger.claimCoverage;
  evidenceMeasured = true;
  answer = removeUnsupportedCitationMarkers(
    answer,
    ledger.acceptedMarkers,
  );
  const used = gathered.filter((g) =>
    ledger.acceptedMarkers.has(g.marker),
  );

  for (const item of evidence) {
    yield emit(
      "evidence",
      `${item.qualifiesForReward ? "Verified" : "Below reward gate"} — ${item.marker} supports claim ${item.claimIndex + 1} at ${Math.round(item.support * 100)}%: “${item.quote.slice(0, 140)}${item.quote.length > 140 ? "…" : ""}”`,
      item,
    );
  }
  if (
    ledger.droppedEvidence > 0 ||
    ledger.droppedCitations.length > 0
  ) {
    yield emit(
      "evidence",
      `Rejected ${ledger.droppedEvidence} invalid evidence span(s) and ${ledger.droppedCitations.length} unsupported citation marker(s); rejected markers cannot receive citation rewards.`,
      {
        droppedEvidence: ledger.droppedEvidence,
        droppedCitations: ledger.droppedCitations,
      },
    );
  }
  if (used.length === 0) {
    yield emit(
      "evidence",
      `No citation passed the evidence gate — the $${citationPool.toFixed(6)} citation pool stays unspent; settled access tolls still stand.`,
      { citationPoolUsdc: round(citationPool), withheld: true },
    );
  }

  // 5c) VERDICT — derive how confident the agent is from its own coverage signals (sources
  // corroborating the answer, sub-claims left thin, disagreements adjudicated). When the evidence
  // is thin, hedge the answer honestly instead of stating it with false certainty.
  const conflictsResolved = synthesized.conflicts?.length ?? 0;
  const adjudicatedNote = conflictsResolved
    ? `, ${conflictsResolved} disagreement${conflictsResolved === 1 ? "" : "s"} adjudicated`
    : "";
  const gaps = claimCoverage.filter(
    (claim) => claim.coverage < MIN_REWARD_SUPPORT,
  ).length;
  const strongClaims = claimCoverage.filter(
    (claim) => claim.coverage >= 0.7,
  ).length;
  const allStrong =
    claimCoverage.length > 0 && strongClaims === claimCoverage.length;
  const allGrounded = claimCoverage.length > 0 && gaps === 0;
  const gapsNote = (n: number) => `${n} sub-claim${n === 1 ? "" : "s"}`;
  const verdict: Confidence =
    used.length === 0
      ? { level: "Low", reason: "no citation passed the evidence gate" }
      : allStrong && used.length >= 2
        ? {
            level: "High",
            reason: `${used.length} evidence-verified sources ground every sub-claim${adjudicatedNote}`,
          }
        : allGrounded
          ? {
              level: "Moderate",
              reason: `${used.length} evidence-verified source${used.length === 1 ? "" : "s"} cover every sub-claim, but corroboration or support strength is limited${adjudicatedNote}`,
            }
          : {
              level: "Low",
              reason: `${gapsNote(gaps)} remain below the evidence threshold${adjudicatedNote}`,
            };
  runConfidence = verdict;

  if (verdict.level === "Low" && used.length > 0) {
    answer = `> ⚠ Low confidence — ${verdict.reason} within budget. Treat this as provisional.\n\n${answer}`;
  }

  yield emit("synthesize", `Drafted answer citing ${used.length} source(s)`, { answer });
  yield emit("verdict", `Confidence: ${verdict.level} — ${verdict.reason}.`, verdict);

  // 6) ATTRIBUTE contribution weights
  if (used.length > 0) {
    const proposedAttributions = await engine.attribute({
      question: input.question,
      answer,
      used,
    });
    const attributions = resolveAttributions(
      used,
      proposedAttributions,
    );
    const rewards = allocateSplit(
      round(citationPool),
      attributions.map((item) => item.weight),
    );
    citations = used.map((g, index) => {
      const attribution = attributions[index]!;
      return {
        marker: g.marker,
        sourceId: g.sourceId,
        sourceName: g.sourceName,
        itemId: g.itemId,
        itemTitle: g.itemTitle,
        itemUrl: g.itemUrl,
        contentVersion: g.contentVersion,
        itemPublishedAt: g.itemPublishedAt,
        contentReceipt: g.contentReceipt,
        weight: attribution.weight,
        reward: rewards[index] ?? 0,
        rationale: attribution.rationale,
      };
    });
  }
  for (const c of citations) {
    yield emit("attribute", `${c.sourceName} contributed ${(c.weight * 100).toFixed(0)}% → reward $${c.reward}`, c);
  }

  // 7) SETTLE weighted citation rewards (split across authors)
  for (const c of citations) {
    const source = sourceById.get(c.sourceId)!;
    if (c.reward <= 0) continue;
    const authors = source.authors.length ? source.authors : [{ name: source.name, walletAddress: source.walletAddress, splitWeight: 1 }];
    // Allocate the reward across authors in integer micro-USDC so the settled legs sum to EXACTLY
    // c.reward — independent rounding per author (round(reward * weight)) would let the legs drift
    // a micro-USDC off the reward, and that drift accumulates across every settlement.
    const legAmounts = allocateSplit(c.reward, authors.map((a) => a.splitWeight));
    // Author legs settled for THIS citation — used to ping the source's notify webhook once per
    // citation (not once per author leg), carrying every leg's real on-chain settlement state.
    const citationPayments: PaymentRecord[] = [];
    for (let i = 0; i < authors.length; i++) {
      const author = authors[i];
      const amount = legAmounts[i];
      if (amount <= 0) continue;
      const rationale = `Citation reward (${(c.weight * 100).toFixed(0)}% contribution${authors.length > 1 ? `, ${(author.splitWeight * 100).toFixed(0)}% author split` : ""}).`;
      try {
        paymentAttempts++;
        const item =
          c.itemId && c.itemTitle && c.itemUrl && c.contentVersion
            ? {
                itemId: c.itemId,
                itemTitle: c.itemTitle,
                itemUrl: c.itemUrl,
                contentVersion: c.contentVersion,
                ...(c.itemPublishedAt ? { itemPublishedAt: c.itemPublishedAt } : {}),
                ...(c.contentReceipt ? { contentReceipt: c.contentReceipt } : {}),
              }
            : undefined;
        const payment = await gateway.payCitation({
          source,
          author,
          item,
          amount,
          weight: c.weight,
          queryId,
          rationale,
        });
        if (payment.settled) settledPayments++;
        if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
        payment.origin = origin;
        payments.push(payment);
        const ledgerError = await persistPaymentRecord(payment);
        if (paymentCountsAsSpent(payment)) citationPayments.push(payment);
        yield emit(
          "settle",
          citationPaymentMessage(payment, author.name),
          payment,
        );
        if (ledgerError) {
          yield emit("settle", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
        }
        if (paymentSettlementStatus(payment) === "pending") {
          void sendAlert(
            `citation settlement pending → ${author.name}`,
            `$${amount} for "${source.name}" has a submitted authorization but no Circle confirmation.`,
          );
        }
      } catch (err) {
        // The answer is already written — a citation-settlement hiccup must not discard it.
        const reason = err instanceof Error ? err.message : String(err);
        const settled = settledPaymentFrom(err);
        if (settled) {
          settled.origin = origin;
          settledPayments++;
          payments.push(settled);
          citationPayments.push(settled);
          const ledgerError = await persistPaymentRecord(settled);
          yield emit(
            "settle",
            `Paid $${settled.amountUsdc} citation reward → ${author.name}; Circle confirmed settlement even though the paid route acknowledgement failed.`,
            settled,
          );
          if (ledgerError) {
            yield emit("settle", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        const pending = pendingPaymentFrom(err);
        if (pending) {
          pending.origin = origin;
          pendingPayments++;
          payments.push(pending);
          const ledgerError = await persistPaymentRecord(pending);
          yield emit(
            "settle",
            `Submitted $${pending.amountUsdc} citation authorization → ${author.name}; settlement confirmation is pending and is not counted as paid.`,
            pending,
          );
          if (ledgerError) {
            yield emit("settle", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          void sendAlert(
            `citation settlement pending → ${author.name}`,
            `$${amount} for "${source.name}": ${reason}`,
          );
          continue;
        }
        yield emit("settle", `Couldn't settle the reward to ${author.name} (${reason}) — the answer stands.`, { error: reason });
        // A real-mode failure means a creator was owed USDC that didn't land — worth an ops alert.
        // Offline/simulated runs never settle, so they don't alert. Fire-and-forget (never throws).
        if (gateway.mode === "real") {
          void sendAlert(`citation settlement failed → ${author.name}`, `$${amount} for "${source.name}": ${reason}`);
        }
      }
    }
    // Notify-on-citation: ping the creator's webhook the moment their source earns. Fire-and-forget
    // and self-contained (never throws) so a slow/dead endpoint can't stall or fail the run. The
    // dispatcher no-ops when the source has no webhook or no leg actually settled on-chain.
    if (citationPayments.length > 0) {
      const notifyInput = {
        source,
        citation: c,
        payments: citationPayments,
        queryId,
        question: input.question,
        network: config.network,
      };
      void dispatchCitationNotify(db, notifyInput);
      // The human channel: same settled-only guard, plus a per-source hourly rate cap inside.
      void dispatchCitationEmail(db, notifyInput);
      if (citationPayments.some((payment) => paymentSettlementStatus(payment) === "settled")) {
        await recordActivationEvent(db, "creator_citation_settled");
      }
    }
  }

  // Save query memory for cross-query learning (best-effort, fire-and-forget). What the agent read
  // goes with it, not just what it cited: a source paid for and then left unquoted is the only
  // evidence the next decision has that it does not earn its toll.
  try {
    await saveMemory(
      db,
      queryId,
      input.question,
      citations,
      [...new Set(gathered.map((item) => item.sourceId))],
    );
  } catch {
    // Never fail a run on memory save
  }

  return finish(answer);

  // ── helpers ──
  function finish(answer: string): QueryRun {
    const totalSpent = round(
      payments
        .filter(paymentCountsAsSpent)
        .reduce((sum, payment) => sum + payment.amountUsdc, 0),
    );
    const run: QueryRun = {
      id: queryId,
      question: input.question,
      budget,
      researchMode,
      ...(previewCoverage ? { previewCoverage } : {}),
      // What actually answered, not what was picked: a run that fell back to the heuristic must not
      // present itself as model-reasoned (see ResilientEngine.effectiveName).
      engine: effectiveEngineName(engine),
      reasoningAttempts: reasoningAttempts(engine),
      subClaims,
      decisions: finalDecisions,
      citations,
      ...(evidenceMeasured ? { evidence, claimCoverage } : {}),
      answer,
      totalSpent,
      totalToCreators: totalSpent, // 100% of spend reaches creator wallets
      trace,
      createdAt: new Date().toISOString(),
      origin,
      ...(origin === "mcp" && input.mcpClient ? { mcpClient: input.mcpClient } : {}),
      ...(input.asker ? { asker: input.asker.toLowerCase() } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
      paymentMode: gateway.mode,
      paymentAttempts,
      settledPayments,
      pendingPayments,
      // Only present on a retry, so every other surface keeps reading runs exactly as before.
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
      // Early returns (no sources, no purchase) never reach the verdict step — nothing was read,
      // so the honest label is Low rather than an absent field the surfaces would have to guess at.
      confidence: runConfidence ?? { level: "Low", reason: "no source was read for this question" },
    };
    emit(
      "done",
      `Done. Spent $${totalSpent} across ${payments.length - pendingPayments} confirmed/simulated payment(s) to creators${pendingPayments ? `; ${pendingPayments} authorization(s) await settlement confirmation` : ""}.`,
    );
    return run;
  }
}

function short(tx?: string | null): string {
  return tx ? `${tx.slice(0, 10)}…` : "no-tx";
}

function fetchPaymentMessage(payment: PaymentRecord, sourceName: string): string {
  const status = paymentSettlementStatus(payment);
  if (status === "settled") {
    return `Paid $${payment.amountUsdc} to ${sourceName} (settled ${short(payment.txHash)})`;
  }
  if (status === "pending") {
    return `Unlocked ${sourceName} after a $${payment.amountUsdc} signed authorization (settlement confirmation pending)`;
  }
  return `Simulated $${payment.amountUsdc} toll to ${sourceName} (offline)`;
}

function citationPaymentMessage(payment: PaymentRecord, authorName: string): string {
  const status = paymentSettlementStatus(payment);
  if (status === "settled") {
    return `Settled $${payment.amountUsdc} citation reward → ${authorName} (${short(payment.txHash)})`;
  }
  if (status === "pending") {
    return `Submitted $${payment.amountUsdc} citation authorization → ${authorName}; settlement confirmation pending`;
  }
  return `Simulated $${payment.amountUsdc} citation reward → ${authorName} (offline)`;
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Accept model weights only when every evidence-eligible source appears exactly once with a finite
 * positive weight. Otherwise fall back to an equal split across the already-validated citations:
 * an attribution transport/schema failure must not redirect money, but it also must not make a
 * genuinely grounded creator silently lose the reward promised by the product.
 */
function resolveAttributions(
  used: GatheredContent[],
  proposed: { sourceId: string; weight: number; rationale: string }[],
): { sourceId: string; weight: number; rationale: string }[] {
  const allowed = new Set(used.map((item) => item.sourceId));
  const byId = new Map<
    string,
    { sourceId: string; weight: number; rationale: string }
  >();
  let invalid = false;
  for (const item of proposed) {
    if (
      !allowed.has(item.sourceId) ||
      byId.has(item.sourceId) ||
      !Number.isFinite(item.weight) ||
      item.weight <= 0
    ) {
      invalid = true;
      continue;
    }
    byId.set(item.sourceId, item);
  }

  if (!invalid && byId.size === used.length) {
    const total = [...byId.values()].reduce(
      (sum, item) => sum + item.weight,
      0,
    );
    if (Number.isFinite(total) && total > 0) {
      return used.map((item) => {
        const attribution = byId.get(item.sourceId)!;
        return {
          ...attribution,
          weight: attribution.weight / total,
        };
      });
    }
  }

  return used.map((item) => ({
    sourceId: item.sourceId,
    weight: 1 / used.length,
    rationale:
      "Evidence-validated citation; equal split used because attribution was incomplete or invalid.",
  }));
}
