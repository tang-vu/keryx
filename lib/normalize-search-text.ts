/** Fold Latin accents for metadata search, preserving marks in other writing systems. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/đ/g, "d")
    .normalize("NFC");
}
