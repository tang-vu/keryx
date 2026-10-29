import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";
/** Neutral machine draft; browser review boundary remains English. */
export const botControlsHindi = Object.freeze({
  ...botControlsEnglish,
  introduction: "उद्धरणों सहित उत्तर पाने के लिए प्रश्न पूछें।",
  usage: "उपयोग:",
  exampleQuestion: "x402 क्या है?",
  privateQuestion: "इस निजी चैट में आप सीधे प्रश्न भी लिख सकते हैं।",
  status: "स्थिति:",
  financialDetails: "वित्तीय विवरण (अंग्रेज़ी में):",
  languageCurrent: "उत्तर की पसंदीदा भाषा: {preference}।",
  languageHelp: "उत्तर और सहायता की भाषा चुनने के लिए /language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|auto इस्तेमाल करें। मूल प्रश्न में दिया स्पष्ट भाषा निर्देश प्राथमिक है; auto प्रश्न का अनुसरण करता है।",
  languageInvalid: "समर्थित मान: en, vi, pt (pt-BR भी), es, fr, zh-Hans, de, ja, ko, hi, id, ru, auto।",
  languageSaved: "उत्तर और सहायता की पसंदीदा भाषा सुरक्षित की गई: {preference}।",
  languageUnavailable: "भाषा की पसंद पढ़ी नहीं जा सकी या उसके सुरक्षित होने की पुष्टि नहीं हुई। सफलतापूर्वक सुरक्षित होने का दावा नहीं है।",
  languagePrivate: "Keryx के साथ निजी चैट में अपनी भाषा की पसंद तय करें या देखें।",
  privatePreparing: "Keryx आपके निजी शोध का उत्तर तैयार कर रहा है…",
} satisfies BotControlsCatalogue);
