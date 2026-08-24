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

/** What the paid body honestly contains. RSS metadata alone must never be advertised as full text. */
export type ContentDeliveryKind = "full_text" | "excerpt" | "abstract" | "metadata_only";

/** Where the paid body rests before settlement-gated delivery. */
export type ContentStorageMode = "ipfs_encrypted" | "db_encrypted" | "db_plaintext";

/**
 * Creator-signed statement about one exact paid body. It authenticates content provenance only:
 * SourceRegistry remains payout authority and ArticleOffer remains pricing authority.
 */
export interface ArticleContentManifest {
  id: string;
  sourceId: string;
  itemId: string;
  canonicalUrl: string;
  bodyHash: string;
  plaintextBytes: number;
  deliveryKind: ContentDeliveryKind;
  signer: string;
  nonce: string;
  signature: string;
  createdAt: string;
}

/** Public, non-secret content receipt metadata carried from discovery through the dispatch. */
export interface ContentReceiptRef {
  deliveryKind: ContentDeliveryKind;
  storageMode: ContentStorageMode;
  plaintextBytes: number;
  bodyHash?: string;
  manifestId?: string;
  manifestSigner?: string;
  /** Full public signature proof; it authenticates metadata only and contains no plaintext/key. */
  manifest?: ArticleContentManifest;
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
  /** Random AES-GCM nonce for wrapping the item key. Missing means the legacy zero-IV envelope. */
  itemWrapIv?: string;
  deliveryKind?: ContentDeliveryKind;
  storageMode?: ContentStorageMode;
  plaintextBytes?: number;
  bodyHash?: string;
  manifest?: ArticleContentManifest;
}

/** Immutable identity for the exact article version the agent evaluated and purchased. */
export interface SourceItemIdentity {
  itemId: string;
  itemTitle: string;
  itemUrl: string;
  contentVersion: string;
  itemPublishedAt?: string;
  contentReceipt?: ContentReceiptRef;
}

/**
 * A creator-signed, version-bound discount for one article.
 *
 * `priceUsdc6` is an integer so the signed price is exactly the amount x402 settles. The
 * SourceRegistry publication price remains the ceiling and payout authority; an offer can only
 * make one exact article cheaper until `expiresAt`.
 */
export interface ArticleOffer {
  id: string;
  sourceId: string;
  itemId: string;
  contentVersion: string;
  priceUsdc6: number;
  expiresAt: number; // unix seconds
  signer: string;
  nonce: string;
  signature: string;
  createdAt: string;
}

/** Public purchase terms carried through discovery, payment, and receipts. */
export interface ArticleOfferRef {
  id: string;
  priceUsdc: number;
  listPriceUsdc: number;
  expiresAt: number;
  /** Signed payload sent to browser co-signers so they can verify amount independently. */
  proof?: ArticleOffer;
}

export type DecisionAction = "BUY" | "SKIP" | "CACHE";

/** The agent's reasoned choice about a single candidate source. The rationale is the product. */
export interface Decision extends Partial<SourceItemIdentity> {
  sourceId: string;
  /** Candidate identity used during reasoning. Article candidates are `item:<itemId>`. */
  assetId?: string;
  sourceName: string;
  action: DecisionAction;
  expectedValue: number; // 0..1 — predicted usefulness for the question
  price: number; // USDC toll
  /** Creator-signed article discount selected by the agent, when one beat the list price. */
  offerId?: string;
  listPrice?: number;
  confidence: number; // 0..1
  rationale: string; // human-readable WHY (buy/skip/cache)
  targets: number[]; // indexes of sub-claims this source is expected to address
  external?: boolean; // true = an endpoint from the live x402 marketplace (discovery-only, off Arc)
}

/** One contributing source in the final answer, with its weighted reward. */
export interface Citation extends Partial<SourceItemIdentity> {
  marker: string; // e.g. "S1"
  sourceId: string;
  sourceName: string;
  weight: number; // 0..1 contribution to the answer (cited sources sum to 1)
  reward: number; // USDC citation reward = pool * weight
  rationale: string; // why this weight
}

/** A source span that survived the deterministic evidence gate for one decomposed claim. */
export interface EvidenceRecord extends Partial<SourceItemIdentity> {
  claimIndex: number;
  claim: string;
  marker: string;
  sourceId: string;
  sourceName: string;
  quote: string;
  support: number; // 0..1, model-proposed but bounded after the quote is verified
  qualifiesForReward: boolean;
}

/** The final, evidence-bounded coverage used for confidence and the public demand board. */
export interface ClaimCoverageRecord {
  claimIndex: number;
  claim: string;
  coverage: number; // min(final assessment, strongest validated evidence)
  coveredBy: string[]; // reward-qualifying source markers only
}

export type GapIntentStatus =
  | "pending"
  | "running"
  | "filled"
  | "missed"
  | "unpaid"
  | "stale"
  | "failed";

/**
 * One creator source offered against a measured demand-board gap.
 *
 * This is coordination state, never payment authority: owner/payTo still comes from the source
 * registry, the retry spends only Keryx's bounded treasury path, and `filled` requires both
 * evidence-qualified coverage and a settled citation payment to the offered source.
 */
export interface GapIntent {
  id: string;
  gapId: string;
  claim: string;
  question: string;
  failedQueryId: string;
  sourceId: string;
  sourceItemLink: string;
  /** Exact paid asset offered for this gap. Absent only on legacy registration-era intents. */
  itemId?: string;
  contentVersion?: string;
  /** Current creator-signed discount revision, when the response was admitted below list price. */
  articleOfferId?: string;
  ownerWallet: string;
  status: GapIntentStatus;
  attempts: number;
  leaseExpiresAt?: number;
  retryRunId?: string;
  coverage?: number;
  rewardUsdc?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

/** Where a payment originated. `engine` = Keryx's own autonomous volume engine; `web` = a human
 *  asking through a first-party surface; `a2a` = an external agent calling the paid x402 endpoint;
 *  `mcp` = a remote MCP client. web + a2a + mcp = genuine EXTERNAL usage, kept distinct from
 *  engine-generated volume so traction is reported honestly. Legacy NULL rows count as engine. */
export type PaymentOrigin = "engine" | "web" | "a2a" | "mcp";

/** User-visible research depth. It changes attention/latency policy, never payment authority. */
export type ResearchMode = "quick" | "deep";

/** Free-preview plan coverage measured before any paid fetch is attempted. */
export interface PreviewCoverage {
  status: "ready" | "partial" | "insufficient";
  coveredClaims: number;
  totalClaims: number;
  ratio: number;
  claims: Array<{
    claimIndex: number;
    claim: string;
    candidateIds: string[];
    strongestExpectedValue: number;
  }>;
}

/**
 * The deterministic source set selected from the model's claim-targeted BUY/CACHE proposals.
 * This is a preview-derived attention/spend plan, never evidence or payment authority.
 */
export interface EvidencePortfolio {
  policy: "claim-coverage-v1";
  eligibleCandidates: number;
  attentionLimit: number;
  fetchBudgetUsdc: number;
  selectedAssetIds: string[];
  selectedBuyUsdc: number;
  unusedFetchBudgetUsdc: number;
  predictedCoveredClaims: number;
  claims: Array<{
    claimIndex: number;
    selectedCandidateIds: string[];
    predictedCoverage: number;
  }>;
  /** Present only after the paid/cached bodies have passed through the evidence gate. */
  outcome?: {
    readAssetIds: string[];
    evidenceAssetIds: string[];
    nonqualifyingReads: number;
    unreadSelected: number;
    groundedClaims: number;
    evidenceYield: number | null;
  };
}

/** Coarse first-party product events. Rows store only UTC day + event + aggregate count. */
export type ActivationEvent =
  | "reader_landing"
  | "reader_ask_started"
  | "reader_answer_completed"
  | "reader_wallet_connected"
  | "reader_session_funded"
  | "reader_returning_dispatch"
  | "creator_registration_started"
  | "creator_verification_completed"
  | "creator_citation_settled"
  | "creator_withdrawal_completed";

export interface ActivationFunnel {
  windowDays: number;
  sinceDay: string;
  counts: Record<ActivationEvent, number>;
}

/** One payment attempt's evidence state. */
export type PaymentSettlementStatus = "settled" | "simulated" | "pending" | "failed";

/** `inbound` = another agent paid Keryx (A2A); fetch/citation = Keryx paid a creator. */
export interface PaymentRecord extends Partial<SourceItemIdentity> {
  id?: string;
  kind: "fetch" | "citation" | "inbound";
  queryId: string;
  sourceId: string;
  sourceName: string;
  payer: string;
  payee: string;
  amountUsdc: number;
  /** Article offer provenance. Absent for list-price, legacy, and citation payments. */
  offerId?: string;
  listPriceUsdc?: number;
  weight?: number;
  rationale?: string;
  txHash?: string | null;
  network: string;
  settled: boolean; // compatibility/metrics bit: true only with real Circle settlement evidence
  /** Distinguishes offline simulation from a submitted authorization awaiting proof. Optional so
   *  archived rows written before this field existed remain readable. */
  settlementStatus?: PaymentSettlementStatus;
  /** EIP-3009 nonce for browser co-sign attempts. Correlation evidence, never a signature. */
  authorizationId?: string;
  /** Grant generation that reserved this browser-funded amount. A terminal failure may release
   *  capacity only while the current grant still has this exact epoch. */
  grantEpoch?: string;
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
  | "coverage"
  | "decide"
  | "fetch"
  | "sufficiency"
  | "reevaluate"
  | "synthesize"
  | "evidence"
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

/**
 * Self-declared MCP distribution channel. This is useful for activation telemetry only: the URL
 * query can be edited by any caller, so it must never grant identity, auth, or payment authority.
 */
export type McpClientChannel = "codex" | "claude" | "cursor" | "direct" | "other";

/** Complete record of one agent run over a question. */
export interface QueryRun {
  id: string;
  question: string;
  budget: number;
  /** Quick/Deep attention policy selected for this dispatch. Historical runs default to Deep. */
  researchMode?: ResearchMode;
  /** Free-preview plan coverage captured before the first paid fetch. */
  previewCoverage?: PreviewCoverage;
  /** Dual-budget, claim-aware source portfolio captured before the first paid fetch. */
  evidencePortfolio?: EvidencePortfolio;
  engine: string; // which reasoning engine produced this (llm:model | heuristic)
  /** Per-step provider attempts, including fallbacks. Absent on pre-v0.8.1 runs. */
  reasoningAttempts?: import("./llm/reasoning-engine").ReasoningAttempt[];
  subClaims: string[];
  decisions: Decision[];
  citations: Citation[];
  /** Claim → source → quote ledger validated by the orchestrator. Absent on historical runs. */
  evidence?: EvidenceRecord[];
  /** Final evidence-bounded coverage. Absent on historical runs; trace remains the fallback. */
  claimCoverage?: ClaimCoverageRecord[];
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
  /** Self-declared MCP client channel, normalized from the setup URL. Telemetry only. */
  mcpClient?: McpClientChannel;
  /** End-to-end orchestrator time for completed runs. Absent on historical rows. */
  durationMs?: number;
  /** Settlement telemetry for completed runs; historical rows intentionally remain unsampled. */
  paymentMode?: "real" | "offline";
  paymentAttempts?: number;
  settledPayments?: number;
  /** Signed browser authorizations submitted without a definitive settlement response. */
  pendingPayments?: number;
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
  /** Runs recorded after the evidence ledger shipped; historical runs are not guessed. */
  evidenceRunSamples: number;
  evidenceClaimSamples: number;
  groundedClaimRate: number;
  /** Measured runs where no citation passed the reward gate. */
  citationPoolWithheldRuns: number;
  /** Creator offers queued from /wanted, including terminal outcomes. */
  gapIntentOffers: number;
  /** Offers with evidence-qualified coverage and real settled citation reward. */
  gapIntentFilled: number;
  gapIntentPending: number;
  gapIntentFillRate: number;
  externalFeedbackTotal: number;
  externalSatisfactionRate: number;
  externalSettlementAttempts: number;
  externalSettledPayments: number;
  externalSettlementSuccessRate: number;
  /** Operational uncertainty only; excluded from every settled payment and traction total. */
  pendingPaymentConfirmations: number;
  pendingPaymentVolumeUsdc: number;
  /** Circle-terminal failures; retained as receipts but excluded from spend and traction. */
  failedPaymentAttempts: number;
  failedPaymentVolumeUsdc: number;
  /** Remote MCP dispatches grouped by their self-declared setup channel. */
  mcpClientQueries: Array<{
    client: McpClientChannel | "unknown";
    queries: number;
    payingQueries: number;
  }>;
  /** Global answer satisfaction rate (up / total feedback). Added by /api/metrics. */
  satisfactionRate?: number;
  /** Total feedback votes received. Added by /api/metrics. */
  feedbackTotal?: number;
  /** Coarse first-party event totals; never unique-user or wallet counts. */
  activationFunnel?: ActivationFunnel;
}

/** One day's settled USDC volume. `day` is a UTC `YYYY-MM-DD` key. */
export interface DailyVolume {
  day: string;
  usdc: number;
}
