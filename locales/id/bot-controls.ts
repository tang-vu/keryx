import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";
/** Neutral machine draft; browser review boundary remains English. */
export const botControlsIndonesian = Object.freeze({
  ...botControlsEnglish,
  introduction: "Ajukan pertanyaan untuk mendapatkan jawaban dengan kutipan.",
  usage: "Penggunaan:",
  exampleQuestion: "apa itu x402?",
  privateQuestion: "Dalam percakapan pribadi ini, Anda juga dapat langsung mengetik pertanyaan.",
  status: "Status:",
  financialDetails: "Rincian keuangan (bahasa Inggris):",
  languageCurrent: "Preferensi bahasa jawaban: {preference}.",
  languageSaved: "Preferensi bahasa jawaban dan bantuan tersimpan: {preference}.",
  languageUnavailable: "Preferensi bahasa tidak dapat dibaca atau dipastikan tersimpan. Tidak ada klaim penyimpanan berhasil.",
  languagePrivate: "Atur atau periksa preferensi bahasa Anda dalam percakapan pribadi dengan Keryx.",
  privatePreparing: "Keryx sedang menyiapkan jawaban riset pribadi Anda…",
} satisfies BotControlsCatalogue);
