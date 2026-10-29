import type { PresentationLanguage } from "../research/presentation-language";

/** Bounded recipient-selected email wrappers, not payment-state or glossary authority.
 * Non-English copy is unreviewed; #273 critical financial/legal copy keeps its existing
 * English authority and human-review gate. No UI locale or trust gate is enabled here. */
export const citationEmailUnreviewedDraftMessages = {
  "zh-Hans": {
    subject: 'Keryx cited "{sourceName}" — {amount} USDC settled to you',
    textBody: 'Your source "{sourceName}" was just cited by the Keryx agent and paid {amount} USDC ({weightPct} contribution weight), settled on {network}.',
    textRate: "You get at most one of these per source per hour — every payout, including the ones between emails, is on your earnings page.",
    htmlTitle: "Keryx · citation settled",
    htmlHeading: "{sourceName} was cited — {amount} USDC is yours",
    htmlBody: "The Keryx agent relied on your work ({weightPct} contribution weight) and settled {amount} USDC to your wallet on {network}.",
    htmlRate: "At most one alert per source per hour — every payout is on your earnings page.",
    article: "文章", trace: "完整研究跟踪记录", earnings: "你的收入页面", stop: "停止这些通知", traceLink: "查看完整研究跟踪记录", earningsLink: "你的收入页面", unsubscribe: "取消订阅",
  },
  fr: {
    subject: 'Keryx cited "{sourceName}" — {amount} USDC settled to you',
    textBody: 'Your source "{sourceName}" was just cited by the Keryx agent and paid {amount} USDC ({weightPct} contribution weight), settled on {network}.',
    textRate: "You get at most one of these per source per hour — every payout, including the ones between emails, is on your earnings page.",
    htmlTitle: "Keryx · citation settled",
    htmlHeading: "{sourceName} was cited — {amount} USDC is yours",
    htmlBody: "The Keryx agent relied on your work ({weightPct} contribution weight) and settled {amount} USDC to your wallet on {network}.",
    htmlRate: "At most one alert per source per hour — every payout is on your earnings page.",
    article: "Article", trace: "Trace complète de la recherche", earnings: "Votre page de revenus", stop: "Arrêter ces alertes", traceLink: "Voir la trace complète de la recherche", earningsLink: "votre page de revenus", unsubscribe: "Se désabonner",
  },
  en: {
    subject: 'Keryx cited "{sourceName}" — {amount} USDC settled to you',
    textBody: 'Your source "{sourceName}" was just cited by the Keryx agent and paid {amount} USDC ({weightPct} contribution weight), settled on {network}.',
    textRate: "You get at most one of these per source per hour — every payout, including the ones between emails, is on your earnings page.",
    htmlTitle: "Keryx · citation settled",
    htmlHeading: "{sourceName} was cited — {amount} USDC is yours",
    htmlBody: "The Keryx agent relied on your work ({weightPct} contribution weight) and settled {amount} USDC to your wallet on {network}.",
    htmlRate: "At most one alert per source per hour — every payout is on your earnings page.",
    article: "Article", trace: "Full dispatch trace", earnings: "Your earnings page", stop: "Stop these alerts", traceLink: "See the full dispatch trace", earningsLink: "your earnings page", unsubscribe: "Unsubscribe",
  },
  vi: {
    subject: 'Keryx đã trích dẫn "{sourceName}" — {amount} USDC đã được quyết toán cho bạn',
    textBody: 'Nguồn "{sourceName}" của bạn vừa được tác nhân Keryx trích dẫn và nhận {amount} USDC (trọng số đóng góp {weightPct}), đã quyết toán trên {network}.',
    textRate: "Bạn nhận tối đa một thông báo cho mỗi nguồn mỗi giờ — mọi khoản chi trả, kể cả giữa các email, đều có trên trang thu nhập của bạn.",
    htmlTitle: "Keryx · thưởng trích dẫn đã quyết toán",
    htmlHeading: "{sourceName} đã được trích dẫn — bạn đã nhận {amount} USDC",
    htmlBody: "Tác nhân Keryx đã sử dụng công trình của bạn (trọng số đóng góp {weightPct}) và quyết toán {amount} USDC vào ví của bạn trên {network}.",
    htmlRate: "Tối đa một thông báo cho mỗi nguồn mỗi giờ — mọi khoản chi trả đều có trên trang thu nhập của bạn.",
    article: "Bài viết", trace: "Toàn bộ diễn biến nghiên cứu", earnings: "Trang thu nhập của bạn", stop: "Dừng các thông báo này", traceLink: "Xem toàn bộ diễn biến nghiên cứu", earningsLink: "trang thu nhập của bạn", unsubscribe: "Hủy đăng ký",
  },
  pt: {
    subject: 'Keryx citou "{sourceName}" — {amount} USDC liquidados para você',
    textBody: 'Sua fonte "{sourceName}" acaba de ser citada pelo agente Keryx e recebeu {amount} USDC (peso de contribuição de {weightPct}), liquidados na rede {network}.',
    textRate: "Você recebe no máximo um aviso por fonte a cada hora — todos os pagamentos, inclusive os feitos entre os emails, estão na sua página de rendimentos.",
    htmlTitle: "Keryx · recompensa de citação liquidada",
    htmlHeading: "{sourceName} foi citada — {amount} USDC são seus",
    htmlBody: "O agente Keryx utilizou seu trabalho (peso de contribuição de {weightPct}) e liquidou {amount} USDC para sua carteira na rede {network}.",
    htmlRate: "No máximo um aviso por fonte a cada hora — todos os pagamentos estão na sua página de rendimentos.",
    article: "Artigo", trace: "Registro completo da pesquisa", earnings: "Sua página de rendimentos", stop: "Parar estes avisos", traceLink: "Ver o registro completo da pesquisa", earningsLink: "sua página de rendimentos", unsubscribe: "Cancelar inscrição",
  },
  es: {
    subject: 'Keryx citó "{sourceName}" — {amount} USDC liquidados para ti',
    textBody: 'Tu fuente "{sourceName}" acaba de ser citada por el agente Keryx y recibió {amount} USDC (peso de contribución del {weightPct}), liquidados en la red {network}.',
    textRate: "Recibes como máximo un aviso por fuente cada hora — todos los pagos, incluidos los realizados entre los correos, están en tu página de ingresos.",
    htmlTitle: "Keryx · recompensa por cita liquidada",
    htmlHeading: "{sourceName} fue citada — {amount} USDC son tuyos",
    htmlBody: "El agente Keryx utilizó tu trabajo (peso de contribución del {weightPct}) y liquidó {amount} USDC a tu cartera en la red {network}.",
    htmlRate: "Como máximo un aviso por fuente cada hora — todos los pagos están en tu página de ingresos.",
    article: "Artículo", trace: "Registro completo de la investigación", earnings: "Tu página de ingresos", stop: "Detener estos avisos", traceLink: "Ver el registro completo de la investigación", earningsLink: "tu página de ingresos", unsubscribe: "Cancelar suscripción",
  },
} as const satisfies Record<PresentationLanguage, Record<string, string>>;

// Unreviewed translated settlement/ownership prose is never selected at runtime.
// Existing #273 requires genuine content-bound human review before activation.
const criticalEnglish = {
  subject: citationEmailUnreviewedDraftMessages.en.subject,
  textBody: citationEmailUnreviewedDraftMessages.en.textBody,
  htmlTitle: citationEmailUnreviewedDraftMessages.en.htmlTitle,
  htmlHeading: citationEmailUnreviewedDraftMessages.en.htmlHeading,
  htmlBody: citationEmailUnreviewedDraftMessages.en.htmlBody,
} as const;
export const citationEmailMessages = {
  "zh-Hans": { ...citationEmailUnreviewedDraftMessages["zh-Hans"], ...criticalEnglish },
  en: citationEmailUnreviewedDraftMessages.en,
  vi: { ...citationEmailUnreviewedDraftMessages.vi, ...criticalEnglish },
  pt: { ...citationEmailUnreviewedDraftMessages.pt, ...criticalEnglish },
  es: { ...citationEmailUnreviewedDraftMessages.es, ...criticalEnglish },
  fr: { ...citationEmailUnreviewedDraftMessages.fr, ...criticalEnglish },
} as const;
