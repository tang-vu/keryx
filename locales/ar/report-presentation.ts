import type { ReportPresentationCatalogue } from "../en/report-presentation";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const reportPresentationArabic = Object.freeze({
  "target": "{marker} · محور البحث (غير متحقَّق منه): {claim}",
  "coverage": "محور البحث (غير متحقَّق منه): {claim}: تقييم التغطية المسجَّل {coverage}؛ {sources}",
  "noSources": "لا توجد مصادر مقبولة",
  "documentVersion": "إصدار المستند: {version}",
  "provenance": "المنشأ المرصود: {provenance}",
  "scope": "نطاق المواد الأصلية المقدَّمة: {scope}",
  "scholarly": "البيانات الأكاديمية المرصودة ونطاق القراءة (حالة مراجعة الأقران غير معروفة): {metadata}",
}) satisfies ReportPresentationCatalogue;
