/**
 * Keryx domain model. Shared across the agent brain, persistence, API, and UI.
 */

/** A registered content source = a creator (or multi-author publication) that gets paid per citation. */
export interface Source {
  id: string;
  name: string;
  url: string; // homepage / canonical link
  description: string;
  rssUrl?: string;
  walletAddress: string; // payTo for fetch tolls + citation rewards
  fetchPrice: number; // USDC access toll per fetch
  tags: string[];
  authors: Author[]; // for multi-author splits (defaults to one = the source)
  createdAt: string;
  /** false when the creator has called deactivate() on-chain. listSources() filters these out
   *  so deactivated sources are never discovered, fetched, or cited. Defaults to true for
   *  offline/DB-direct rows that predate the active flag. */
  active?: boolean;
  /** IPFS CID for gated content. Set by the registry indexer from on-chain contentCid.
   *  Content fetch stays lazy — pulled on first agent demand, cached in cache_items.
   *  Phase 04 will use this to fetch + decrypt encrypted content. */
  ipfsCid?: string;
  /** The source's id in the on-chain SourceRegistry = keccak256(abi.encode(registrant, urlHash)).
   *  Present once the curated source has been registered on Arc. Lets the UI prove provenance. */
  onchainId?: string;
  /** EVM tx hash of the SourceRegistry register() call. Unlike Gateway settlement IDs (UUIDs),
   *  this resolves on the block explorer, so the UI can link it as verifiable on-chain proof. */
  registerTx?: string;
  /** Feed-ownership proof gate. Listing a source is permissionless, but EARNING is not: the agent
   *  only discovers/reads/cites/pays sources whose owner has proven control of the feed (by placing
   *  `keryx-verify:<payoutWallet>` in it — see lib/sources/feed-verification.ts). An impostor who
   *  lists a feed they don't own can never make it carry their wallet, so can never verify or earn.
   *  Undefined/null is treated as true so operator-curated + pre-existing rows are grandfathered. */
  verified?: boolean;
  /** How much of each item a FREE preview may reveal — the creator's incentive dial. Undefined/null
   *  means "full" (grandfathers every row that predates the column). See lib/sources/preview-depth.ts. */
  previewDepth?: import("./sources/preview-depth").PreviewDepth;
}

/** A payable author within a source (enables multi-author citation splits). */
export interface Author {
  name: string;
  walletAddress: string;
  splitWeight: number; // 0..1, weights within a single source sum to 1
}

/** A content item belonging to a source (ingested from RSS). Preview is free; content is paid. */
export interface SourceItem {
  id: string;
  sourceId: string;
  title: string;
  summary: string; // free preview shown during discovery
  content: string; // full text unlocked after the x402 toll (plaintext in DB when IPFS disabled)
  link: string;
  publishedAt?: string;
  // Phase 04: IPFS encrypted content. When set, `content` is empty and the real text lives
  // on IPFS as AES-256-GCM ciphertext. Decryption happens only inside produce() post-settle.
  ipfsCid?: string;       // CID of the encrypted blob on Pinata IPFS
  itemKeyEnc?: string;    // base64: per-item AES key wrapped with CONTENT_MASTER_KEY (+ 16-byte GCM tag)
  itemIv?: string;        // base64: 12-byte GCM nonce used to encrypt the content
  itemAuthTag?: string;   // base64: 16-byte GCM auth tag for the content ciphertext
}

export type DecisionAction = "BUY" | "SKIP" | "CACHE";

/** The agent's reasoned choice about a single candidate source. The rationale is the product. */
export interface Decision {
  sourceId: string;
  sourceName: string;
  action: DecisionAction;
  expectedValue: number; // 0..1 — predicted usefulness for the question
  price: number; // USDC toll
  confidence: number; // 0..1
  rationale: string; // human-readable WHY (buy/skip/cache)
  targets: number[]; // indexes of sub-claims this source is expected to address
  external?: boolean; // true = an endpoint from the live x402 marketplace (discovery-only, off Arc)
}

/** One contributing source in the final answer, with its weighted reward. */
export interface Citation {
  marker: string; // e.g. "S1"
  sourceId: string;
  sourceName: string;
  weight: number; // 0..1 contribution to the answer (cited sources sum to 1)
  reward: number; // USDC citation reward = pool * weight
  rationale: string; // why this weight
}

/** Where a payment originated. `engine` = Keryx's own autonomous volume engine; `web` = a human
 *  asking through a first-party surface; `a2a` = an external agent calling the paid x402 endpoint;
 *  `mcp` = a remote MCP client. web + a2a + mcp = genuine EXTERNAL usage, kept distinct from
 *  engine-generated volume so traction is reported honestly. Legacy NULL rows count as engine. */
export type PaymentOrigin = "engine" | "web" | "a2a" | "mcp";

/** A settled payment. `inbound` = another agent paid Keryx (A2A); fetch/citation = Keryx paid a creator. */
export interface PaymentRecord {
  id?: string;
  kind: "fetch" | "citation" | "inbound";
  queryId: string;
  sourceId: string;
  sourceName: string;
  payer: string;
  payee: string;
  amountUsdc: number;
  weight?: number;
  rationale?: string;
  txHash?: string | null;
  network: string;
  settled: boolean; // true only when really settled on-chain (false = offline dev)
  origin?: PaymentOrigin; // engine | web | a2a | mcp — see PaymentOrigin
  createdAt: string;
}

/** A creator cash-out: accrued Gateway earnings minted on-chain to a wallet via Gateway withdraw.
 *  Unlike the per-payment Circle settlement UUIDs (which do NOT open at /tx/), `txHash` is a real
 *  EVM mint hash that resolves on the block explorer — so the dashboard can link it as verifiable
 *  proof that the rewards are real, withdrawable USDC, not just a Gateway ledger number. */
export interface WithdrawalRecord {
  txHash: string; // EVM mint tx hash (primary key) — resolves at explorer /tx/
  label: string; // keystore label of the creator wallet (e.g. "latent-space-ae8bf6")
  sourceName?: string; // human-readable source name when resolvable, else the label
  wallet: string; // creator EOA whose Gateway balance was drawn from
  recipient: string; // address the minted USDC landed in (defaults to the creator's own wallet)
  amountUsdc: number;
  network: string;
  createdAt: string;
}

export type TracePhase =
  | "decompose"
  | "discover"
  | "decide"
  | "fetch"
  | "sufficiency"
  | "reevaluate"
  | "synthesize"
  | "adjudicate"
  | "verdict"
  | "attribute"
  | "settle"
  | "done";

/** A single streamed step in the agent's visible reasoning trace. */
export interface TraceStep {
  phase: TracePhase;
  message: string;
  detail?: unknown;
  ts: number;
}

/** How much the agent trusts its own answer, derived from its coverage signals (sources
 *  corroborating, sub-claims left thin, disagreements adjudicated). Emitted as a trace step and
 *  carried as a first-class field so every surface — permalink, archive, API — can show it without
 *  re-reading the trace. */
export interface Confidence {
  level: "High" | "Moderate" | "Low";
  reason: string;
}

/** Complete record of one agent run over a question. */
export interface QueryRun {
  id: string;
  question: string;
  budget: number;
  engine: string; // which reasoning engine produced this (llm:model | heuristic)
  subClaims: string[];
  decisions: Decision[];
  citations: Citation[];
  answer: string;
  totalSpent: number; // USDC actually spent (tolls + rewards)
  totalToCreators: number; // USDC that reached creator wallets
  trace: TraceStep[];
  createdAt: string;
  /** The dispatch this one follows up on. A follow-up is a full paid dispatch in its own right —
   *  it buys and pays creators again; the parent only supplied the question's context. */
  parentId?: string;
  /** The under-covered dispatch this one re-asks. A retry is the *same question* put to the corpus
   *  again after it gained content that might answer it — unlike `parentId`, which carries a
   *  different, follow-up question. The two are kept apart because the demand board must never read
   *  the agent's own repeat as a second reader arriving at the same hole. */
  retryOf?: string;
  /** How confident the agent is in this answer. Absent on runs recorded before it became a field;
   *  deriveConfidence() reconstructs it from the trace's verdict step for those. */
  confidence?: Confidence;
  /** Lowercased wallet that dispatched this run, taken from a server-verified SIWE session or API
   *  key — never from a client-supplied field. Absent on anonymous asks and unidentified agents. */
  asker?: string;
  /** True when that wallet's own session key paid for the run; false/absent means the dispatch
   *  ran on Keryx's treasury (the free trial). Kept apart so a receipts page can never present
   *  Keryx's spend as the user's. */
  askerFunded?: boolean;
  /** Verified request channel. Persisted on the run as well as its payments so zero-spend
   *  dispatches still count in an honest external conversion denominator. */
  origin?: PaymentOrigin;
  /** End-to-end orchestrator time for completed runs. Absent on historical rows. */
  durationMs?: number;
  /** Settlement telemetry for completed runs; historical rows intentionally remain unsampled. */
  paymentMode?: "real" | "offline";
  paymentAttempts?: number;
  settledPayments?: number;
}

/** Aggregate metrics for the traction dashboard. Computed only from real, settled rows in prod. */
export interface DashboardMetrics {
  totalPayments: number;
  totalVolumeUsdc: number;
  totalCreatorPayoutsUsdc: number;
  creatorsEarning: number;
  avgPaymentUsdc: number;
  totalQueries: number;
  payingQueries: number; // queries that produced >= 1 payment
  readerToPayerConversion: number; // payingQueries / totalQueries
  // Honest traction split: external = web + A2A + MCP (real outside usage); the rest is the
  // autonomous volume engine. engine = totalPayments - externalPayments.
  externalPayments: number;
  externalVolumeUsdc: number;
  enginePayments: number;
  engineVolumeUsdc: number;
  externalQueries: number;
  engineQueries: number;
  externalPayingQueries: number;
  externalReaderToPayerConversion: number;
  externalCreatorPayoutsUsdc: number;
  externalAvgCostPerQueryUsdc: number;
  identifiedExternalActors: number;
  returningExternalActors: number;
  returningExternalActorRate: number;
  externalDurationSamples: number;
  externalAvgDurationMs: number;
  externalP95DurationMs: number;
  externalConfidenceSamples: number;
  externalHighConfidenceRate: number;
  externalFeedbackTotal: number;
  externalSatisfactionRate: number;
  externalSettlementAttempts: number;
  externalSettledPayments: number;
  externalSettlementSuccessRate: number;
  /** Global answer satisfaction rate (up / total feedback). Added by /api/metrics. */
  satisfactionRate?: number;
  /** Total feedback votes received. Added by /api/metrics. */
  feedbackTotal?: number;
}

/** One day's settled USDC volume. `day` is a UTC `YYYY-MM-DD` key. */
export interface DailyVolume {
  day: string;
  usdc: number;
}
