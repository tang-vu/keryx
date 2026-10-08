/** Conservative native publication dates. Parser-normalized edited dates are not accepted. */
export function sourceRecencyPublicationDate(field: "atom:published" | "rss:pubDate", raw: string): string | null {
  const calendar = (year: number, month: number, day: number) => year >= 1970 && year <= 9999 &&
    month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (field === "atom:published") {
    const p = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u);
    if (!p || !calendar(Number(p[1]), Number(p[2]), Number(p[3]))) return null;
  } else {
    const p = raw.match(/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)? (?:GMT|UTC|[+-](?:[01]\d|2[0-3])[0-5]\d)$/u);
    if (!p) return null;
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(p[3]) + 1;
    const year = Number(p[4]), day = Number(p[2]);
    if (!calendar(year, month, day)) return null;
    if (p[1] && p[1] !== ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]) return null;
  }
  const time = new Date(raw);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}
