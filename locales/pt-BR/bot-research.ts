import type { BotResearchCatalogue } from "../en/bot-research";

/** The existing ordinary `pt` presentation maps to Brazilian Portuguese. */
export const botResearchPortuguese = Object.freeze({
  citationHeading: "Citações e recompensas planejadas (USDC)",
  slackCitationHeading: "Citações e recompensas planejadas — recompensas de citação ponderadas em USDC",
  weight: "peso {weight}",
  sourcesOne: "{count} fonte citada",
  sourcesOther: "{count} fontes citadas",
  recordedCreators: "{amount} registrado para criadores",
  recordedCreatorTotal: "Total registrado de pagamentos a criadores: {amount}",
  settlementNotice: "Os valores registrados não comprovam a liquidação; confira os recibos no registro completo da execução.",
  slackSettlementNotice: "Recompensas planejadas não são prova de liquidação. Veja no registro da execução os pagamentos liquidados, pendentes, com falha ou simulados.",
  discordSettlementNotice: "Os valores registrados não comprovam a liquidação; confira os recibos pelo link no título",
  fullTrace: "Registro completo da execução: {url}",
  failure: "⚠️ O Keryx não conseguiu concluir esta pesquisa: {detail}",
  paused: "Novas pesquisas estão temporariamente pausadas enquanto uma entrega anterior é revisada. Você ainda pode consultar relatórios salvos. Aumentar o orçamento de fontes ou conectar uma carteira não remove esta pausa. Sua pergunta não foi tentada novamente.",
  treasuryUnavailable: "A carteira da tesouraria do Keryx não está configurada nesta implantação.",
  sponsoredLimited: "As pesquisas patrocinadas estão temporariamente limitadas ou indisponíveis — tente novamente em um minuto.",
  dispatching: "⏳ O Keryx está pesquisando — comprando fontes e liquidando citações…",
  discordUsage: "Aqui, apenas `/ask question:<text>` está disponível.",
} satisfies BotResearchCatalogue);
