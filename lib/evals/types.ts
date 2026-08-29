import type { DecisionAction, PaymentRecord, QueryRun, ResearchMode, Source, SourceItem } from "../types";

export const EVAL_SCHEMA_VERSION = 1;

export interface AgentEvalCase {
  id: string;
  description: string;
  question: string;
  budget: number;
  researchMode?: ResearchMode;
  sources: Array<{ source: Source; items: SourceItem[] }>;
  expected: {
    allowedCitationSourceIds: string[];
    requiredCitationSourceIds?: string[];
    allowedReadSourceIds?: string[];
    requiredReadSourceIds?: string[];
    forbiddenReadSourceIds?: string[];
    decisions?: Record<string, DecisionAction>;
    minGroundedClaimRate?: number;
    maxTotalSpentUsdc?: number;
  };
}

export interface EvalMetrics {
  citationPrecision: number;
  citationRecall: number;
  readPrecision: number;
  readRecall: number;
  decisionAccuracy: number;
  groundedClaimRate: number;
  evidenceYield: number;
  spendEfficiency: number;
}

export interface EvalCaseResult {
  caseId: string;
  description: string;
  score: number;
  passed: boolean;
  hardFailures: string[];
  metrics: EvalMetrics;
  summary: {
    citedSourceIds: string[];
    readSourceIds: string[];
    totalSpentUsdc: number;
    durationMs: number;
    confidence: QueryRun["confidence"];
  };
}

export interface EvalReport {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  corpusFingerprint: string;
  engine: string;
  generatedAt: string;
  caseCount: number;
  passed: boolean;
  score: number;
  hardFailureCount: number;
  metrics: EvalMetrics;
  cases: EvalCaseResult[];
}

export interface EvalBaseline {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  corpusFingerprint: string;
  engine: string;
  maxScoreRegression: number;
  score: number;
  cases: Record<string, number>;
}

export interface EvalRunObservation {
  run: QueryRun;
  payments: PaymentRecord[];
}
