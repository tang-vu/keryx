import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";

export const botControlsFrench = Object.freeze({
  ...botControlsEnglish,
  introduction: "Posez une question pour recevoir une réponse avec des citations.",
  usage: "Utilisation :",
  exampleQuestion: "qu'est-ce que x402 ?",
  privateQuestion: "Dans cette conversation privée, vous pouvez aussi saisir directement la question.",
  status: "État :",
  financialDetails: "Détails financiers (en anglais) :",
  languageHelp: "Utilisez /language en|vi|pt|es|fr|zh-Hans|auto pour choisir la langue des réponses et de l'aide. Une instruction explicite de langue dans votre question originale est prioritaire ; auto suit la question.",
  languageCurrent: "Préférence de langue des réponses : {preference}.",
  languageSaved: "Préférence de langue des réponses et de l'aide enregistrée : {preference}.",
  languageUnavailable: "La préférence de langue n'a pas pu être lue ou son enregistrement confirmé. Aucun enregistrement réussi n'est annoncé.",
  languageInvalid: "Valeurs prises en charge : en, vi, pt (ou pt-BR), es, fr, zh-Hans, auto.",
  languagePrivate: "Choisissez ou consultez votre préférence de langue dans une conversation privée avec Keryx.",
  privatePreparing: "Keryx prépare votre réponse de recherche privée…",
} satisfies BotControlsCatalogue);
