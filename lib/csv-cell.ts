/** Quote every cell; neutralize spreadsheet formulas even after invisible prefixes. */
export function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
