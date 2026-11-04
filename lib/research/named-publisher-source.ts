import { requestedSourceUrls } from "./source-requirements";

type NamedPublisher = "mdn" | "nasa" | "noaa";
const sites: Readonly<Record<NamedPublisher, { host: string; subdomains: boolean }>> = Object.freeze({
  mdn: { host: "developer.mozilla.org", subdomains: false },
  nasa: { host: "nasa.gov", subdomains: true },
  noaa: { host: "noaa.gov", subdomains: true },
});

/** Original caller syntax only. Source text cannot create or relax a requirement. */
function visibleInstructions(question: string): string {
  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』", "«": "»" };
  let visible = "";
  for (let i = 0; i < question.length; i++) {
    const char = question[i];
    let delimiter: string | undefined;
    if (char === "`") delimiter = question.slice(i).match(/^`+/u)![0];
    else if (pairs[char] && (char !== "'" || i === 0 || !/[\p{L}\p{N}]/u.test(question[i - 1]))) delimiter = pairs[char];
    if (!delimiter) { visible += char; continue; }
    const start = i, opening = char === "`" ? delimiter.length : 1;
    i += opening;
    for (; i < question.length; i++) {
      if (char !== "`" && question[i] === "\\") { i++; continue; }
      if (question.startsWith(delimiter, i)) { i += delimiter.length; break; }
    }
    visible += question.slice(start, i).replace(/[^\r\n]/gu, " "); i--;
  }
  // Prepared/private envelopes have an existing independent interpretation.
  if (/(?:^|[\r\n\u2028\u2029])[^\S\r\n\u2028\u2029]*(?:Question|Constraints|Unread source leads):/u.test(visible)) return "";
  // Preserve the caller's preceding instruction, while ignoring attributed text.
  const attributed = /(?:^|[\r\n\u2028\u2029])[^\S\r\n\u2028\u2029]*(?:(?:the|our|this)[^\S\r\n\u2028\u2029]+)?(?:Source|Document|Article|Transcript|Nguồn|Tài liệu|Trích đoạn|来源|文档|原文|摘录)(?=$|[\s:：])[^\r\n\u2028\u2029:：]*(?:\b(?:says|text|excerpt|content|quote|instructions|nói|ghi)\b|[:：])/iu.exec(visible);
  return attributed ? visible.slice(0, attributed.index) : visible;
}

/** A finite single-publisher requirement, never a semantic source classifier.
 * Mixed, negated, quoted and unsupported requests keep their existing handling. */
export function requestedNamedPublisher(question: string): NamedPublisher | undefined {
  if (typeof question !== "string" || question.length > 30_000) return;
  const visible = visibleInstructions(question);
  const text = visible.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/gu, "d").toLowerCase();
  const clauses = text.split(/(?<=[.!?;])\s+|[\r\n\u2028\u2029]+/u).map(clause => clause.trim()).filter(Boolean);
  const name = "(mdn|nasa|noaa)";
  const document = "(?:documentation|docs|manuals?|sources?|material)";
  const patterns = [
    new RegExp(`^(?:please\\s+)?(?:use|using|based on|according to|consult|cite|rely on)\\s+(?:the\\s+)?official\\s+${name}\\s+${document}\\b`, "u"),
    new RegExp(`^(?:please\\s+)?(?:use|using|based on|according to|consult|cite|rely on)\\s+(?:the\\s+)?${name}(?:'s|’s)?\\s+official\\s+${document}\\b`, "u"),
    new RegExp(`^(?:please\\s+)?only use\\s+${name}(?:\\s+${document})?\\b`, "u"),
    new RegExp(`^(?:hay\\s+)?(?:dung|su dung|chi dung|dua tren|dua vao|theo|tham khao|trich dan)\\s+(?:cac\\s+)?(?:tai lieu|huong dan|nguon)\\s+${name}\\s+chinh thuc\\b`, "u"),
    new RegExp(`^(?:hay\\s+)?(?:dung|su dung|chi dung|dua tren|dua vao|theo|tham khao|trich dan)\\s+(?:cac\\s+)?(?:tai lieu|huong dan|nguon)\\s+chinh thuc\\s+(?:cua\\s+)?${name}\\b`, "u"),
    new RegExp(`^(?:hay\\s+)?(?:chi dung|chi su dung)\\s+(?:(?:nguon|tai lieu)\\s+)?${name}\\b`, "u"),
    new RegExp(`^(?:use|utilize|consulte|cite|com base em)\\s+(?:a\\s+)?(?:documentacao|fontes?|material)\\s+oficia(?:l|is)\\s+(?:(?:da|do|de)\\s+)?${name}\\b`, "u"),
    new RegExp(`^(?:use|utilize)\\s+(?:apenas|somente)\\s+(?:fontes?\\s+(?:(?:da|do|de)\\s+)?)?${name}\\b`, "u"),
    new RegExp(`^(?:use|utilice|utiliza|consulte|cite|basese en|segun)\\s+(?:la\\s+)?(?:documentacion|fuentes?|material)\\s+oficial(?:es)?\\s+(?:de\\s+)?${name}\\b`, "u"),
    new RegExp(`^(?:use|utilice|usa)\\s+(?:solo|solamente)\\s+(?:fuentes?\\s+(?:de\\s+)?)?${name}\\b`, "u"),
  ];
  const requested = new Set<NamedPublisher>();
  const recognized = new Set<string>();
  for (const clause of clauses) for (const pattern of patterns) {
    const directive = clause.replace(/^(?:also|then|tambem|ademas|roi)\s+/u, "");
    const match = pattern.exec(directive);
    if (!match) continue;
    const rest = directive.slice(match[0].length);
    // A brand-shaped prefix in a hostname is not that named publisher.
    if (/^\.[\p{L}\p{N}_-]/u.test(rest)) continue;
    const addition = /^\s*(?:,\s*|(?:and\/or|as well as|alongside|and|or|with|plus|va|voi|hoac|hay|e|com|ou|y|con|o|[&/])\s+)(.+)$/u.exec(rest)?.[1];
    if (addition && !/^(?:explain|describe|summarize|answer|write|clarify|keep|preserve|show|give|provide|giai thich|viet|neu|trinh bay|giu|explique|describa|escreva|responda)\b/u.test(addition)) return;
    requested.add(match[1] as NamedPublisher); recognized.add(clause);
  }
  if (requested.size !== 1) return;
  const publisher = [...requested][0];
  const negated = new RegExp(`\\b(?:do not|don't|never|khong|dung dung|nao|no)\\s+(?:use|read|cite|consult|dung|su dung|doc|trich dan|utilize|utilice|consulte)\\b[^.!?;]{0,100}\\b${publisher}\\b`, "u");
  if (negated.test(text)) return;
  // A different requested source is not silently narrowed to this publisher.
  const otherSource = /\b(?:blogs?|forums?|community|user experiences|wikipedia|stackoverflow|rednafi|independent sources|third.party sources|other sources|dien dan|nguon khac|fontes alternativas|otras fuentes)\b/u;
  const positive = /^(?:(?:and|also|then|va|roi|e|tambem|y|ademas)\s+)?(?:use|read|cite|consult|include|consider|summarize|compare|contrast|based on|according to|doc|su dung|tham khao|trich dan|so sanh|dua tren|theo|consulte|inclua|lea|utilice|com base em|segun|basese en)\b/u;
  for (const clause of clauses) {
    if (!recognized.has(clause) && positive.test(clause)) {
      if (otherSource.test(clause) || /\b(?:official|chinh thuc|oficial)\b/u.test(clause)) return;
      const named = /\b(mdn|nasa|noaa)\b/u.exec(clause)?.[1];
      if (named && named !== publisher) return;
      const sourceVerb = /^(?:(?:and|also|then|va|roi|e|tambem|y|ademas)\s+)?(?:use|read|cite|consult|doc|su dung|tham khao|trich dan|consulte|lea|utilice)\b/u.exec(clause);
      const formatOnly = /^(?:in|for|each|every|passages|excerpts|trechos|pasajes)\b/u.test(clause.slice(sourceVerb?.[0].length ?? 0).trim());
      if (sourceVerb && !named && !formatOnly) return;
    }
    if (/\b(?:with|alongside|versus|vs|voi|com|con)\s+/u.test(clause) && otherSource.test(clause)) return;
    if (/\b(?:and|also|va|e|y)\s+[^.!?;]{1,60}\b(?:documentation|docs|manuals|tai lieu|sources|fuentes|fontes)\b/u.test(clause) &&
        otherSource.test(clause)) return;
  }
  const supplied = requestedSourceUrls(visible);
  if (supplied.omitted || supplied.scanTruncated || supplied.questionTruncated ||
      supplied.urls.some(url => publisherSourceMismatch(publisher, url))) return;
  return publisher;
}

/** Matching a known hostname is only a necessary condition, never authorship,
 * document identity, truth, factual coverage or payment authority. */
export function publisherSourceMismatch(publisher: NamedPublisher | undefined, value: string | undefined): boolean {
  if (!publisher) return false;
  if (!Object.hasOwn(sites, publisher) || typeof value !== "string" || value.length > 2048) return true;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return true;
    const host = url.hostname.toLowerCase().replace(/\.$/u, ""), site = sites[publisher];
    return host !== site.host && !(site.subdomains && host.endsWith("." + site.host));
  } catch { return true; }
}
