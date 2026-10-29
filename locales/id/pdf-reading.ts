import type { pdfReadingCopy } from "../en/pdf-reading";

/** Exact source-bound machine draft; no human approval, OCR or full-document claim. */
export const pdfReadingIndonesian = Object.freeze({
  summary: "Ekstraksi teks PDF mengakses {read} dari {total} halaman.",
  emptyPages: "Tidak ada teks yang diekstrak dari halaman yang diakses: {pages}. Halaman ini mungkin berupa hasil pindai, kosong, atau tidak dapat dibaca oleh pembaca teks karena alasan lain.",
  limit: "Batas halaman atau karakter menghentikan ekstraksi teks sebelum seluruh dokumen selesai. Baca langsung halaman asli yang tersisa sebelum menarik kesimpulan tentang seluruh dokumen; pemotongan berdasarkan karakter dapat membuat halaman terakhir yang diakses tidak lengkap. Simpan rekaman ini untuk perbandingan.",
  textOnly: "Hanya lapisan teks PDF yang tersedia yang dibaca; gambar dan diagram tidak ditafsirkan.",
  recovery: "Periksa versi asli yang sama. Jika perlu, dapatkan PDF dengan lapisan teks, teks dari penerbit, atau salinan yang diproses OCR secara terpisah; proses ini tidak melakukan OCR.",
} satisfies typeof pdfReadingCopy);
