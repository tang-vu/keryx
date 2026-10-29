import type { NativeAnswerCopy } from "../../lib/research/native-answer-copy";

/** Machine draft; no human review or language observation is implied. */
export const ordinaryAnswerIndonesian = Object.freeze({
  summaryIntro: "Ringkasan ditulis oleh model dengan kutipan pada setiap kalimat. Setiap kalimat ditampilkan bersama petikan asli yang digunakan untuk memeriksanya.",
  excerptIntro: "Hanya petikan sumber yang ditampilkan. Draf tidak disajikan sebagai kesimpulan dan kelengkapan sintesis belum diverifikasi. Sasaran riset adalah topik yang perlu diteliti, bukan kesimpulan yang telah terbukti.",
  unavailableIntro: "Belum ada jawaban yang didukung bukti: sintesis atau pemeriksaan bukti belum selesai. Hasil pembacaan dan tanda terima asli tetap disimpan.",
  emptyIntro: "Belum ada jawaban yang didukung bukti: konten yang dibaca tidak menyediakan petikan yang memenuhi syarat untuk sasaran riset.",
  target: "Sasaran riset",
  topic: "Topik yang diminta (belum diverifikasi)",
  source: "Teks asli sumber",
  unavailableGap: "Bukti untuk sasaran riset ini tidak dapat dinilai dalam proses ini.",
  gap: "Kekurangan bukti: tidak ada petikan yang memenuhi syarat untuk sasaran riset ini.",
  partialGap: "Kekurangan bukti: penilaian yang tercatat masih berada di bawah ambang dukungan untuk sasaran riset ini.",
  reviewNotice: "Kalimat ditulis dan diperiksa oleh model, tanpa verifikasi independen.",
  limitations: "Petikan menunjukkan hubungan dengan sumber, tetapi tidak membuktikan kebenaran sumber atau kelengkapan sintesis. Sumber dapat keliru atau saling bertentangan. Status pembayaran dicatat secara terpisah.",
  compactNotice: "Jawaban tidak dapat disajikan dalam {count} butir singkat sambil mempertahankan semua sasaran riset dan petikan yang diterima; sasaran ditampilkan satu per satu di bawah.",
  compactNote: "Ringkasan ditulis dan diperiksa oleh model; bandingkan dengan petikan sumber yang dipasangkan. Kelengkapan sintesis dan kebenaran sumber belum diverifikasi. Status pembayaran dicatat secara terpisah.",
  confidence: Object.freeze({
    synthetic: "Proses ini memuat materi demonstrasi sintetis yang tidak dapat mendasari keyakinan faktual",
    "no-citation": "Tidak ada kutipan yang lolos pemeriksaan penerimaan bukti",
    "unresolved-conflict": "Masih ada {count} perbedaan antar sumber yang belum terselesaikan; skor cakupan tidak menyelesaikan bukti yang bertentangan",
    "no-coverage": "Penilaian cakupan bukti untuk sasaran riset belum tersedia",
    gaps: "Masih ada {count} sasaran riset di bawah ambang bukti",
    incomplete: "Penilaian akhir belum menetapkan jawaban lengkap yang didukung bukti untuk setiap bagian yang diminta",
    "explained-conflict": "Alasan memprioritaskan sumber telah dijelaskan, tetapi bukti yang bertentangan membatasi tingkat keyakinan",
    "publisher-groups": "Setelah karya yang teramati memiliki DOI sama digabungkan, {count} kelompok domain penerbit menyediakan bagian bukti yang sesuai untuk setiap sasaran riset; pengelompokan tidak membuktikan konfirmasi independen atau kebenaran faktual",
    "limited-sources": "Sebanyak {count} sumber yang telah melewati pemeriksaan bukti mencakup setiap sasaran riset, tetapi konfirmasi atau kekuatan dukungannya terbatas",
  }),
  delivery: Object.freeze({
    unavailable: "Sintesis atau pemeriksaan bukti belum selesai; dukungan sumber dan kegunaan jawaban belum dinilai.",
    summary: "Setiap kalimat ringkasan terikat pada petikan asli dan telah diperiksa oleh model; kelengkapan dan kebenaran faktual secara independen belum diverifikasi.",
    excerpts: "Hanya petikan sumber yang disajikan; kelengkapan sintesis dan dukungan untuk setiap pernyataan belum diverifikasi.",
  }),
  assessment: "Penilaian bukti",
  lowConfidence: "Tingkat keyakinan rendah",
  provisional: "Perlakukan hasil ini sebagai hasil sementara.",
  sentenceEnd: ".",
}) satisfies NativeAnswerCopy;
