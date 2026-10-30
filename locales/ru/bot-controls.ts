import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const botControlsRussian = Object.freeze({
  ...botControlsEnglish,
  "introduction": "Задайте вопрос, чтобы получить ответ со ссылками на источники.",
  "usage": "Использование:",
  "exampleQuestion": "Что такое x402?",
  "privateQuestion": "В этом личном чате можно ввести вопрос напрямую.",
  "status": "Состояние:",
  "financialDetails": "Финансовые сведения (на английском):",
  "languageCurrent": "Предпочитаемый язык ответов: {preference}.",
  "languageHelp": "Используйте /language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|ar|auto для выбора языка ответов и справки. Явное указание языка в исходном вопросе имеет приоритет; auto следует исходному вопросу.",
  "languageInvalid": "Поддерживаемые значения: en, vi, pt (также pt-BR), es, fr, zh-Hans, de, ja, ko, hi, id, ru, ar, auto.",
  "languageSaved": "Предпочитаемый язык ответов и справки сохранён: {preference}.",
  "languageUnavailable": "Не удалось прочитать языковую настройку или подтвердить её сохранение. Успешное сохранение не заявляется.",
  "languagePrivate": "Устанавливайте и просматривайте языковую настройку в личном чате с Keryx.",
  "privatePreparing": "Keryx готовит ваш личный исследовательский ответ…",
}) satisfies BotControlsCatalogue;
