import type { PresentationLanguage } from "../research/presentation-language";

/** Ordinary navigation labels only. Settlement/financial authority stays canonical
 * until the existing #273 human terminology review accepts translated copy. */
export const citationEmailMessages = {
  en: { article: "Article", trace: "Full dispatch trace", earnings: "Your earnings page", stop: "Stop these alerts", traceLink: "See the full dispatch trace", earningsLink: "your earnings page", unsubscribe: "Unsubscribe" },
  vi: { article: "Bài viết", trace: "Toàn bộ diễn biến nghiên cứu", earnings: "Trang thu nhập của bạn", stop: "Dừng các thông báo này", traceLink: "Xem toàn bộ diễn biến nghiên cứu", earningsLink: "trang thu nhập của bạn", unsubscribe: "Hủy đăng ký" },
  pt: { article: "Artigo", trace: "Registro completo da pesquisa", earnings: "Sua página de rendimentos", stop: "Parar estes avisos", traceLink: "Ver o registro completo da pesquisa", earningsLink: "sua página de rendimentos", unsubscribe: "Cancelar inscrição" },
  es: { article: "Artículo", trace: "Registro completo de la investigación", earnings: "Tu página de ingresos", stop: "Detener estos avisos", traceLink: "Ver el registro completo de la investigación", earningsLink: "tu página de ingresos", unsubscribe: "Cancelar suscripción" },
} as const satisfies Record<PresentationLanguage, Record<string, string>>;
