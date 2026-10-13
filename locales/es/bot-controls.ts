import type { BotControlsCatalogue } from "../en/bot-controls";
export const botControlsSpanish = Object.freeze({
  introduction: "Haz una pregunta para recibir una respuesta con citas.",
  usage: "Uso:",
  exampleQuestion: "¿qué es x402?",
  reviewBoundary: "Review-first solo está disponible en el navegador en vivo autenticado; aquí se rechazan las opciones del modo de revisión.",
  privateQuestion: "En esta conversación privada también puedes escribir directamente la pregunta.",
  status: "Estado:",
  financialDetails: "Información financiera (en inglés):",
  languageHelp: "Usa /language en|vi|pt|es|auto para elegir el idioma de las respuestas y la ayuda. Una instrucción explícita de idioma en la pregunta original tiene prioridad; auto sigue la pregunta.",
  languageCurrent: "Preferencia de idioma de las respuestas: {preference}.",
  languageSaved: "Preferencia de idioma de las respuestas y la ayuda guardada: {preference}.",
  languageUnavailable: "No se pudo leer o confirmar que se guardara la preferencia de idioma. No se afirma que se haya guardado correctamente.",
  languageInvalid: "Valores admitidos: en, vi, pt (también pt-BR), es, auto.",
  languagePrivate: "Elige o consulta tu idioma en una conversación privada con Keryx.",
  privatePreparing: "Keryx está preparando tu respuesta de investigación privada…",
} satisfies BotControlsCatalogue);
