/** Manual private export. Keep its link detached and allow browser handoff before cleanup.
 * Synchronous failures propagate so mandatory recovery exports can stop submission. */
export function downloadPrivateBrowserText(content: string, filename: string, type: string) {
  const revoke = URL.revokeObjectURL.bind(URL);
  const url = URL.createObjectURL(new Blob([content], { type }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    anchor.click();
  } finally { setTimeout(() => revoke(url), 1000); }
}
