import type { TeachingProposalDelivery } from "./teaching-proposals";

/** Use the same literal escaping as the existing EN/VI proposal renderer. */
export function portugueseTeachingProposalAnswer(delivery: TeachingProposalDelivery, literal: (text: string) => string): string {
  const lines = ["### Propostas de ensino", ""];
  if (delivery.proposals.length) lines.push("As atividades e situações inventadas abaixo são propostas do Keryx, baseadas na explicação com fontes citadas acima.", "");
  for (const { label, proposal } of delivery.proposals) {
    lines.push(`**${literal(label)}${proposal.kind === "activity" ? ` (${proposal.durationMinutes} minutos)` : ""}**`, literal(proposal.text));
    for (const condition of proposal.conditions) lines.push(`Condição: ${literal(condition)}`);
    if ("answer" in proposal) lines.push(`Resposta: ${literal(proposal.answer)}`);
    lines.push("");
  }
  if (delivery.gaps.length) {
    if (!delivery.proposals.length) lines.push("Nenhuma proposta passou pelas verificações obrigatórias das premissas e da revisão.");
    if (delivery.gaps.some(gap => gap.reason === "final-premise-withheld")) {
      lines.push("Falta uma premissa factual: a evidência final não sustenta suficientemente pelo menos uma premissa da proposta; as partes dependentes foram retidas.");
      lines.push("Próximo passo: confira os tópicos factuais ainda sem apoio acima na fonte original solicitada, localize um trecho que responda diretamente a cada tópico e verifique-o antes de usar a proposta; situações inventadas não substituem evidência.");
    } else if (delivery.gaps.some(gap => gap.reason === "missing-premise")) {
      lines.push("Falta uma referência de premissa: pelo menos uma referência da proposta não corresponde a uma afirmação citada; isso não demonstra que a fonte original careça desse fato.");
      lines.push("Próximo passo: confira as referências de premissas da proposta com as afirmações citadas acima. Se um tópico factual não tiver evidência, localize e verifique um trecho que responda diretamente a ele na fonte original solicitada; situações inventadas não substituem evidência.");
    }
    const names = { activity: "atividade", "classification-example": "exemplos de classificação", "exit-question": "pergunta final" };
    for (const kind of ["activity", "classification-example", "exit-question"] as const) {
      if (delivery.gaps.some(gap => gap.reason === "requested-count" && gap.kind === kind))
        lines.push(`A solicitação de ${names[kind]} não pôde ser atendida por completo; propostas sem apoio suficiente foram retidas.`);
    }
    if (delivery.gaps.some(gap => gap.reason === "explanation-word-limit"))
      lines.push("A explicação com fontes citadas excede o limite de palavras solicitado; essa condição ainda não foi atendida.");
  }
  return lines.join("\n").trim();
}
