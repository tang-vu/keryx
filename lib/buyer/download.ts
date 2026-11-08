/** Private local export. The file name and address bar never contain a job ID or question. */
export function downloadBuyerJson(text: string, kind: "recovery" | "receipt") {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = url; anchor.download = `keryx-${kind}.json`;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    try { anchor?.remove(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
