import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; if (input.length > 550000) process.exit(1); });
process.stdin.on("end", () => {
  try {
    const { text, finalUrl } = JSON.parse(input);
    const dom = new JSDOM(text, { url: finalUrl });
    const parsed = new Readability(dom.window.document, { maxElemsToParse: 20000 }).parse();
    const body = parsed?.textContent?.replace(/\s+/gu, " ").trim();
    if (!body || body.length < 100) process.exit(1);
    process.stdout.write(JSON.stringify({ text: body.slice(0, 60000), title: parsed.title?.slice(0, 200) || new URL(finalUrl).hostname,
      finalUrl, kind: "html", truncated: body.length > 60000 }));
    dom.window.close();
  } catch { process.exit(1); }
});
