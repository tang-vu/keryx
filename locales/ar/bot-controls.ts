import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const botControlsArabic = Object.freeze({
  ...botControlsEnglish,
  "introduction": "اطرح سؤالًا لتحصل على إجابة مع استشهادات.",
  "usage": "الاستخدام:",
  "exampleQuestion": "ما هو x402؟",
  "privateQuestion": "يمكنك أيضًا كتابة السؤال مباشرة في هذه المحادثة الخاصة.",
  "status": "الحالة:",
  "financialDetails": "التفاصيل المالية (بالإنجليزية):",
  "languageCurrent": "اللغة المفضلة للإجابات: {preference}.",
  "languageHelp": "استخدم /language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|ar|auto لاختيار لغة الإجابات والمساعدة. تكون الأولوية لتعليمات لغة المخرجات الصريحة في سؤالك الأصلي؛ أما auto فيتبع السؤال.",
  "languageInvalid": "القيم المدعومة: en، vi، pt (وأيضًا pt-BR)، es، fr، zh-Hans، de، ja، ko، hi، id، ru، ar، auto.",
  "languageSaved": "حُفظت اللغة المفضلة للإجابات والمساعدة: {preference}.",
  "languageUnavailable": "تعذّرت قراءة تفضيل اللغة أو تأكيد حفظه. لا يُدَّعى نجاح الحفظ.",
  "languagePrivate": "اضبط تفضيل اللغة أو اعرضه في محادثة خاصة مع Keryx.",
  "privatePreparing": "يُعِدّ Keryx إجابة بحثك الخاصة…",
}) satisfies BotControlsCatalogue;
