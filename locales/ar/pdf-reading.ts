import type { pdfReadingCopy } from "../en/pdf-reading";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const pdfReadingArabic = Object.freeze({
  "summary": "شمل استخراج نص PDF عدد {read} من أصل {total} صفحة.",
  "emptyPages": "لم يُستخرج نص من الصفحات التي زِيرت: {pages}. قد تكون هذه الصفحات ممسوحة ضوئيًا أو فارغة أو غير متاحة لقارئ النص لسبب آخر.",
  "limit": "توقف استخراج النص بسبب حدّ الصفحات أو الأحرف قبل اكتمال المستند. اقرأ الصفحات الأصلية المتبقية مباشرة قبل استخلاص نتائج تتعلق بالمستند كله؛ فقد يترك حدّ الأحرف آخر صفحة تمت زيارتها غير مكتملة. احتفظ بهذه اللقطة للمقارنة.",
  "textOnly": "قُرئت طبقة النص المتاحة في PDF فقط؛ ولم تُفسَّر الصور أو الأشكال.",
  "recovery": "راجع النسخة الأصلية نفسها. عند الحاجة، احصل على PDF ذي طبقة نصية أو نص الناشر أو نسخة عولجت بصورة منفصلة باستخدام OCR؛ لم يُجرِ هذا التشغيل معالجة OCR.",
}) satisfies typeof pdfReadingCopy;
