import { createHash } from "node:crypto";
import { questionArxivIds, arxivDocumentId } from "../scholarly/arxiv-identity";
import { questionDois } from "../scholarly/doi";
import { requestedSourceUrls } from "./source-requirements";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { bibliographicOriginalRequestSchema, type BibliographicFieldName, type BibliographicOriginalRequest } from "./bibliographic-original-types";

declare const taskBrand: unique symbol;
export interface BibliographicTask {
  readonly [taskBrand]: true;
  readonly request: Readonly<BibliographicOriginalRequest>;
  readonly requestedFields: readonly BibliographicFieldName[];
  readonly requestedAuthorCount: 1 | 3;
  readonly originalQuestionSha256: string;
}
const observedTasks = new WeakSet<BibliographicTask>();

/** Mask examples/quoted instructions without borrowing authority from them. An
 * apostrophe inside French prose is punctuation, not a quoted instruction. */
function originalInstructionText(question: string): string {
  return question.replace(/```[^]*?```|`[^`\r\n]*`|"[^"\r\n]*"|“[^”\r\n]*”|«[^»\r\n]*»/gu, match => " ".repeat(match.length));
}
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[đĐ]/gu, "d").toLowerCase();

/** Deliberately narrow ordinary caller adapter. It recognizes an explicit
 * bibliographic-record instruction and requested metadata fields for one exact
 * DOI/versioned abstract page; it does not classify general scholarly work. */
export function recognizeBibliographicTask(originalQuestion: string): BibliographicTask | null {
  if (!originalQuestion || originalQuestion.length > 30000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(originalQuestion) || !isWellFormedUtf16(originalQuestion)) return null;
  const instruction = originalInstructionText(originalQuestion);
  const urls = requestedSourceUrls(instruction);
  if (urls.omitted || urls.scanTruncated || urls.questionTruncated || urls.urls.length > 1) return null;
  const arxivIds = questionArxivIds(instruction, 3), dois = questionDois(instruction, 3);
  if (arxivIds.length + dois.length !== 1) return null;
  if (urls.urls.some(raw => {
    try {
      const url = new URL(raw);
      if (url.search || url.hash || url.username || url.password || url.port || url.protocol !== "https:") return true;
      return arxivIds.length ? url.hostname !== "arxiv.org" || !url.pathname.startsWith("/abs/") || arxivDocumentId(raw) !== arxivIds[0]
        : !["doi.org", "dx.doi.org"].includes(url.hostname);
    } catch { return true; }
  })) return null;
  const text = normalize(instruction.replace(/https?:\/\/[^\s<>]+|10\.\d{4,9}\/[^\s<>]+/giu, match => {
    const punctuation = match.match(/[.,;]+$/u)?.[0] ?? "";
    return " ".repeat(match.length - punctuation.length) + punctuation;
  }));
  const clauses = text.split(/(?:[.!?;]\s+|\r?\n|:\s*)/u);
  const positive = clauses.filter(clause => !/^\s*(?:do not\b|don't\b|never\b|ne\s+[^]*?\bpas\b|n['’][^]*?\bpas\b|khong\b|dung\b)/u.test(clause));
  const commands = positive.join("\n");
  const en = /(?:^|[,\n]\s*)(?:please\s+)?(?:prepare|create|provide|give|make|write)\s+(?:(?:a|an|the|short|reusable|brief|exact|metadata-only|in english|in french|in vietnamese)\s+){0,6}(?:bibliograph(?:y|ic|ical)\s+(?:record|card|entry|reference)|metadata\s+(?:record|card))\b/u;
  const fr = /(?:^|[,\n]\s*)(?:preparez|fournissez|donnez|redigez|creez)\s+(?:(?:en francais|en anglais|en vietnamien|une|la|courte|breve|reutilisable)\s+){0,6}(?:notice|fiche|reference)(?:\s+bibliographique)?\b/u;
  const vi = /(?:^|[,\n]\s*)(?:hay\s+)?(?:tao|viet|lap|cung cap)\s+(?:(?:mot|ban|ngan|bang tieng viet|bang tieng anh|bang tieng phap)\s+){0,6}(?:ho so|the|ban ghi|tham chieu)\s+thu muc\b/u;
  const defaultLanguage = fr.test(commands) ? "fr" : vi.test(commands) ? "vi" : en.test(commands) ? "en" : undefined;
  if (!defaultLanguage || !/\b(?:bibliograph\p{L}*|metadata|metadonnees|thu muc)\b/u.test(commands)) return null;
  // Positive scientific requests remain ordinary research. Negative limitations
  // such as "do not summarize results" above cannot turn into requested findings.
  if (/\b(?:methods?|results?|findings?|experiments?|benchmarks?|proves?|methodes?|resultats?|experiences?|conclusions?|phuong phap|ket qua|thi nghiem)\b/u.test(commands) ||
      /\b(?:explain|discuss|summarize|analyze|analyse|compare|evaluate|assess|recommend|implement|design|interpret|calculate|critique|solve|test|expliquez|discutez|resumez|analysez|comparez|evaluez|recommandez|interpretez|demontrez|concevez|calculez|testez|giai thich|tom tat|so sanh|danh gia|de xuat|khuyen nghi|phan tich|chung minh|tinh toan|thiet ke|kiem tra|thu nghiem)\b/u.test(commands) ||
      /\b(?:read|summarize|analyze|analyse|compare|evaluate|lisez|resumez|analysez|comparez|evaluez|doc|tom tat|phan tich|so sanh)\b[^\n]{0,120}\b(?:full[- ](?:paper|text)|texte integral|toan van)\b/u.test(commands)) return null;
  if (/\b(?:in (?:spanish|german|portuguese|japanese|chinese|russian|arabic|italian|korean)|en (?:espagnol|allemand|portugais|japonais|chinois|russe|arabe|italien|coreen)|bang tieng (?:tay ban nha|duc|bo dao nha|nhat|trung|nga|a rap|y|han))\b/u.test(commands)) return null;
  const languages = new Set<BibliographicOriginalRequest["language"]>();
  for (const match of commands.matchAll(/\b(?:in (english|french|vietnamese)|en (anglais|francais|vietnamien)|bang tieng (anh|phap|viet))\b/gu)) {
    const name = match[1] ?? match[2] ?? match[3]!;
    languages.add(["french", "francais", "phap"].includes(name) ? "fr" : ["vietnamese", "vietnamien", "viet"].includes(name) ? "vi" : "en");
  }
  if (languages.size > 1) return null;
  const fields: BibliographicFieldName[] = [];
  if (/\b(?:title|titre|tieu de)\b/u.test(commands)) fields.push("title");
  if (/\b(?:authors?|auteurs?|tac gia)\b/u.test(commands)) fields.push("firstAuthor");
  if (/\b(?:identifier|identifiant|version|arxiv|doi|dinh danh|phien ban)\b/u.test(commands) || dois.length) fields.push("identifier");
  if (!fields.includes("title") || !fields.includes("firstAuthor") || !fields.includes("identifier")) return null;
  const requestedAuthorCount = /\b(?:first three authors|three first authors|trois premiers auteurs|ba tac gia dau tien)\b/u.test(commands) ? 3
    : /\b(?:first author|premier auteur|tac gia dau tien)\b/u.test(commands) ? 1 : undefined;
  if (!requestedAuthorCount || /\b(?:all authors|every author|tous les auteurs|tous auteurs|tat ca tac gia)\b/u.test(commands) ||
      /\b(?:two|four|five|six|seven|eight|nine|ten|deux|quatre|cinq|six|sept|huit|neuf|dix|hai|bon|nam|sau|bay|tam|chin|muoi|\d+)\s+(?:(?:first|premiers|dau tien)\s+)?(?:authors|auteurs|tac gia)\b/u.test(commands)) return null;
  if (/\b(?:year|annee|nam)\b/u.test(commands)) fields.push("year");
  if (/\b(?:journal|revue|tap chi)\b/u.test(commands)) fields.push("journal");
  if (/\bdoi\b/u.test(commands) || dois.length) fields.push("doi");
  if (/\b(?:status|statut|trang thai)\b/u.test(commands)) fields.push("status");
  const request = bibliographicOriginalRequestSchema.parse({ scope: "metadata-only", language: [...languages][0] ?? defaultLanguage,
    target: arxivIds.length ? { kind: "arxiv", id: arxivIds[0] } : { kind: "doi", doi: dois[0] } });
  Object.freeze(request.target);
  const task = Object.freeze({ request: Object.freeze(request), requestedFields: Object.freeze(fields), requestedAuthorCount,
    originalQuestionSha256: createHash("sha256").update(originalQuestion).digest("hex") }) as BibliographicTask;
  observedTasks.add(task);
  return task;
}

/** Serialized/model/source values never activate an ordinary metadata task. */
export function isObservedBibliographicTask(value: BibliographicTask): boolean {
  return observedTasks.has(value);
}
