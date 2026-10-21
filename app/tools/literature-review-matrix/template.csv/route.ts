import { literatureMatrixCsv } from "@/lib/research-tools/literature-matrix";

export const dynamic = "force-static";

/** Public blank worksheet only. Never accepts or retrieves user notes. */
export function GET() {
  return new Response(literatureMatrixCsv("", []), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="literature-review-matrix-template.csv"',
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  } });
}
