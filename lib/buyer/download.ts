/** Private local export. The file name and address bar never contain a job ID or question. */
export function downloadBuyerJson(text: string, kind: "recovery" | "receipt") {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `keryx-${kind}.json`;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
