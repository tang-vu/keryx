/**
 * Answer-archive selection: turns the raw run log into a public, index-worthy
 * corpus. Two jobs the SEO surface depends on:
 *   1. Keep only real answers — a non-empty answer that actually cited a source.
 *   2. Dedupe by question and recorded answer language — repeat questions can
 *      create near-identical pages that read as doorway spam to a crawler. We keep
 *      one canonical dispatch per question/language (the richest one) and drop the rest.
 * Pure functions so the page stays lean and the selection logic stays testable.
 */

import type { Confidence, QueryRun } from "./types";
import { deriveConfidence } from "./agent/confidence";
import { recordedAnswerLanguage } from "./research/answer-language-provenance";
import type { PresentationLanguage } from "../shared/i18n/presentation-language";

export interface ArchiveEntry {
  id: string;
  question: string;
  answerSnippet: string;
  citationCount: number;
  toCreators: number;
  totalSpent: number;
  sourceNames: string[];
  createdAt: string;
  /** The agent's own trust level for this answer, when it recorded one. */
  confidence: Confidence | null;
  /** Validated recorded output language; missing historical evidence stays undetermined. */
  answerLanguage?: string;
  /** Original rail for a retained historical record; never current payout authority. */
  archivedNetwork?: "eip155:5042002";
}

const SNIPPET_LEN = 220;
const METADATA_EXCERPT_LEN = 160;

/** Opening caveats the current delivery writer prepends. The preview may skip
 * only this exact wording; it never rewrites, translates or grades the answer. */
const OPENING_CAVEATS = [
  { label: "低置信度", closer: "请将此结果视为暂定结果。" },
  { label: "Low confidence", closer: "Treat this as provisional." },
  { label: "Độ tin cậy thấp", closer: "Kết quả chưa hoàn chỉnh." },
  { label: "Baixa confiança", closer: "Trate este resultado como provisório." },
  { label: "Confianza baja", closer: "Trate este resultado como provisional." },
  { label: "Confiance faible", closer: "Considérez ce résultat comme provisoire." },
] as const;

/** Exact introductions from the current grounded-answer writer. A later
 * original sentence may follow one of these; the stored answer is not edited. */
const DELIVERY_LEADS = [
  "摘要由模型撰写，逐句附有引用。每句话均与检查时使用的来源原文配对显示。",
  "仅提供来源摘录；草稿不作为结论呈现，综合结果的完整性仍未核实。研究目标是待调查的主题，并非已证实的结论。",
  "尚无证据支持的答案：综合或证据检查未能完成。原始阅读结果和凭证均已保留。",
  "尚无证据支持的答案：已读内容未能为研究目标提供获准使用的摘录。",
  "Model-written summary with sentence-level citations. Each sentence is followed by the verbatim source text it was checked against; sentences without a qualifying excerpt were removed.",
  "Source excerpts only. The draft is withheld as a conclusion; complete synthesis is unverified. Qualifying source excerpts are quoted below. Research targets are topics to investigate, not established conclusions.",
  "No supported answer. Synthesis or evidence review did not complete; evidence for the research targets could not be assessed. Original reads and receipts are retained.",
  "No supported answer. The read content supplied no qualifying excerpts for the research targets; the draft is withheld as a conclusion.",
  "Tóm tắt do mô hình viết, trích dẫn theo từng câu. Sau mỗi câu là nguyên văn đoạn nguồn mà câu đó đã được đối chiếu; câu không có trích đoạn đủ điều kiện đã bị loại.",
  "Bản nháp không được giữ như kết luận. Dưới đây chỉ giữ các trích đoạn nguồn đủ điều kiện; chưa xác minh được câu trả lời tổng hợp đầy đủ. Các chủ đề nghiên cứu không phải kết luận đã được chứng minh.",
  "Chưa có câu trả lời được bằng chứng hỗ trợ. Bước tổng hợp hoặc kiểm tra bằng chứng chưa hoàn tất; chưa thể đánh giá bằng chứng cho các yêu cầu nghiên cứu. Kết quả đọc và biên nhận gốc vẫn được giữ.",
  "Chưa có câu trả lời được bằng chứng hỗ trợ. Nội dung đã đọc chưa cung cấp trích đoạn đủ điều kiện cho các yêu cầu nghiên cứu; bản nháp không được giữ như kết luận.",
  "Resumo escrito por modelo, com citações por frase. Cada frase aparece junto ao trecho original usado na sua verificação.",
  "Apenas trechos das fontes; o rascunho foi retido e a síntese completa permanece não verificada.",
  "Não há resposta sustentada: a síntese ou a revisão das evidências não foi concluída. Leituras e recibos originais foram preservados.",
  "Não há resposta sustentada: o conteúdo lido não forneceu trechos qualificados para os objetivos de pesquisa.",
  "Resumen escrito por un modelo, con citas por frase. Cada frase aparece junto al texto original utilizado para revisarla.",
  "Solo fragmentos de las fuentes; el borrador no se presenta como conclusión y la síntesis completa sigue sin verificarse.",
  "No hay una respuesta respaldada: la síntesis o la revisión de las evidencias no se completó. Se conservan las lecturas y los recibos originales.",
  "No hay una respuesta respaldada: el contenido leído no proporcionó fragmentos admitidos para los objetivos de investigación.",
  "Résumé rédigé par un modèle, avec citations pour chaque phrase. Chaque phrase est accompagnée de l'extrait original utilisé pour la vérifier.",
  "Extraits des sources uniquement ; le brouillon n'est pas présenté comme une conclusion et l'exhaustivité de la synthèse reste non vérifiée.",
  "Aucune réponse étayée : la synthèse ou la vérification des preuves n'a pas abouti. Les lectures et reçus originaux sont conservés.",
  "Aucune réponse étayée : le contenu lu n'a fourni aucun extrait admis pour les objectifs de recherche.",
] as const;

const TARGET_LABELS = [
  { heading: "Research target", topic: "Requested topic (unverified)" },
  { heading: "Yêu cầu nghiên cứu", topic: "Chủ đề yêu cầu (chưa xác minh)" },
  { heading: "Objetivo de pesquisa", topic: "Tema solicitado (não verificado)" },
  { heading: "Objetivo de investigación", topic: "Tema solicitado (no verificado)" },
  // French typography places a space before the colon emitted by the renderer.
  { heading: "Objectif de recherche", topic: "Sujet demandé (non vérifié) " },
] as const;

/** Normalize a question for dedupe: lowercase, collapse whitespace, drop trailing punctuation. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().replace(/[?!.\s]+$/, "");
}

/** Strip citation markers and light markdown so a snippet / structured-data string reads as prose. */
export function cleanText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/\[S\d+\]/g, "") // citation markers like [S1]
    .replace(/[*_`>#]/g, "") // markdown emphasis / heading marks
    .replace(/\s+/g, " ")
    .trim();
}

function stripExactLead(text: string, lead: string): string | null {
  if (!text.startsWith(lead)) return null;
  const rest = text.slice(lead.length).trim();
  return rest || null;
}

function bulletNotice(count: number): string[] {
  return [
    `无法在保留每项研究目标和所有获准摘录的同时用 ${count} 个简短要点呈现；下文按研究目标展开。`,
    `Could not present ${count} short bullets while preserving every target and qualifying excerpt; the target layout follows.`,
    `Chưa thể trình bày ${count} gạch đầu dòng ngắn mà vẫn giữ mọi yêu cầu và trích đoạn đủ điều kiện; các yêu cầu được trình bày bên dưới.`,
    `Não foi possível apresentar ${count} tópicos curtos preservando todos os objetivos e trechos qualificados; os objetivos são apresentados abaixo.`,
    `No fue posible presentar ${count} puntos breves conservando todos los objetivos y fragmentos admitidos; los objetivos se presentan a continuación.`,
    `Impossible de présenter ${count} points courts tout en conservant chaque objectif et chaque extrait admis ; la présentation par objectif suit.`,
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Skip one exact target heading and its quoted requested topic when a later
 * sentence remains. A topic whose quote contains a closing curly quote stays. */
function skipTargetLabel(text: string): string | null {
  const chinese = /^研究目标 \d+ 所请求的主题（未核实）：“[^”]*”\s+([\s\S]+)$/u.exec(text);
  if (chinese?.[1]) return chinese[1];
  for (const label of TARGET_LABELS) {
    const pattern = new RegExp(`^${escapeRegExp(label.heading)} \\d+ ${escapeRegExp(label.topic)}: “[^”]*”\\s+([\\s\\S]+)$`, "u");
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Skip the fixed layout sentences that follow a confidence closer, or open an
 * unbannered answer. Evidence-gap and limitation sentences are not leads. */
function skipDeliveryLead(text: string): string | null {
  let rest = text;
  let changed = false;
  for (let count = 1; count <= 8 && !changed; count++) {
    for (const lead of bulletNotice(count)) {
      const notice = stripExactLead(rest, lead);
      if (!notice) continue;
      rest = notice;
      changed = true;
      break;
    }
  }
  for (const lead of DELIVERY_LEADS) {
    const next = stripExactLead(rest, lead);
    if (!next) continue;
    rest = next;
    changed = true;
    break;
  }
  const afterTarget = skipTargetLabel(rest);
  if (afterTarget) {
    rest = afterTarget;
    changed = true;
  }
  return changed ? rest : null;
}

/** When cleaned prose starts with a known delivery caveat and a later sentence
 * exists, keep the original short caution and return that later sentence.
 * A following fixed grounding introduction and the first target label are
 * skipped the same way. Anything else, including a caveat or lead with no
 * following sentence, stays intact. */
export function extractiveAnswerPreview(cleaned: string): string | null {
  let caution: string | null = null;
  let body = cleaned;
  for (const caveat of OPENING_CAVEATS) {
    const prefix = `⚠ ${caveat.label} — `;
    if (!cleaned.startsWith(prefix)) continue;
    const at = cleaned.indexOf(caveat.closer, prefix.length);
    if (at < 0) return null;
    const rest = cleaned.slice(at + caveat.closer.length).trim();
    if (!rest) return null;
    caution = prefix;
    body = rest;
    break;
  }
  const later = skipDeliveryLead(body);
  if (later === null) return caution ? `${caution}${body}` : null;
  return caution ? `${caution}${later}` : later;
}

function boundedPreview(text: string, limit: number, ellipsis: boolean): string {
  if (text.length <= limit) return text;
  const sliced = text.slice(0, limit).trimEnd();
  return ellipsis ? `${sliced}…` : sliced;
}

/** Archive card, topic row and Atom content share this extract. */
export function archiveAnswerSnippet(answer: string): string {
  const cleaned = cleanText(answer);
  return boundedPreview(extractiveAnswerPreview(cleaned) ?? cleaned, SNIPPET_LEN, true);
}

/** Dispatch metadata excerpt. Answers with no recognized lead keep the historical raw slice. */
export function metadataAnswerExcerpt(answer: string): string {
  const extracted = extractiveAnswerPreview(cleanText(answer));
  if (extracted === null) return answer.slice(0, METADATA_EXCERPT_LEN).replace(/\n/g, " ");
  return boundedPreview(extracted, METADATA_EXCERPT_LEN, false);
}

/** Pick the better run to represent a question: most citations, then most paid out, then newest. */
function betterThanEntry(run: QueryRun, entry: ArchiveEntry): boolean {
  if (run.citations.length !== entry.citationCount) return run.citations.length > entry.citationCount;
  if (run.totalToCreators !== entry.toCreators) return run.totalToCreators > entry.toCreators;
  return run.createdAt > entry.createdAt;
}

function toEntry(r: QueryRun, answerLanguage: PresentationLanguage | "und"): ArchiveEntry {
  return {
    id: r.id,
    question: r.question.trim(),
    answerSnippet: archiveAnswerSnippet(r.answer),
    citationCount: r.citations.length,
    toCreators: r.totalToCreators,
    totalSpent: r.totalSpent,
    sourceNames: [...new Set(r.citations.map((c) => c.sourceName).filter(Boolean))],
    createdAt: r.createdAt,
    confidence: deriveConfidence(r),
    answerLanguage,
  };
}

/**
 * Build the public answer archive from raw runs: real cited answers only,
 * one canonical dispatch per normalized question and recorded answer language, newest first.
 */
function retainCandidate(best: Map<string, ArchiveEntry>, run: QueryRun) {
  if (!run.answer?.trim() || !run.citations?.length) return;
  const question = normalizeQuestion(run.question);
  if (!question) return;
  const answerLanguage = recordedAnswerLanguage(run) ?? "und";
  const key = JSON.stringify([question, answerLanguage]);
  const previous = best.get(key);
  if (!previous || betterThanEntry(run, previous)) best.set(key, toEntry(run, answerLanguage));
}

function finishArchive(best: Map<string, ArchiveEntry>): ArchiveEntry[] {
  return [...best.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function buildArchive(runs: Iterable<QueryRun>): ArchiveEntry[] {
  const best = new Map<string, ArchiveEntry>();
  for (const run of runs) retainCandidate(best, run);
  return finishArchive(best);
}

/** Retain only slim winners; a failed scan never returns a partial archive. */
export async function buildArchiveStream(runs: AsyncIterable<QueryRun>): Promise<ArchiveEntry[]> {
  const best = new Map<string, ArchiveEntry>();
  for await (const run of runs) retainCandidate(best, run);
  return finishArchive(best);
}

/** The text an archive card is searchable by: its question and the sources it cited. Built on the
 *  server and handed to the filter, so the client never re-derives what a card "says". */
export function searchTerm(entry: Pick<ArchiveEntry, "question" | "sourceNames">): string {
  return `${entry.question} ${entry.sourceNames.join(" ")}`.toLowerCase();
}

// Words too common in questions to signal relatedness.
const STOPWORDS = new Set(
  "what who how why when where which does the and for are was were will would can could should has have had between from with this that not any their there".split(
    " ",
  ),
);

function questionTokens(q: string): Set<string> {
  return new Set(
    normalizeQuestion(q)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Pick the archive entries most related to one dispatch. Shared cited sources
 * are the strongest signal (same creators = same beat), question-keyword
 * overlap breaks ties. When nothing overlaps, fill with the newest entries so
 * every answer page still links into the corpus instead of dead-ending — the
 * archive is only crawlable if its pages point at each other.
 */
export function relatedAnswers(
  current: { id: string; question: string; sourceNames: string[] },
  archive: ArchiveEntry[],
  limit = 4,
): ArchiveEntry[] {
  const curKey = normalizeQuestion(current.question);
  const curTokens = questionTokens(current.question);
  const curSources = new Set(current.sourceNames);

  const candidates = archive.filter(
    (e) => e.id !== current.id && normalizeQuestion(e.question) !== curKey,
  );

  const scored = candidates
    .map((e) => {
      const sharedSources = e.sourceNames.filter((s) => curSources.has(s)).length;
      let sharedTokens = 0;
      for (const t of questionTokens(e.question)) if (curTokens.has(t)) sharedTokens++;
      return { e, score: sharedSources * 2 + sharedTokens };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.e.createdAt < b.e.createdAt ? 1 : -1))
    .map((x) => x.e);

  const picked = scored.slice(0, limit);
  // Candidates are already newest-first (buildArchive order), so the fill is too.
  for (const e of candidates) {
    if (picked.length >= limit) break;
    if (!picked.includes(e)) picked.push(e);
  }
  return picked;
}
