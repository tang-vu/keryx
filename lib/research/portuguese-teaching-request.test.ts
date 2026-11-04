import { expect, it } from "vitest";
import { parseTeachingProposalRequest, teachingQuestionSha256, validTeachingProposalRequest } from "./teaching-proposals-request";

const question = "Sou professora de ciências no Brasil e preciso de uma atividade de dez minutos. Leia https://climatekids.nasa.gov/weather-climate, incluindo o texto da transcrição. Responda em português: explique tempo e clima em menos de 100 palavras; proponha dois exemplos para os alunos classificarem; termine com uma pergunta e sua resposta. Cite a NASA para os conhecimentos e marque os exemplos e a atividade como propostas suas, sem dizer que a NASA realizou essa aula. Não deduza uma tendência climática do tempo de um único dia.";

it("admits the observed finite original Portuguese lesson without treating proposals as source facts", () => {
  const request = parseTeachingProposalRequest(question)!;
  expect(request).toEqual({ version: 1, questionSha256: teachingQuestionSha256(question), language: "pt",
    activityCount: 1, durationMinutes: 10, exampleCount: 2, exitQuestionCount: 1, explanationMaximumWords: 99 });
  expect(validTeachingProposalRequest(request, question)).toBe(true);
  expect(validTeachingProposalRequest(request, question + " Changed.")).toBe(false);
  expect(validTeachingProposalRequest({ ...request, exampleCount: 3 }, question)).toBe(false);
});

it.each([
  question.replace("dez minutos", "10 minutos"),
  question.replace("Responda", "Escreva"),
  question.replace("menos de 100", "no máximo 99"),
  question.replace("menos de 100", "até 99"),
  question.replace("dois exemplos", "2 exemplos"),
  question.replace("marque os exemplos e a atividade", "identifique a atividade e os exemplos"),
  question.replace("termine com uma pergunta e sua resposta", "uma pergunta final com resposta"),
  question.normalize("NFD"),
])("keeps the same finite Portuguese fields for an explicit supported paraphrase: %s", original => {
  expect(parseTeachingProposalRequest(original)).toMatchObject({ language: "pt", durationMinutes: 10, exampleCount: 2, explanationMaximumWords: 99 });
});

it.each([
  question.replace("Responda em português", "Não responda em português"),
  question.replace("proponha dois", "não\nproponha dois"),
  question.replace("marque os", "não marque os"),
  question.replace("termine com", "nunca termine com"),
  question.replace("preciso de uma", "não quero uma"),
  question.replace("dois exemplos", "12 exemplos"),
  question.replace("dois exemplos", "cinco exemplos"),
  question.replace("dois exemplos", "-2 exemplos"),
  question.replace("dois exemplos", "+2 exemplos"),
  question.replace("dois exemplos", "2,2 exemplos"),
  question.replace("dois exemplos", "1/2 exemplos"),
  question.replace("dois exemplos", "dois exemplos e três exemplos"),
  question.replace("dois exemplos", "dois exemplos e onze exemplos"),
  question.replace("dez minutos", "31 minutos"),
  question.replace("dez minutos", "-10 minutos"),
  question.replace("dez minutos", "10,5 minutos"),
  question.replace("uma atividade", "duas atividades"),
  question.replace("menos de 100", "menos de 1"),
  question.replace("menos de 100", "no máximo 201"),
  question.replace("uma pergunta e sua resposta", "duas perguntas e suas respostas"),
  question.replace("classificarem", "observarem"),
  question.replace("propostas suas", "resultados observados"),
  question.replace("sem dizer que a NASA realizou essa aula", "a NASA realizou essa aula"),
  question.replace("sem dizer que a NASA realizou essa aula", "a aula foi testada pela NASA"),
  question + " Responda em espanhol.",
  question + " Answer in English.",
  question + " Viết bằng tiếng Việt.",
  question + " Uma atividade de cem minutos.",
  question + " Duas atividades de dez minutos.",
  question + " Termine com uma pergunta e sua resposta.",
  `A fonte diz: ${question}`,
  `Analise a instrução: ${question}`,
  `Fonte: ${question}`,
  `Explique a frase: “${question}”`,
  `Texto a analisar:\n> ${question}`,
  `Texto a analisar:\n\`\`\`\n${question}\n\`\`\``,
  question.replace("Responda em português", '"Responda em português"'),
])("keeps negated, contradictory, untrusted, historical or unsupported requests inactive: %s", original => {
  expect(parseTeachingProposalRequest(original)).toBeUndefined();
});

it("does not intercept an existing English or Vietnamese request through quoted Portuguese text", () => {
  const english = "Propose a 10-minute classroom activity, two classification examples and one exit question with an answer. Write in English: explanation under 100 words. Label activities and invented examples as proposed.";
  expect(parseTeachingProposalRequest(english + ' "Responda em português"')).toMatchObject({ language: "en", exampleCount: 2 });
  expect(parseTeachingProposalRequest(question.replace("português", "portuguesês"))).toBeUndefined();
});
