import type { AnswerPresentation } from "./answer-presentation";
import type { Confidence } from "../types";
import { nativeAnswerCopy, nativeCount } from "./native-answer-copy";
import { isAdditionalAnswerLanguage } from "./native-answer-intent";

type Language = AnswerPresentation["language"];
type Rationale = { kind: "no-citation" | "no-coverage" | "incomplete" | "explained-conflict" | "synthetic" }
  | { kind: "unresolved-conflict" | "gaps" | "publisher-groups" | "limited-sources"; count: number };

/** Copy only: the caller computes the same confidence level and evidence gates. */
export function evidenceConfidenceReason(language: Language, rationale: Rationale): string {
  if (isAdditionalAnswerLanguage(language)) {
    const native = nativeAnswerCopy(language)!;
    return nativeCount(native.confidence[rationale.kind], "count" in rationale ? rationale.count : 0);
  }
  switch (rationale.kind) {
    case "synthetic": return {
      "zh-Hans": "本次运行包含合成演示材料，不能用于建立事实置信度",
      en: "this run contains synthetic demo material, which cannot support factual confidence",
      vi: "lượt nghiên cứu có dữ liệu mô phỏng minh họa, không thể dùng để xác lập độ tin cậy thực tế",
      pt: "esta execução contém material sintético de demonstração, que não sustenta confiança factual",
      es: "esta ejecución contiene material sintético de demostración, que no respalda confianza factual",
      fr: "cette recherche contient des données synthétiques de démonstration, qui ne peuvent pas étayer une confiance factuelle",
    }[language];
    case "no-citation": return {
      "zh-Hans": "没有引用通过证据准入检查",
      en: "no citation passed the evidence gate", vi: "không có trích dẫn nào đáp ứng điều kiện bằng chứng",
      pt: "nenhuma citação passou pelo filtro de evidências", es: "ninguna cita superó el filtro de evidencias",
      fr: "aucune citation n'a satisfait les conditions de preuve",
    }[language];
    case "unresolved-conflict": return {
      "zh-Hans": `仍有 ${rationale.count} 项来源分歧未解决；覆盖评分不能消除相互矛盾的证据`,
      en: `${rationale.count} source disagreement${rationale.count === 1 ? " remains" : "s remain"} unresolved; coverage scores do not resolve conflicting evidence`,
      vi: `Có ${rationale.count} bất đồng nguồn chưa được giải quyết; điểm bao phủ không giải quyết bằng chứng mâu thuẫn`,
      pt: `${rationale.count} ${rationale.count === 1 ? "divergência entre fontes permanece" : "divergências entre fontes permanecem"} sem solução; pontuações de cobertura não resolvem evidências conflitantes`,
      es: `${rationale.count} ${rationale.count === 1 ? "discrepancia entre fuentes sigue" : "discrepancias entre fuentes siguen"} sin resolverse; las puntuaciones de cobertura no resuelven evidencias contradictorias`,
      fr: `${rationale.count} désaccord${rationale.count === 1 ? "" : "s"} entre sources non résolu${rationale.count === 1 ? "" : "s"} ; les scores de couverture ne résolvent pas les preuves contradictoires`,
    }[language];
    case "no-coverage": return {
      "zh-Hans": "没有可用的研究目标覆盖评估",
      en: "no sub-claim coverage is available", vi: "chưa có đánh giá bao phủ cho các yêu cầu nghiên cứu",
      pt: "não há avaliação de cobertura dos objetivos de pesquisa", es: "no hay evaluación de cobertura de los objetivos de investigación",
      fr: "aucune évaluation de couverture des objectifs de recherche n'est disponible",
    }[language];
    case "gaps": return {
      "zh-Hans": `仍有 ${rationale.count} 项研究目标低于证据阈值`,
      en: `${rationale.count} sub-claim${rationale.count === 1 ? " remains" : "s remain"} below the evidence threshold`,
      vi: `Có ${rationale.count} yêu cầu nghiên cứu vẫn dưới ngưỡng bằng chứng`,
      pt: `${rationale.count} ${rationale.count === 1 ? "objetivo de pesquisa permanece" : "objetivos de pesquisa permanecem"} abaixo do limiar de evidência`,
      es: `${rationale.count} ${rationale.count === 1 ? "objetivo de investigación sigue" : "objetivos de investigación siguen"} por debajo del umbral de evidencia`,
      fr: `${rationale.count} objectif${rationale.count === 1 ? " reste" : "s restent"} sous le seuil de preuve`,
    }[language];
    case "incomplete": return {
      "zh-Hans": "最终评估尚未为每个请求部分确立完整且有证据支持的答案",
      en: "the final assessment does not establish a complete supported answer for every requested part",
      vi: "đánh giá cuối chưa xác lập được câu trả lời đầy đủ có bằng chứng hỗ trợ cho mọi phần được yêu cầu",
      pt: "a avaliação final não estabelece uma resposta completa e sustentada para todas as partes solicitadas",
      es: "la evaluación final no establece una respuesta completa y respaldada para todas las partes solicitadas",
      fr: "l'évaluation finale n'établit pas une réponse complète et étayée pour chaque partie demandée",
    }[language];
    case "explained-conflict": return {
      "zh-Hans": "已解释来源取舍，但相互矛盾的证据仍限制置信度",
      en: "source preferences are explained, but conflicting evidence limits confidence",
      vi: "đã giải thích việc ưu tiên nguồn, nhưng bằng chứng mâu thuẫn vẫn giới hạn độ tin cậy",
      pt: "as preferências entre fontes são explicadas, mas evidências conflitantes limitam a confiança",
      es: "se explican las preferencias entre fuentes, pero las evidencias contradictorias limitan la confianza",
      fr: "les préférences entre sources sont expliquées, mais les preuves contradictoires limitent la confiance",
    }[language];
    case "publisher-groups": return {
      "zh-Hans": `合并观察到的共同 DOI 作品后，${rationale.count} 个出版方域名组为每项研究目标提供匹配的证据片段；分组不能证明独立佐证或事实真实性`,
      en: `${rationale.count} publisher domain groups ground every sub-claim with matching evidence spans, after merging observed shared-DOI works; grouping does not prove independent corroboration or factual truth`,
      vi: `${rationale.count} nhóm tên miền nhà xuất bản có trích đoạn bám nguồn cho mọi yêu cầu, sau khi gộp các công trình quan sát có cùng DOI; việc nhóm không chứng minh xác nhận độc lập hay tính đúng đắn`,
      pt: `${rationale.count} grupos de domínios de editores sustentam cada objetivo com trechos correspondentes, após agrupar trabalhos com DOI compartilhado observado; o agrupamento não comprova corroboração independente nem verdade factual`,
      es: `${rationale.count} grupos de dominios de editores respaldan cada objetivo con fragmentos correspondientes, tras agrupar trabajos con DOI compartido observado; la agrupación no demuestra corroboración independiente ni verdad factual`,
      fr: `${rationale.count} groupe${rationale.count === 1 ? "" : "s"} de domaines d'éditeurs ${rationale.count === 1 ? "étaye" : "étayent"} chaque objectif avec des extraits correspondants, après regroupement des travaux ayant un DOI commun observé ; ce regroupement ne prouve ni corroboration indépendante ni vérité factuelle`,
    }[language];
    case "limited-sources": return {
      "zh-Hans": `${rationale.count} 个通过证据检查的来源覆盖每项研究目标，但佐证或支持强度仍有限`,
      en: `${rationale.count} evidence-verified source${rationale.count === 1 ? "" : "s"} cover every sub-claim, but corroboration or support strength is limited`,
      vi: `${rationale.count} nguồn đã qua kiểm tra bằng chứng bao phủ mọi yêu cầu, nhưng mức xác nhận hoặc hỗ trợ vẫn hạn chế`,
      pt: `${rationale.count} ${rationale.count === 1 ? "fonte verificada por evidências cobre" : "fontes verificadas por evidências cobrem"} todos os objetivos, mas a corroboração ou a força do suporte é limitada`,
      es: `${rationale.count} ${rationale.count === 1 ? "fuente verificada por evidencias cubre" : "fuentes verificadas por evidencias cubren"} todos los objetivos, pero la corroboración o la fuerza del respaldo es limitada`,
      fr: `${rationale.count} source${rationale.count === 1 ? " vérifiée couvre" : "s vérifiées couvrent"} chaque objectif avec des preuves, mais la corroboration ou la force du soutien reste limitée`,
    }[language];
  }
}

/** Preserve delivery limitations. Only an assessment of the delivered reviewed
 * sentences may supply a higher level; excerpt-only and unavailable stay Low. */
export function ordinaryConfidence(language: Language, delivery: "unavailable" | "summary" | "excerpts", assessment: string,
  reviewedSummary?: Confidence): Confidence {
  if (isAdditionalAnswerLanguage(language)) {
    const native = nativeAnswerCopy(language)!;
    const summary = delivery === "summary" ? reviewedSummary : undefined;
    return { level: summary?.level ?? "Low", reason: delivery === "unavailable" ? native.delivery.unavailable
      : `${native.delivery[delivery]} ${native.assessment}: ${summary?.reason ?? assessment}` };
  }
  const reason = {
    unavailable: {
      "zh-Hans": "综合或证据检查未能完成；来源支持度和答案是否有用仍未评估。",
      en: "Synthesis or evidence review did not complete; source support and a useful answer remain unassessed.",
      vi: "Bước tổng hợp hoặc kiểm tra bằng chứng chưa hoàn tất; chưa đánh giá được mức hỗ trợ của nguồn hay câu trả lời hữu ích.",
      pt: "A síntese ou a revisão das evidências não foi concluída; o suporte das fontes e a utilidade da resposta ainda não foram avaliados.",
      es: "La síntesis o la revisión de las evidencias no se completó; aún no se han evaluado el respaldo de las fuentes ni la utilidad de la respuesta.",
      fr: "La synthèse ou la vérification des preuves n'a pas abouti ; le soutien des sources et l'utilité de la réponse restent non évalués.",
    },
    summary: {
      "zh-Hans": "每句摘要均与原文摘录绑定并经模型检查；完整性和独立事实正确性仍未核实。",
      en: "Each summary sentence is tied to a verbatim excerpt and model-checked; completeness and independent factual correctness remain unverified.",
      vi: "Mỗi câu tóm tắt gắn với một trích đoạn nguyên văn và đã qua kiểm tra bằng mô hình; chưa xác minh tính đầy đủ hoặc tính đúng đắn độc lập.",
      pt: "Cada frase do resumo está vinculada a um trecho literal e foi revisada por modelo; a completude e a exatidão factual independente permanecem não verificadas.",
      es: "Cada frase del resumen está vinculada a un fragmento literal y fue revisada por un modelo; la exhaustividad y la exactitud factual independiente siguen sin verificarse.",
      fr: "Chaque phrase du résumé est liée à un extrait original et vérifiée par un modèle ; l'exhaustivité et l'exactitude factuelle indépendante restent non vérifiées.",
    },
    excerpts: {
      "zh-Hans": "仅提供来源摘录；完整综合和逐项断言的支持情况仍未核实。",
      en: "Only source excerpts are delivered; complete synthesis and per-assertion support remain unverified.",
      vi: "Chỉ cung cấp trích đoạn nguồn; chưa xác minh được tổng hợp đầy đủ và hỗ trợ cho từng nhận định.",
      pt: "São apresentados apenas trechos das fontes; a síntese completa e o suporte de cada afirmação permanecem não verificados.",
      es: "Solo se presentan fragmentos de las fuentes; la síntesis completa y el respaldo de cada afirmación siguen sin verificarse.",
      fr: "Seuls des extraits des sources sont présentés ; l'exhaustivité de la synthèse et le soutien de chaque affirmation restent non vérifiés.",
    },
  }[delivery][language];
  const prefix = { en: "Evidence assessment", vi: "Đánh giá bằng chứng", pt: "Avaliação das evidências", es: "Evaluación de las evidencias", fr: "Évaluation des preuves", "zh-Hans": "证据评估" }[language];
  const summary = delivery === "summary" ? reviewedSummary : undefined;
  return { level: summary?.level ?? "Low",
    reason: delivery === "unavailable" ? reason : `${reason} ${prefix}: ${summary?.reason ?? assessment}` };
}

export function confidenceBanner(answer: string, verdict: Confidence, language: Language): string {
  if (verdict.level !== "Low") return answer;
  if (isAdditionalAnswerLanguage(language)) {
    const native = nativeAnswerCopy(language)!;
    return `> ⚠ ${native.lowConfidence} — ${verdict.reason.replace(/[.!?。！？।]$/u, "")}${native.sentenceEnd} ${native.provisional}\n\n${answer}`;
  }
  const copy = {
    en: { label: "Low confidence", provisional: "Treat this as provisional." },
    vi: { label: "Độ tin cậy thấp", provisional: "Kết quả chưa hoàn chỉnh." },
    pt: { label: "Baixa confiança", provisional: "Trate este resultado como provisório." },
    es: { label: "Confianza baja", provisional: "Trate este resultado como provisional." },
    fr: { label: "Confiance faible", provisional: "Considérez ce résultat comme provisoire." },
    "zh-Hans": { label: "低置信度", provisional: "请将此结果视为暂定结果。" },
  }[language];
  return language === "zh-Hans"
    ? `> ⚠ ${copy.label} — ${verdict.reason.replace(/[.!?。！？]$/u, "")}。${copy.provisional}\n\n${answer}`
    : `> ⚠ ${copy.label} — ${verdict.reason.replace(/[.!?]$/, "")}. ${copy.provisional}\n\n${answer}`;
}
