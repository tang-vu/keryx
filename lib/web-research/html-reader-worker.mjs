import { extractHtmlContent } from "./html-content-worker.mjs";
import { selectHtmlSection } from "./html-section-worker.mjs";
let input = "";
process.stdin.setEncoding("utf8");
// JSON escaping can expand each admitted UTF-8 byte by at most six characters.
process.stdin.on("data", chunk => { input += chunk; if (input.length > 6 * 2 * 1024 * 1024 + 8192) process.exit(1); });
process.stdin.on("end", async () => {
  try {
    const { text, finalUrl, fragment } = JSON.parse(input);
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 ||
      typeof finalUrl !== "string" || finalUrl.length > 4096) process.exit(1);
    const selected = fragment === undefined ? undefined : await selectHtmlSection(text, fragment);
    const result = extractHtmlContent(selected?.html ?? text, finalUrl);
    process.stdout.write(JSON.stringify({ ...result, ...(selected ? { truncated: true, htmlSectionScope: selected.scope } : {}) }));
  } catch { process.exit(1); }
});
