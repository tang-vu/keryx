import { createHash } from "node:crypto";
import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { normalizeStatement } from "../llm/cited-statement";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { CitedStatement } from "../agent/cited-statements";
import { MIN_REWARD_SUPPORT, type EvidenceLedger } from "../agent/evidence-ledger";
import { validAnswerTableRequest, type AnswerTableRequest } from "./answer-table-request";

const plain = (max: number) => z.string().trim().min(1).max(max).refine(isWellFormedUtf16)
  .refine(value => !/[\p{Cc}\u2028\u2029]|\[\s*S\d+\s*\]/u.test(value));
const id = z.string().regex(/^e(?:[1-9]|[12]\d|3[0-2])$/u);
const ids = z.array(id).min(1).max(4).refine(rows => new Set(rows).size === rows.length);
const cellSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("label"), text: plain(100) }).strict(),
  z.object({ kind: z.literal("facts"), evidenceIds: ids }).strict(),
  z.object({ kind: z.literal("proposal"), text: plain(400), premiseIds: ids, conditions: z.array(plain(180)).min(1).max(2) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
const tableSchema = z.object({ columns: z.array(plain(80)).min(2).max(5), rows: z.array(z.array(cellSchema).min(2).max(5)).min(1).max(8) }).strict()
  .refine(table => new Set(table.columns).size === table.columns.length && table.rows.every(row => row.length === table.columns.length));
const premiseSchema = z.object({ id, statement: z.object({ claimIndex: z.number().int().min(0).max(7), marker: z.string().regex(/^S\d+$/u),
  text: plain(321), quote: z.string().min(8).max(240).refine(isWellFormedUtf16) }).strict() }).strict();
const bodySchema = z.object({ version: z.literal(1), originalQuestion: z.string().min(1).max(2_000),
  request: z.object({ version: z.literal(1), questionSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  table: tableSchema, premises: z.array(premiseSchema).min(1).max(32) }).strict();
export type AnswerTableCell = z.infer<typeof cellSchema>;
export type AnswerTablePacket = z.infer<typeof bodySchema> & { digest: string };
export interface ReviewedAnswerTable { packet: AnswerTablePacket; acceptedCells: string[]; layoutAccepted: boolean }
const capabilities = new WeakMap<ReviewedAnswerTable, string>();
const seal = (value: ReviewedAnswerTable) => JSON.stringify(value);
const digest = (body: z.infer<typeof bodySchema>) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
const refs = (cell: AnswerTableCell) => cell.kind === "facts" ? cell.evidenceIds : cell.kind === "proposal" ? cell.premiseIds : [];
const cellKey = (row: number, column: number) => `${row}:${column}`;
function dependencies(body: z.infer<typeof bodySchema>): boolean {
  const premises = new Map(body.premises.map(row => [row.id, row.statement]));
  return premises.size === body.premises.length && body.table.rows.flat().some(cell => refs(cell).length > 0) &&
    body.table.rows.flat().every(cell => refs(cell).every(id => premises.has(id)) &&
      new Set(refs(cell).map(id => JSON.stringify(premises.get(id)))).size === refs(cell).length);
}

export function prepareAnswerTable(request: AnswerTableRequest, question: string, evidence: readonly ProposedEvidence[], raw: unknown): AnswerTablePacket | undefined {
  if (!validAnswerTableRequest(request, question) || evidence.length > 32) return;
  const premises = evidence.flatMap((row, index) => {
    const parsed = premiseSchema.safeParse({ id: `e${index + 1}`, statement: { claimIndex: row.claimIndex, marker: row.marker,
      text: normalizeStatement(row.statement), quote: row.quote } });
    return parsed.success ? [parsed.data] : [];
  });
  const parsed = bodySchema.safeParse({ version: 1, originalQuestion: question, request, table: raw, premises });
  if (!parsed.success || !dependencies(parsed.data)) return;
  return { ...parsed.data, digest: digest(parsed.data) };
}

export function validAnswerTablePacket(packet: AnswerTablePacket): boolean {
  try {
    const { digest: retained, ...body } = packet, parsed = bodySchema.safeParse(body);
    return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(body) && digest(body) === retained &&
      validAnswerTableRequest(body.request, body.originalQuestion) && dependencies(body);
  } catch { return false; }
}
const verdict = z.enum(["supported", "unsupported", "insufficient"]);
// Compact fixed tuples retain every judgment while leaving the unchanged output
// ceiling to the factual review. Positions are row, column, association, content,
// conditions, language; no field may be omitted or inferred.
const reviewSchema = z.object({ digest: z.string(), layout: verdict, cells: z.array(z.tuple([
  z.number().int().min(0).max(7), z.number().int().min(0).max(4), verdict, verdict, verdict, verdict,
])).min(2).max(40) }).strict();

export function reviewAnswerTable(packet: AnswerTablePacket, raw: unknown): ReviewedAnswerTable | undefined {
  if (!validAnswerTablePacket(packet)) return;
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success || parsed.data.digest !== packet.digest) return;
  const expected = new Set(packet.table.rows.flatMap((row, ri) => row.map((_cell, ci) => cellKey(ri, ci))));
  if (parsed.data.cells.length !== expected.size || new Set(parsed.data.cells.map(cell => cellKey(cell[0], cell[1]))).size !== expected.size ||
      parsed.data.cells.some(cell => !expected.has(cellKey(cell[0], cell[1])))) return;
  const value = { packet: structuredClone(packet), layoutAccepted: parsed.data.layout === "supported", acceptedCells: parsed.data.cells
    .filter(cell => cell.slice(2).every(v => v === "supported"))
    .map(cell => cellKey(cell[0], cell[1])) };
  capabilities.set(value, seal(value)); return value;
}

export type DeliveredAnswerTableCell = { kind: "label"; text: string } | { kind: "unknown" } |
  { kind: "facts"; statements: CitedStatement[] } | { kind: "proposal"; text: string; conditions: string[]; statements: CitedStatement[] };
export interface AnswerTableDelivery { columns: string[]; rows: DeliveredAnswerTableCell[][]; incomplete: boolean }

/** Projection only, after final fact admission. Rejected association/labels refuse
 * the layout; rejected facts/proposals become explicit unknowns in the same cell. */
export function deliverAnswerTable(request: AnswerTableRequest, value: ReviewedAnswerTable | undefined,
  ledger: EvidenceLedger, statements: readonly CitedStatement[]): AnswerTableDelivery | undefined {
  try {
    if (!value || !validAnswerTablePacket(value.packet) || capabilities.get(value) !== seal(value) || !value.layoutAccepted ||
        JSON.stringify(request) !== JSON.stringify(value.packet.request)) return;
  } catch { return; }
  const { table, premises } = value.packet;
  if (table.rows.some((row, ri) => row.some((cell, ci) => cell.kind === "label" && !value.acceptedCells.includes(cellKey(ri, ci))))) return;
  let incomplete = false, populated = false;
  const rows = table.rows.map((row, ri) => row.map((cell, ci): DeliveredAnswerTableCell => {
    const resolved = refs(cell).map(id => premises.find(row => row.id === id)!.statement);
    if (!value.acceptedCells.includes(cellKey(ri, ci)) || cell.kind === "unknown" ||
        !resolved.every(statement => finalPremise(statement, ledger, statements))) { incomplete = true; return { kind: "unknown" }; }
    if (cell.kind === "label") return { ...cell };
    populated = true;
    return cell.kind === "facts" ? { kind: "facts", statements: structuredClone(resolved) } :
      { kind: "proposal", text: cell.text, conditions: [...cell.conditions], statements: structuredClone(resolved) };
  }));
  return populated ? { columns: [...table.columns], rows, incomplete } : undefined;
}
function finalPremise(statement: CitedStatement, ledger: EvidenceLedger, statements: readonly CitedStatement[]): boolean {
  if (!statements.some(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker && row.quote === statement.quote && row.text === statement.text) ||
      !ledger.acceptedMarkers.has(statement.marker) || !((ledger.claimCoverage.find(row => row.claimIndex === statement.claimIndex)?.coverage ?? 0) >= MIN_REWARD_SUPPORT)) return false;
  const rows = ledger.evidence.filter(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker && row.quote === statement.quote && row.qualifiesForAnswer);
  return rows.length > 0 && rows.every(row => !!row.sourceId) && new Set(rows.map(row => JSON.stringify([row.sourceId, row.itemId ?? null, row.itemUrl ?? null, row.contentVersion ?? null]))).size === 1;
}

export const ANSWER_TABLE_SCHEMA = '{"columns":string[],"rows":[[{"kind":"label","text":string}|{"kind":"facts","evidenceIds":string[]}|{"kind":"proposal","text":string,"premiseIds":string[],"conditions":string[]}|{"kind":"unknown"}]]}';
export const ANSWER_TABLE_GENERATION_GUIDANCE =
  " Also return answerTable matching the ORIGINAL caller's requested rows/columns, with2-5 unique column names<=80 characters and1-8 rectangular rows. " +
  "Each cell is label (a subject/category only, text<=100), facts (evidenceIds), proposal (text<=400, premiseIds,1-2 explicit hypothetical conditions<=180), or unknown (no other fields). " +
  "IDs e1..e32 refer to positions in the evidence array INCLUDING unresolved rows; use1-4 distinct IDs per facts/proposal cell. Facts cells contain no rewritten factual text. " +
  "Headers/labels must not assert unsupported facts. Preserve exact requested versions, source limitations and comparison dimensions. Use unknown for unestablished cells. " +
  "Proposals are conditional design suggestions only, never claimed source-tested steps, established facts, guaranteed outcomes or medical/legal/financial recommendations. Classroom activities and lesson scripts are excluded. " +
  "Preserve all factual evidence and qualifications first within the UNCHANGED output budget; omit answerTable if it cannot fit. Use the caller's language. No additional generation call is available.";
export const ANSWER_TABLE_REVIEW_SCHEMA = '{"digest":string,"layout":"supported"|"unsupported"|"insufficient","cells":[[row:number,column:number,association:verdict,content:verdict,conditions:verdict,language:verdict]]}';
export const ANSWER_TABLE_REVIEW_GUIDANCE =
  " Independently review answerTable against its ORIGINAL full caller question, exact premises and ALL factual source context. Return answerTableReview with the immutable digest and EVERY cell exactly once by zero-based row/column. " +
  "Each cell judgment is the fixed six-element tuple [row,column,association,content,conditions,language]; each of the four verdicts is supported, unsupported or insufficient. Preserve all factual review rows first within the unchanged output ceiling. " +
  "layout requires correct caller-requested subjects, dimensions, versions, headers, scope and language; do not narrow a requested comparison or claim completeness. Reject a layout whose headers imply unsupported facts. " +
  "association checks that each cell's full referenced facts/proposals belong to its exact row AND column. content checks every fact against its unchanged referenced statement and context; labels must be only subjects/categories, not new assertions. " +
  "Proposal content must be clearly hypothetical, grounded in ALL referenced premises, with no invented independent facts, numerical efficacy, source-performed claims, guarantees or medical/legal/financial recommendations. Reject classroom activities/lesson scripts. " +
  "conditions must preserve every missing input and factual qualification; language must match the caller. Unknown cells do not establish absence or negative evidence. " +
  "Any unsupported or unreviewed prerequisite is insufficient. Do not rewrite or repair. This review cannot change factual review/support, payment, contribution weights, completeness or execution authority.";
