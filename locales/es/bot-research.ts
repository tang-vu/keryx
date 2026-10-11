import type { BotResearchCatalogue } from "../en/bot-research";

/** Agent-authored ordinary bot copy; no human translation approval is claimed. */
export const botResearchSpanish = Object.freeze({
  citationHeading: "Citas y recompensas previstas (USDC)",
  slackCitationHeading: "Citas y recompensas previstas — recompensas por citas ponderadas en USDC",
  weight: "peso {weight}",
  sourcesOne: "{count} fuente citada",
  sourcesOther: "{count} fuentes citadas",
  recordedCreators: "{amount} registrado para creadores",
  recordedCreatorTotal: "Total registrado de pagos a creadores: {amount}",
  settlementNotice: "Los importes registrados no prueban la liquidación; consulta los recibos en el registro completo de ejecución.",
  slackSettlementNotice: "Las recompensas previstas no son prueba de liquidación. Consulta en el registro de ejecución los pagos liquidados, pendientes, fallidos o simulados.",
  discordSettlementNotice: "Los importes registrados no prueban la liquidación; consulta los recibos mediante el enlace del título",
  fullTrace: "Registro completo de ejecución: {url}",
  failure: "⚠️ Keryx no pudo terminar esta investigación: {detail}",
  paused: "Las nuevas investigaciones están temporalmente en pausa mientras se revisa una entrega anterior. Puedes consultar los informes guardados. Aumentar el presupuesto de fuentes o conectar una cartera no elimina esta pausa. Tu pregunta no se ha vuelto a intentar.",
  treasuryUnavailable: "La cartera de tesorería de Keryx no está configurada en esta implementación.",
  sponsoredLimited: "Las investigaciones patrocinadas están temporalmente limitadas o no disponibles — inténtalo de nuevo en un minuto.",
  dispatching: "⏳ Keryx está investigando — comprando fuentes y liquidando citas…",
  discordUsage: "Aquí solo se admite `/ask question:<text>`.",
} satisfies BotResearchCatalogue);
