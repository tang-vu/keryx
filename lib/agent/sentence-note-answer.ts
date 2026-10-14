import type { Confidence } from "../types";
import { confidenceBanner } from "../research/confidence-copy";
import type { CitedStatement } from "./cited-statements";
import { MIN_REWARD_SUPPORT, type EvidenceLedger } from "./evidence-ledger";

/** Only this renderer can enroll a note count. Transport/caller fields cannot. */
export interface SentenceNoteAnswer { readonly answer: string }
const noteCounts = new WeakMap<SentenceNoteAnswer, number>();

function enrolled(answer: string, count: number): SentenceNoteAnswer {
  const result = Object.freeze({ answer });
  noteCounts.set(result, count);
  return result;
}

/** Includes ALL visible text, quotations and notices; segmentation is not semantic verification. */
export function completeAnswerSentenceSegments(answer: string): number {
  return [...new Intl.Segmenter("es", { granularity: "sentence" }).segment(answer)]
    .filter(segment => segment.segment.trim().length > 0).length;
}

/** Post-attribution renderer only: never shorten, merge or translate an admitted statement. */
export function compactSentenceNoteAnswer(ledger: EvidenceLedger, statements: CitedStatement[], confidence: Confidence): SentenceNoteAnswer | undefined {
  const qualifying = ledger.evidence.filter(item => (item.qualifiesForAnswer ?? item.qualifiesForReward) && ledger.acceptedMarkers.has(item.marker));
  const bound = (statement: CitedStatement, item: EvidenceLedger["evidence"][number]) =>
    statement.claimIndex === item.claimIndex && statement.marker === item.marker && statement.quote === item.quote;
  // Removing repeated target scaffolding is safe only with complete, already admitted pairs.
  // Otherwise the original renderer must retain its targets, partial assessments and gaps.
  if (!statements.length || !ledger.claimCoverage.length ||
      ledger.claimCoverage.some(claim => !(claim.coverage >= MIN_REWARD_SUPPORT) || !statements.some(row => row.claimIndex === claim.claimIndex)) ||
      statements.some(row => !ledger.claimCoverage.some(claim => claim.claimIndex === row.claimIndex) || !qualifying.some(item => bound(row, item))) ||
      qualifying.some(item => !statements.some(row => bound(row, item))) ||
      [...ledger.acceptedMarkers].some(marker => !statements.some(row => row.marker === marker)) ||
      statements.some(row => completeAnswerSentenceSegments(row.text) !== 1 || !/[.!?…。]$/u.test(row.text) ||
        /[\r\n`*_\[\]<>]/u.test(row.text) || /[`*_]|\[S\d+\]|(?:^|\n)\s*[#>-]/u.test(row.quote))) return undefined;
  // Every admitted row stays in the note itself, even when that makes its count
  // unmet. The appendix carries exact originals, never extra factual statements.
  const note = statements.map((row, index) => `${row.text} [${row.marker}] (pasaje ${index + 1})`).join("\n\n");
  // Plain quoted text works in the established reading renderer and exports.
  // Unsafe Markdown originals retain the canonical renderer, never altered bytes.
  const passages = statements.map((row, index) =>
    `### Pasaje ${index + 1} — [${row.marker}], objetivo ${row.claimIndex + 1}\n\nTexto de la fuente: “${row.quote}”`).join("\n\n");
  const qualifications = confidenceBanner(
    "Resumen escrito por un modelo, con citas por frase. Cada frase aparece junto al texto original utilizado para revisarla.\n\n" +
    "Frases escritas y revisadas por modelos, sin verificación independiente. Los fragmentos establecen un vínculo con la fuente, " +
    "pero no demuestran su exactitud ni una síntesis completa. Las fuentes pueden ser incorrectas o contradictorias. Los pagos se registran por separado.",
    confidence, "es");
  return enrolled(`### Nota — ${statements.length} frases\n\n${note}\n\n### Apéndice de inspección — pasajes originales exactos\n\n${passages}\n\n### Calificaciones y avisos obligatorios\n\n${qualifications}`, statements.length);
}

/** Preserve private count metadata only while adding notices around the intact answer. */
export function withSentenceNoteNotices(note: SentenceNoteAnswer | undefined, addNotices: (answer: string) => string): SentenceNoteAnswer | undefined {
  if (!note) return undefined;
  const count = noteCounts.get(note), answer = addNotices(note.answer);
  if (count === undefined || !answer.includes(note.answer)) return undefined;
  return enrolled(answer, count);
}

/** Apply after operational notices; count ONLY enrolled note prose, not the appendix. */
export function finishSentenceNoteAnswer(fullAnswer: string, compact: SentenceNoteAnswer | undefined, requestedCount: number): {
  answer: string; outcome: "compact" | "compact-unmet" | "unmet"; sentenceSegments: number; noteSentenceCount?: number;
} {
  const count = compact && noteCounts.get(compact);
  if (count !== undefined && count === requestedCount)
    return { answer: compact!.answer, outcome: "compact", noteSentenceCount: count, sentenceSegments: completeAnswerSentenceSegments(compact!.answer) };
  const body = count === undefined ? fullAnswer : compact!.answer;
  const answer = `No fue posible presentar la nota en ${requestedCount} frases con todos los objetivos respaldados, sin eliminar ni inventar contenido; se conserva el contenido completo. Los pasajes originales y los avisos obligatorios se cuentan por separado de la nota.\n\n${body}`;
  return { answer, outcome: count === undefined ? "unmet" : "compact-unmet", ...(count === undefined ? {} : { noteSentenceCount: count }),
    sentenceSegments: completeAnswerSentenceSegments(answer) };
}
