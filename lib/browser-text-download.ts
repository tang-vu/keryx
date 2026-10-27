/** Deliberate browser export. No fetch, upload or file path containing personal text. */
export function downloadBrowserText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    try { anchor?.remove(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
