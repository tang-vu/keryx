/** Additional ordinary-answer directives. Callers retain their own scope gates;
 * this helper neither detects arbitrary prose language nor changes a question. */
export type AdditionalAnswerLanguage = "de" | "ja" | "ko" | "hi" | "id" | "ru" | "ar";
export function isAdditionalAnswerLanguage(value: unknown): value is AdditionalAnswerLanguage {
  return value === "de" || value === "ja" || value === "ko" || value === "hi" || value === "id" || value === "ru" || value === "ar";
}
export interface NativeAnswerInstruction {
  index: number;
  end: number;
  language: AdditionalAnswerLanguage | "en";
  eligible: boolean;
}

const names = new Map<string, AdditionalAnswerLanguage | "en">([
  ["arabic", "ar"], ["العربية", "ar"], ["الإنجليزية", "en"], ["الانجليزية", "en"],
  ["german", "de"], ["deutsch", "de"], ["japanese", "ja"], ["日本語", "ja"],
  ["korean", "ko"], ["한국어", "ko"], ["hindi", "hi"], ["हिंदी", "hi"], ["हिन्दी", "hi"],
  ["indonesian", "id"], ["indonesia", "id"], ["englisch", "en"], ["英語", "en"],
  ["영어", "en"], ["अंग्रेजी", "en"], ["अंग्रेज़ी", "en"], ["inggris", "en"],
  ["russian", "ru"], ["русски", "ru"], ["русском", "ru"], ["английски", "en"], ["английском", "en"],
].map(([name, language]) => [name.normalize("NFC"), language as AdditionalAnswerLanguage | "en"]));

const forms = [
  String.raw`(?<![\p{L}\p{N}_])(?:(?:then|now)\s+)?(?:please\s+)?(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+(german|japanese|korean|hindi|indonesian|russian|arabic)(?![\p{L}\p{N}_-])`,
  String.raw`(?<![\p{L}\p{N}_])(?:من\s+فضلك[،,]?\s+)?(?:أجب|اجب|اكتب|رد)\s+(?:باللغة\s+(العربية|الإنجليزية|الانجليزية)|ب(العربية|الإنجليزية|الانجليزية))(?![\p{L}\p{N}_-])`,
  String.raw`(?<![\p{L}\p{N}_])(?:(?:antworte|antworten\s+sie|schreibe|schreiben\s+sie)(?:\s+bitte)?\s+)?auf\s+(deutsch|englisch)(?![\p{L}\p{N}_-])`,
  String.raw`(日本語|英語)で\s*(?:回答して|答えて|返答して|書いて|説明して)(?:ください|下さい)`,
  String.raw`(한국어|영어)로\s*(?:답변|대답|답|응답|작성)해\s*(?:주세요|주십시오)`,
  String.raw`(?:कृपया\s+)?(हिंदी|हिन्दी|अंग्रेजी|अंग्रेज़ी)\s+में\s+(?:उत्तर|जवाब)\s+(?:दें|दीजिए)`,
  String.raw`(?<![\p{L}\p{N}_])(?:(?:tolong|mohon)\s+)?(?:jawab(?:lah)?|balas(?:lah)?|tulis(?:lah)?)\s+(?:dalam|menggunakan|dengan)\s+(?:bahasa\s+)?(indonesia|inggris)(?![\p{L}\p{N}_-])`,
  String.raw`(?<![\p{L}\p{N}_])(?:пожалуйста\s*,?\s+)?(?:ответь(?:те)?|отвечай(?:те)?|напиши(?:те)?|пиши(?:те)?)\s+(?:(?:только|пожалуйста)\s+)?(?:по-(русски|английски)|на\s+(русском|английском)(?:\s+языке)?)(?![\p{L}\p{N}_-])`,
].join("|").normalize("NFC");

/** Input is the caller's NFC-normalized original request. Keep recognized spans,
 * including refused spans, so a caller can exclude partial older regex matches. */
export function nativeAnswerInstructions(input: string): NativeAnswerInstruction[] {
  const text = input.slice(0, 30_000);
  const quoted = [...text.matchAll(/"[^"]*"|“[^”]*”|„[^“]*“|«[^»]*»|»[^«]*«|「[^」]*」|『[^』]*』|《[^》]*》|`[^`]*`|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  return [...text.matchAll(new RegExp(forms, "giu"))].map(match => {
    const index = match.index!, prefix = text.slice(0, index);
    const name = match.slice(1).find(Boolean)!.normalize("NFC").toLowerCase();
    const language = names.get(name)!;
    const clause = prefix.split(/[.!?;:。！？；：।؟؛\r\n\u2028\u2029]/u).at(-1)!;
    const negative = /(?:do\s+not|don't|never|not|nicht|jangan|(?<![\p{L}\p{N}_])(?:не(?:\s+(?:надо|нужно|следует))?|никогда(?:\s+не)?)|मत|नहीं|不要|别|別|勿|しないで(?:ください|下さい)?)\s*(?:(?:please|bitte|tolong|mohon|пожалуйста|कृपया)\s*)?$/iu.test(prefix.slice(-100));
    const inQuote = quoted.some(range => index >= range.start && index < range.end);
    const arabicNegative = /(?<![\p{L}\p{N}_])(?:لا|لن|ليس)\s*(?:من\s+فضلك[،,]?\s*)?$/u.test(prefix.slice(-100));
    // A finite source/title wrapper is original data, not an output instruction.
    const arabicTitle = language === "ar" && /(?:^|[.!?;؟؛\r\n])\s*(?:(?:source|page)(?:\s+title)?|title|العنوان|عنوان(?:\s+(?:المصدر|الصفحة|المقالة))?|المصدر)\s*[:：]\s*$/iu.test(prefix.slice(-120));
    return { index, end: index + match[0].length, language,
      eligible: !negative && !arabicNegative && !arabicTitle && !inQuote && /^\s*$/u.test(clause) };
  });
}
