/**
 * Question bank for the volume engine. Real questions across the registered sources' topics,
 * so the agent produces genuine buy/skip/citation activity (and some off-topic ones so it
 * demonstrates restraint — buying nothing is also a valid, logged decision).
 */

export const SEED_QUESTIONS: string[] = [
  "How do x402 and stablecoin micropayments enable autonomous AI agent commerce?",
  "Why does a stable unit of account matter for an agent operating under a budget?",
  "How do nanopayments make sub-cent per-citation payments economical?",
  "How can a single citation reward be split fairly across multiple authors?",
  "What turns AI automation into genuine agency when spending money?",
  "How does HTTP 402 work as a payment rail for autonomous agents?",
  "Why is instant onchain settlement important for machine-to-machine commerce?",
  "How do idempotency keys prevent double-spends in a high-frequency payment agent?",
  "What is the role of batching in gas-efficient micropayment settlement?",
  "How should an agent decide when a cheaper source is good enough?",
  "When should a reading agent stop buying sources and just answer?",
  "How can creators be paid in proportion to how much they grounded an answer?",
  "What are the trade-offs between caching content and re-fetching it under a budget?",
  "How do stablecoins like USDC reduce settlement risk for an autonomous buyer?",
  "Why is weighted contribution a fairer model than flat per-fetch payment?",
];

/** Deterministic pick by index (avoids Math.random for reproducibility). */
export function pickQuestion(i: number): string {
  return SEED_QUESTIONS[i % SEED_QUESTIONS.length];
}
