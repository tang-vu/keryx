/** Explicit bounded metadata collection; default only lists reviewed targets. */
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchPublicDocument, fetchPublicUrl } from "../lib/net/public-fetch";
import { parseArxiv } from "../lib/scholarly/arxiv";
import { fetchMetadata } from "../lib/scholarly/provider";
import { targetListSchema, paperMetadataUrl, httpsUrl, year, verifyRecord, publisherMetadata, parsePublisherPaper, parseOpenReviewPaper, type CollectedPaper } from "../lib/papers/collector";
const targetFile = new URL("./paper-catalog-targets.json", import.meta.url);
const catalogFile = new URL("../lib/papers/catalog-data.json", import.meta.url);
const officialHosts = new Set(["export.arxiv.org", "api2.openreview.net", "proceedings.mlr.press", "aclanthology.org"]);

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply" && arg !== "--help") || new Set(args).size !== args.length) throw new Error("Usage: node --import tsx scripts/collect-paper-catalog.mts [--apply]");
  if (args.includes("--help")) { console.log("Without --apply: list fixed reviewed targets, no requests or writes. --apply: fetch bounded official metadata; replace only lib/papers/catalog-data.json if all targets pass. PDF links are locations, not read evidence."); return; }
  const targets = targetListSchema.parse(JSON.parse(await readFile(targetFile, "utf8")));
  const requestCap = targets.length * 2;
  if (!args.includes("--apply")) { console.log(JSON.stringify({ mode: "dry-list", targets, requestCap, maxResponseBytes: 250000, timeoutMs: 6000, redirects: 0, deadlineMs: 300000, writes: [] }, null, 2)); return; }

  const signal = AbortSignal.timeout(300000);
  const nextRequest = new Map<string, number>();
  let requests = 0;
  const admit = async (url: string) => {
    const parsed = new URL(url);
    if (!httpsUrl(url) || !officialHosts.has(parsed.hostname)) throw new Error("Only fixed official metadata hosts are allowed");
    if (++requests > requestCap) throw new Error("Metadata request cap reached");
    const wait = Math.max(0, (nextRequest.get(parsed.hostname) ?? 0) - Date.now());
    if (wait) await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error("Collection deadline reached")); return; }
      const abort = () => { clearTimeout(timer); reject(new Error("Collection deadline reached")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
      signal.addEventListener("abort", abort, { once: true });
    });
    signal.throwIfAborted();
    return parsed.hostname;
  };
  const finish = (host: string) => nextRequest.set(host, Date.now() + (host === "export.arxiv.org" ? 3100 : 1000));
  const records: CollectedPaper[] = [];
  for (const target of targets) {
    const metadataUrl = paperMetadataUrl(target);
    const host = await admit(metadataUrl);
    let text: string;
    try {
      if (target.repository === "arxiv") text = await fetchMetadata(metadataUrl, signal);
      else text = (await fetchPublicDocument(metadataUrl, { maxBytes: 250000, timeoutMs: 6000, maxHops: 0, httpsOnly: true, signal,
        allowedContentTypes: target.repository === "openreview" ? ["application/json"] : ["text/html"] })).text;
    } finally { finish(host); }
    const metadataObservedAt = new Date().toISOString();
    let record: CollectedPaper;
    if (target.repository === "arxiv") {
      const returned = (await parseArxiv(text, metadataObservedAt)).filter(item => item.arxivId === target.id);
      if (returned.length !== 1) throw new Error("Exact arXiv version was not returned");
      const paper = returned[0];
      record = verifyRecord({ title: paper.title, authors: paper.authors, authorCount: paper.authorCount ?? paper.authors.length,
        authorsTruncated: paper.authorsTruncated ?? false, publishedYear: year(paper.publishedDate), doi: paper.doi,
        arxivId: target.id, repository: "arxiv", url: `https://arxiv.org/abs/${target.id}`, metadataUrl, metadataObservedAt,
        publicationKind: "preprint", peerReview: "unknown", links: [{ label: "PDF", url: `https://arxiv.org/pdf/${target.id}` }] }, target);
    } else if (target.repository === "openreview") record = parseOpenReviewPaper(text, target, metadataUrl, metadataObservedAt);
    else {
      record = parsePublisherPaper(text, target, metadataUrl, metadataObservedAt);
      // Older PMLR records advertise HTTP PDFs. Offer an HTTPS link only after a
      // bounded, DNS-pinned HEAD confirms PDF delivery at the same publisher path.
      const rawPdf = publisherMetadata(text).get("citation_pdf_url")?.[0];
      if (target.repository === "pmlr" && rawPdf?.startsWith("http://proceedings.mlr.press/")) {
        const securePdf = rawPdf.replace(/^http:/, "https:");
        const pdfHost = await admit(securePdf);
        try {
          const response = await fetchPublicUrl(securePdf, { method: "HEAD", signal }, { timeoutMs: 6000 });
          if (response.status === 200 && response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/pdf") record.links = [{ label: "PDF", url: securePdf }];
          else console.warn(`HTTPS PDF link omitted: ${target.id} (${response.status})`);
        } catch { console.warn(`HTTPS PDF link unavailable: ${target.id}`); }
        finally { finish(pdfHost); }
      }
    }
    records.push(verifyRecord(record, target));
    console.log(JSON.stringify({ repository: record.repository, title: record.title, authors: record.authorCount, bytes: Buffer.byteLength(text), metadataObservedAt }));
  }
  signal.throwIfAborted();
  const temporary = `${fileURLToPath(catalogFile)}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, fileURLToPath(catalogFile));
  } finally { await rm(temporary, { force: true }); }
  console.log(JSON.stringify({ mode: "applied-local-catalog", records: records.length, requests, path: fileURLToPath(catalogFile), scope: "Observed bibliography only; no full-text read, database, model, or payment" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Paper catalog collection failed"); process.exitCode = 1; });
}
