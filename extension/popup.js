// Thin hosted research client. The server owns admission, payment and stored report authority.
import { formatRecordedUsdc } from "./recorded-usdc.mjs";
import { hostedReportUrl, publicPageUrl, readResearchStream, researchQuestion,
  responseError, sourceBudget, webDraftUrl } from "./research-client.mjs";

const els = Object.fromEntries([
  "question", "budget", "ask", "stop", "mode", "scholarly", "include-page", "page-context",
  "web-draft", "availability", "output", "status", "trace", "answer-panel", "answer",
  "paid-panel", "paid-list", "paid-total-usd", "pending-total", "dispatch-link",
  "exports", "error-panel", "error", "list-page", "recent-panel", "recent-list", "clear-recent",
].map(id => [id, document.getElementById(id)]));
const origin = new URL(KERYX_API).origin;
const RECENT_KEY = "keryx_recent_reports_v1";
let pageCtx = { url: "", title: "" };
let activeRequest = null;
let recordedExports = null;
let recent = [];

async function readActiveTabSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { selection: "", url: "", title: "" };
    let selection = "";
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: () => window.getSelection().toString() });
      selection = (res?.[0]?.result || "").trim();
    } catch { /* Restricted tabs cannot expose selection. */ }
    return { selection, url: tab.url || "", title: tab.title || "" };
  } catch { return { selection: "", url: "", title: "" }; }
}

async function initContext() {
  try {
    if (new URLSearchParams(location.search).get("src") === "menu") {
      const stash = await chrome.storage.local.get(KERYX_PENDING_KEY);
      const pending = stash[KERYX_PENDING_KEY];
      await chrome.storage.local.remove(KERYX_PENDING_KEY);
      if (pending) {
        els.question.value = pending.question || "";
        pageCtx = { url: pending.sourceUrl || "", title: pending.sourceTitle || "" };
        return;
      }
    }
    const { selection, url, title } = await readActiveTabSelection();
    if (selection) els.question.value = selection;
    pageCtx = { url, title };
  } finally {
    els["include-page"].disabled = !publicPageUrl(pageCtx.url);
    els["page-context"].textContent = publicPageUrl(pageCtx.url) || "Only your question or selected text is sent by default.";
  }
}

function showError(message) {
  els.output.hidden = false;
  els["error-panel"].hidden = false;
  els.error.textContent = message;
  els.status.textContent = "failed";
}

function reportLink(value) {
  const url = hostedReportUrl(value, origin);
  if (!url) return;
  els["dispatch-link"].href = url;
  els["dispatch-link"].hidden = false;
}

function renderSummary(meta) {
  els["paid-list"].replaceChildren();
  for (const c of Array.isArray(meta.citations) ? meta.citations : []) {
    const li = document.createElement("li");
    const url = publicPageUrl(c.itemUrl);
    const src = document.createElement(url ? "a" : "span");
    src.className = "src";
    src.textContent = `${c.marker ? `[${c.marker}] ` : ""}${c.itemTitle || c.sourceName || c.source || "source"}`;
    if (url) { src.href = url; src.target = "_blank"; src.rel = "noopener noreferrer"; }
    const amt = document.createElement("span");
    amt.className = "amt";
    amt.textContent = formatRecordedUsdc(c.reward, { minimumFractionDigits: 4 });
    li.append(src, amt);
    els["paid-list"].appendChild(li);
  }
  els["paid-total-usd"].textContent = formatRecordedUsdc(meta.totalToCreators, { minimumFractionDigits: 4 });
  els["pending-total"].textContent = ` Pending source spend: ${formatRecordedUsdc(meta.pendingSpendUsdc, { minimumFractionDigits: 4 })}.`;
  els["paid-panel"].hidden = false;
  reportLink(meta.dispatchUrl);
  recordedExports = meta.researchExports ?? null;
  els.exports.hidden = !recordedExports;
  for (const button of els.exports.querySelectorAll("[data-export]")) {
    const value = recordedExports?.[button.dataset.export];
    button.disabled = typeof value === "string" ? !value : !value?.content || !value?.count;
  }
  els.status.dataset.paymentMode = meta.paymentMode || "legacy";
  els.status.textContent = "checking completion…";
}

function renderRecent() {
  els["recent-list"].replaceChildren();
  for (const report of recent) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = report.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Report · ${new Date(report.at).toLocaleString()}`;
    li.appendChild(link);
    els["recent-list"].appendChild(li);
  }
  els["recent-panel"].hidden = recent.length === 0;
}

async function loadRecent() {
  try {
    const stored = (await chrome.storage.local.get(RECENT_KEY))[RECENT_KEY];
    recent = (Array.isArray(stored) ? stored : []).filter(row => row && hostedReportUrl(row.url, origin) &&
      Number.isSafeInteger(row.at) && row.at > 0 && row.at <= Date.now()).slice(0, 10)
      .map(row => ({ url: hostedReportUrl(row.url, origin), at: row.at }));
    renderRecent();
  } catch { /* Optional device history must not block research. */ }
}

async function saveReport() {
  await recentReady;
  const url = hostedReportUrl(els["dispatch-link"].getAttribute("href"), origin);
  if (!url || els["dispatch-link"].hidden) return;
  recent = [{ url, at: Date.now() }, ...recent.filter(row => row.url !== url)].slice(0, 10);
  renderRecent();
  try { await chrome.storage.local.set({ [RECENT_KEY]: recent }); } catch { /* Report remains available on web. */ }
}

function requestFields() {
  return { question: researchQuestion(els.question.value, pageCtx.url, els["include-page"].checked),
    budget: sourceBudget(els.budget.value), mode: els.mode.value === "deep" ? "deep" : "quick",
    scholarly: els.scholarly.checked };
}

async function ask() {
  if (activeRequest) return;
  let fields;
  try { fields = requestFields(); } catch (err) { showError(err.message); return; }
  const controller = new AbortController();
  activeRequest = controller;
  els.ask.disabled = true;
  els.ask.textContent = "Asking…";
  els.stop.hidden = false;
  els.output.hidden = false;
  els.trace.textContent = "";
  els.answer.textContent = "";
  els.status.textContent = "working…";
  recordedExports = null;
  for (const id of ["answer-panel", "paid-panel", "error-panel", "exports", "dispatch-link"]) els[id].hidden = true;
  els["dispatch-link"].removeAttribute("href");
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 300_000);
  try {
    const res = await fetch(KERYX_API, { method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "keryx", stream: true,
        budget: fields.budget, mode: fields.mode, scholarly: fields.scholarly,
        messages: [{ role: "user", content: fields.question }] }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(responseError(body, res.status));
    }
    await readResearchStream(res, chunk => {
      if (typeof chunk?.id === "string" && chunk.id.startsWith("chatcmpl-")) reportLink(`${origin}/dispatch/${chunk.id.slice(9)}`);
      const delta = chunk?.choices?.[0]?.delta || {};
      if (typeof delta.reasoning_content === "string") {
        els.trace.textContent += delta.reasoning_content;
        els.trace.scrollTop = els.trace.scrollHeight;
      }
      if (typeof delta.content === "string") {
        els["answer-panel"].hidden = false;
        els.answer.textContent += delta.content;
      }
      if (chunk?.keryx) renderSummary(chunk.keryx);
    });
    if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
    els.status.textContent = `done / ${els.status.dataset.paymentMode || "legacy"} / planned rewards are not settlement proof`;
    await saveReport();
  } catch (err) {
    if (controller.signal.aborted) {
      showError(`${timedOut ? "Watching timed out." : "Stopped watching."} The server may still finish research or payments. Inspect the report before starting another request.`);
      els.status.textContent = timedOut ? "timed out" : "stopped";
    } else showError(err instanceof Error ? err.message : String(err));
    els.exports.hidden = true;
  } finally {
    clearTimeout(timeout);
    activeRequest = null;
    els.ask.disabled = false;
    els.ask.textContent = "Ask Keryx ▸";
    els.stop.hidden = true;
  }
}

function downloadExport(key) {
  const value = recordedExports?.[key];
  const content = typeof value === "string" ? value : value?.content;
  if (typeof content !== "string" || !content) return;
  const formats = { bibtex: ["bib", "text/plain"], ris: ["ris", "application/x-research-info-systems"],
    cslJson: ["json", "application/json"], evidenceCsv: ["csv", "text/csv"] };
  const format = formats[key];
  if (!format) return;
  const url = URL.createObjectURL(new Blob([content], { type: `${format[1]};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `keryx-recorded-references.${format[0]}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.ask.addEventListener("click", ask);
els.stop.addEventListener("click", () => activeRequest?.abort());
els.question.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void ask(); }
});
els["web-draft"].addEventListener("click", () => {
  try {
    const fields = requestFields();
    chrome.tabs.create({ url: webDraftUrl(origin, fields.question, fields.budget, fields.mode) });
  } catch (err) { showError(err.message); }
});
els["list-page"].addEventListener("click", async () => {
  const page = pageCtx.url ? pageCtx : await readActiveTabSelection();
  chrome.tabs.create({ url: `${KERYX_REGISTER}?url=${encodeURIComponent(page.url || "")}&name=${encodeURIComponent(page.title || "")}` });
});
for (const button of els.exports.querySelectorAll("[data-export]")) button.addEventListener("click", () => downloadExport(button.dataset.export));
void initContext().catch(() => { /* Manual questions remain available. */ });
const recentReady = loadRecent();
els["clear-recent"].addEventListener("click", async () => {
  await recentReady;
  recent = [];
  renderRecent();
  try { await chrome.storage.local.remove(RECENT_KEY); } catch {
    showError("The device list could not be cleared from storage.");
  }
});
// This GET observes the global pause only; the POST always enforces admission again.
void fetch(`${origin}/api/research/availability`, { cache: "no-store", signal: AbortSignal.timeout(5000) })
  .then(async response => response.ok ? response.json() : null)
  .then(value => { els.availability.textContent = value?.state === "paused" ? "New research is paused. Saved reports remain available; connecting a wallet does not remove the pause." :
    value?.state === "not-paused" ? "Each question requires server admission; no automatic retry runs." : "Availability could not be checked. Each question still requires server admission." ; })
  .catch(() => { els.availability.textContent = "Availability could not be checked. Each question still requires server admission."; });
