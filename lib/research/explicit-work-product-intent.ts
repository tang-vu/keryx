/** Original caller text only. This recognizes an output request, never facts,
 * permission to execute steps, source instructions or a complete semantic plan. */
export function explicitWorkProductLabel(question: string): string | undefined {
  if (question.length > 2_000) return;
  const visible = withoutQuotedText(question).trimStart();
  // Prepared request envelopes retain their own parsers and rollout contracts.
  if (/(?:^|[\r\n\u2028\u2029])[^\S\r\n\u2028\u2029]*(?:Question|Constraints|Unread source leads)[:：]/u.test(visible) ||
      /(?:^|[\r\n\u2028\u2029])[^\S\r\n\u2028\u2029]*(?:(?:the|our|this)\s+)?(?:Source|Document|Article|Transcript|Nguồn(?!\s+lực\b)|Tài liệu|Trích đoạn|来源|文档|原文|摘录)(?=$|[\s:：])[^\r\n\u2028\u2029:：]{0,100}(?:\b(?:says|text|excerpt|content|quote|instructions|nói|ghi)\b|[:：])/iu.test(visible)) return;
  // Classroom generation remains behind its separate activation/review gates.
  if (/\b(?:classroom|lesson\s+plan|lesson\s+script|exit\s+question|classification\s+exercise)\b|giáo án|hoạt động (?:trên lớp|lớp học)|câu hỏi kết thúc|教案|课堂活动|退出问题/iu.test(visible)) return;
  // Do not append another format when the caller bounds the overall answer,
  // including clear spellings outside the legacy formatter's finite grammar.
  // Time horizons and quantities of people/records are not output-length units.
  if (/\b(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s\p{Pd}]+(?:sentences?|bullets?|words?)\b/iu.test(visible) ||
      /(?:\d{1,4}|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(?:câu|gạch đầu dòng|từ)(?=$|[^\p{L}\p{N}_])/iu.test(visible) ||
      /[〇零一二三四五六七八九十百千两\d]{1,6}\s*(?:句话|句子|句|个要点|条要点|个字|个词|字|词)/u.test(visible)) return;
  if (/\b(?:do\s+not|don't|should\s+not|must\s+not|never|no\s+need\s+to)\s+(?:give|create|make|prepare|draft|write|produce|propose|build|design|include)[^.!?\n]{0,80}\b(?:plan|checklist|runbook|roadmap|timeline|schedule|comparison|brief|memo|draft|outline)\b/iu.test(visible) ||
      /(?:đừng|không (?:cần|được|nên))[^.!?\n]{0,60}(?:kế hoạch|checklist|lộ trình|bản nháp|bảng so sánh)/iu.test(visible) ||
      /(?:不要|无需|不需要)[^。！？\n]{0,40}(?:计划|清单|检查表|比较表|草稿)/u.test(visible)) return;

  const patterns = [
    /(?:^|[.!?。！？\n]\s*)(?:(?:please\s+|(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:give|create|make|prepare|draft|write|produce|propose|build|design)\b|(?:I|we)\s+(?:need|want|would\s+like)\b)[^.!?\n]{0,120}?\b(checklist|check-list|runbook|roadmap|timeline|schedule|comparison\s+(?:table|note)|decision\s+memo|brief|memo|draft|outline|plan)\b/iu,
    /(?:^|[.!?。！？\n]\s*)(?:please\s+)?(compare|contrast)\b/iu,
    /(?:^|[.!?。！？\n]\s*)how\s+(?:can|should|could|would)\s+(?:I|we)\b[^.!?\n]{0,80}?\b(plan|prepare|organize|practise|practice|schedule|approach|verify|investigate|recover|back\s+up)\b/iu,
    /(?:^|[.!?。！？\n]\s*)(?:(?:xin\s+)?(?:hãy\s+)?(?:giúp\s+(?:tôi|mình|chúng tôi)\s+)?(?:tạo|lập|soạn|viết|đưa|cho|đề xuất|thiết kế|xây dựng|cung cấp)|(?:tôi|mình|chúng tôi)\s+(?:cần|muốn))[^.!?\n]{0,120}?(kế hoạch|checklist|danh sách kiểm tra|lộ trình|bảng so sánh|bản (?:nháp|đề xuất|ghi nhớ)|đề cương)/iu,
    /(?:^|[.!?。！？\n]\s*)(?:hãy\s+)?(so sánh|đối chiếu)/iu,
    /(?:^|[.!?。！？\n]\s*)(?:tôi|mình|chúng tôi)\s+(?:nên|có thể)\s+(chuẩn bị|lập kế hoạch|lên kế hoạch|sắp xếp|kiểm tra|tổ chức)[^.!?\n]{0,60}(?:thế nào|làm sao|ra sao)/iu,
    /(?:^|[.!?。！？\n]\s*)(?:(?:请|请你|请帮我|帮我|能否)\s*)?(?:给我|提供|生成|制定|拟定|整理|写|做|创建)[^。！？\n]{0,80}?(计划|清单|检查表|路线图|时间表|比较表|对比表|草稿|备忘录|提纲)/u,
    /(?:^|[.!?。！？\n]\s*)(?:(?:请|请你|请帮我|帮我|能否)\s*)?(比较|对比)/u,
    /(?:^|[.!?。！？\n]\s*)(?:我|我们)[^。！？\n]{0,200}?(?:可以)?(?:怎样|怎么|如何)[^。！？\n]{0,30}?(准备|安排|规划|练习)/u,
  ];
  for (const pattern of patterns) {
    const label = pattern.exec(visible)?.[1];
    if (label) return label;
  }
  // A prospective application question can request a draft without naming a
  // plan/checklist. Existing labels above retain precedence and their contract.
  const prospective = [
    /(?:^|[.!?。！？\r\n\u2028\u2029])\s*how\s+(?:can|should|could|would)\s+(?:I|we|you)\s+(?:(?:best|safely|reliably|practically)\s+)?(make|design|build|structure|configure|implement|adapt|apply|handle|troubleshoot|set up)\b(?=\s+[^?\r\n\u2028\u2029]*[\p{L}\p{N}])/iu,
    /(?:^|[.!?。！？\r\n\u2028\u2029])\s*(?:xin\s+)?(?:hãy\s+)?(?:đề xuất|gợi ý)\s+(?:(?:một|vài)\s+)?(cách|phương án|quy trình|các bước)(?![\p{L}\p{N}_])/iu,
    /(?:^|[.!?。！？\r\n\u2028\u2029])\s*(?:tôi|mình|chúng tôi)\s+(?:nên|có thể)\s+(làm|thiết kế|xây dựng|cấu hình|triển khai|áp dụng|xử lý)[^.!?\r\n\u2028\u2029]{0,160}(?:thế nào|làm sao|ra sao)/iu,
  ].map(pattern => pattern.exec(visible)?.[1]).find(Boolean);
  // First-person method questions request an approach for the caller's work.
  // Recognize actions across subjects; no topic, source or customer allowlist.
  // Keep descriptive third-person and dictionary questions on ordinary facts.
  const practical = prospective ? undefined : [
    /(?:^|[.!?。！？\r\n\u2028\u2029])\s*how\s+(?:can|should|could|would)\s+(?:I|we)\s+(?:(?:best|safely|reliably|practically)\s+)?(prevent|avoid|measure|estimate|triage|prioritize|identify|separate|scope|sample|evaluate|test|validate|track|monitor|reduce|improve|run|keep|stop|pass|distinguish|decide|select|set|define)\b(?=\s+[^.!?\r\n\u2028\u2029]*[\p{L}\p{N}])(?!\s+(?:the\s+)?(?:word|term|phrase|meaning|concept)\b)/iu,
    /(?:^|[.!?。！？\r\n\u2028\u2029])\s*(?:tôi|mình|chúng tôi)\s+(?:nên|có thể)\s+(đo lường|ước tính|phân loại|ưu tiên|ngăn|tránh|phân biệt|đánh giá|lựa chọn|kiểm chứng)[^.!?\r\n\u2028\u2029]{0,160}(?:thế nào|làm sao|ra sao)/iu,
  ].map(pattern => pattern.exec(visible)?.[1]).find(Boolean);
  if (!prospective && !practical) return;
  // Restrict additional exclusions to the new forms, preserving old labels.
  if (practical && /\b(?:do not|don't|never|no need to)\s+(?:give|create|make|prepare|draft|write|produce|propose|build|design|include|suggest)[^.!?\r\n\u2028\u2029]{0,80}\b(?:methods?|recommendations?|suggestions?)\b/iu.test(visible)) return;
  // These new forms cannot bypass an explicit no-procedure instruction, a
  // bounded answer format, or the separate classroom-generation rollout.
  if (/\b(?:do not|don't|never|no need to)\s+(?:give|create|make|prepare|draft|write|produce|propose|build|design|include)[^.!?\r\n\u2028\u2029]{0,80}\b(?:steps|workflow|procedure|approach)\b/iu.test(visible) ||
      /(?:đừng|không (?:cần|được|nên))[^.!?\r\n\u2028\u2029]{0,80}(?:cách|phương án|quy trình|các bước)/iu.test(visible) ||
      /\b(?:lesson|classroom|classwork|workshop)\b|\b(?:activity|exercise)\b[^.!?\r\n\u2028\u2029]{0,60}\b(?:class|students|pupils)\b|(?:bài tập|hoạt động)[^.!?\r\n\u2028\u2029]{0,60}(?:học sinh|lớp học)/iu.test(visible) ||
      /(?<![\p{L}\p{N}_])(?:\d{1,4}|um|uma|uno|una|dois|dos|três|tres|quatro|cuatro|cinco|seis|sete|siete|oito|ocho|nove|nueve|dez|diez|onze|once|doze|doce)\s+(?:palavras?|palabras?|frases?|oraciones|oración|tópicos?|pontos?|puntos?)(?![\p{L}\p{N}_])/iu.test(visible)) return;
  return prospective ?? practical;
}

/** Mask quoted/code spans before recognizing intent, preserving offsets and the
 * original digest input. Apostrophes inside words are not quotation delimiters. */
function withoutQuotedText(value: string): string {
  const closeFor: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』", "«": "»" };
  let visible = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const fence = char === "`" || char === "~" ? value.slice(index).match(/^(?:`+|~{3,})/u)?.[0] : undefined;
    const delimiter = fence ?? (closeFor[char] && (char !== "'" || index === 0 || !/[\p{L}\p{N}]/u.test(value[index - 1])) ? closeFor[char] : undefined);
    if (!delimiter) { visible += char; continue; }
    const start = index; index += fence?.length ?? 1;
    for (; index < value.length; index++) {
      if (!fence && value[index] === "\\") { index++; continue; }
      if (value.startsWith(delimiter, index)) { index += delimiter.length; break; }
    }
    visible += value.slice(start, index).replace(/[^\r\n\u2028\u2029]/gu, " "); index--;
  }
  return visible.replace(/^[^\S\r\n\u2028\u2029]*>[^\r\n\u2028\u2029]*/gmu, " ");
}
