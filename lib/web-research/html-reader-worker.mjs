import { extractHtmlContent } from "./html-content-worker.mjs";
let input = "";
process.stdin.setEncoding("utf8");
// JSON escaping can expand each admitted UTF-8 byte by at most six characters.
process.stdin.on("data", chunk => { input += chunk; if (input.length > 6 * 2 * 1024 * 1024 + 8192) process.exit(1); });
process.stdin.on("end", () => {
  try {
    const { text, finalUrl } = JSON.parse(input);
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 ||
      typeof finalUrl !== "string" || finalUrl.length > 4096) process.exit(1);
    process.stdout.write(JSON.stringify(extractHtmlContent(text, finalUrl)));
  } catch { process.exit(1); }
});
