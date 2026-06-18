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
  createdAt: string;
}

export type TracePhase =
  | "decompose"
  | "discover"
  | "decide"
  | "fetch"
  | "sufficiency"
  | "synthesize"
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
}
