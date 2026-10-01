// This asset must be traced alongside pdfjs-dist's legacy build in Next deployments.
// No rendering, JavaScript actions, attachments, URLs, fonts or OCR are evaluated.
const MAX_BYTES = 2 * 1024 * 1024;
const maxPages = Number(process.argv[2]);
const maxChars = Number(process.argv[3]);
console.log = console.warn = console.error = () => {};
globalThis.fetch = async () => { throw new Error("External resources disabled"); };

try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error();
    chunks.push(chunk);
  }
  if (!size) throw new Error();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const totalPages = document.numPages;
    let text = "";
    let pagesRead = 0;
    let truncated = totalPages > maxPages;
    outer: for (let pageNumber = 1; pageNumber <= Math.min(totalPages, maxPages); pageNumber++) {
      const page = await document.getPage(pageNumber);
      pagesRead++;
      const stream = page.streamTextContent({ disableNormalization: false });
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const item of value.items) {
            if (typeof item.str !== "string" || !item.str) continue;
            const addition = (text ? " " : "") + item.str + (item.hasEOL ? "\n" : "");
            const remaining = maxChars - text.length;
            if (addition.length > remaining) {
              text += addition.slice(0, remaining);
              truncated = true;
              await reader.cancel(new Error("Text limit reached"));
              break outer;
            }
            text += addition;
          }
        }
      } finally {
        reader.releaseLock();
        page.cleanup();
      }
    }
    text = text.trim();
    if (!text) throw new Error();
    process.stdout.write(JSON.stringify({ text, pagesRead, totalPages, truncated }));
  } finally {
    await task.destroy();
  }
} catch {
  process.exitCode = 1;
}
