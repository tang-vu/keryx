// Popup controller: resolve the question (from a context-menu stash or the active tab's selection),
// stream the Keryx agent's reasoning + answer over the OpenAI-compatible endpoint, and show which
// creators got paid. No wallet or key needed — the anonymous free tier is treasury-funded.

const els = {
  question: document.getElementById("question"),
  budget: document.getElementById("budget"),
  ask: document.getElementById("ask"),
  output: document.getElementById("output"),
  status: document.getElementById("status"),
  trace: document.getElementById("trace"),
  answerPanel: document.getElementById("answer-panel"),
  answer: document.getElementById("answer"),
  paidPanel: document.getElementById("paid-panel"),
  paidList: document.getElementById("paid-list"),
  paidTotalUsd: document.getElementById("paid-total-usd"),
  dispatchLink: document.getElementById("dispatch-link"),
  errorPanel: document.getElementById("error-panel"),
  error: document.getElementById("error"),
  listPage: document.getElementById("list-page"),
};

// Page context for the "list this page" action — set from the menu stash or the active tab.
let pageCtx = { url: "", title: "" };

/** Best-effort read of the highlighted text in the active tab (toolbar-popup case). */
async function readActiveTabSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { selection: "", url: "", title: "" };
    let selection = "";
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString(),
      });
      selection = (res?.[0]?.result || "").trim();
    } catch {
      // Restricted page (chrome://, web store, PDF viewer) — no scripting; just use the URL.
    }
    return { selection, url: tab.url || "", title: tab.title || "" };
  } catch {
    return { selection: "", url: "", title: "" };
  }
}

/** Decide the initial question + page context. A context menu hands us a stash; otherwise we read
 *  the toolbar tab's current selection. */
async function initContext() {
  const fromMenu = new URLSearchParams(location.search).get("src") === "menu";
  if (fromMenu) {
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
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function resetOutput() {
  show(els.output);
  els.trace.textContent = "";
  els.answer.textContent = "";
  els.paidList.innerHTML = "";
  hide(els.answerPanel);
  hide(els.paidPanel);
  hide(els.errorPanel);
  els.status.textContent = "working…";
}

function showError(message) {
  show(els.errorPanel);
  els.error.textContent = message;
  els.status.textContent = "failed";
}

/** Render the vendor `keryx` settlement summary (creators + amounts + receipt link). */
function renderPaid(meta) {
  if (!meta) return;
  const citations = Array.isArray(meta.citations) ? meta.citations : [];
  if (citations.length === 0) {
    els.status.textContent = "done · no paid sources cited";
    return;
  }
  for (const c of citations) {
    const li = document.createElement("li");
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = c.source || "source";
    const amt = document.createElement("span");
    amt.className = "amt";
    amt.textContent = `$${Number(c.reward || 0).toFixed(4)}`;
    li.append(src, amt);
    els.paidList.appendChild(li);
  }
  els.paidTotalUsd.textContent = `$${Number(meta.totalToCreators || 0).toFixed(4)}`;
  if (meta.dispatchUrl) els.dispatchLink.href = meta.dispatchUrl;
  show(els.paidPanel);
  els.status.textContent = "done";
}

/** Apply one streamed chat.completion.chunk to the UI. */
function applyChunk(chunk) {
  const delta = chunk?.choices?.[0]?.delta || {};
  if (delta.reasoning_content) {
    els.trace.textContent += delta.reasoning_content;
    els.trace.scrollTop = els.trace.scrollHeight;
  }
  if (delta.content) {
    show(els.answerPanel);
    els.answer.textContent += delta.content;
  }
  if (chunk?.keryx) renderPaid(chunk.keryx);
}

async function ask() {
  const question = els.question.value.trim();
  if (!question) { els.question.focus(); return; }
  const budget = Math.max(0.005, Number(els.budget.value) || 0.03);

  els.ask.disabled = true;
  els.ask.textContent = "Asking…";
  resetOutput();

  try {
    const res = await fetch(KERYX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "keryx",
        stream: true,
        budget,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!res.ok || !res.body) {
      let msg = `Keryx returned ${res.status}`;
      try {
        const err = await res.json();
        if (err?.error?.message) msg = err.error.message;
      } catch { /* non-JSON body */ }
      showError(msg);
      return;
    }

    // Parse the SSE stream: events are separated by a blank line; payload lines start with "data: ".
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const evt of events) {
        for (const line of evt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try { applyChunk(JSON.parse(data)); } catch { /* skip partial frame */ }
        }
      }
    }
    if (els.status.textContent === "working…") els.status.textContent = "done";
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    els.ask.disabled = false;
    els.ask.textContent = "Ask Keryx ▸";
  }
}

/** Deep-link the creator to /register with this page's URL + title pre-filled. */
async function listPage() {
  let { url, title } = pageCtx;
  if (!url) {
    const active = await readActiveTabSelection();
    url = active.url;
    title = active.title;
  }
  const target = `${KERYX_REGISTER}?url=${encodeURIComponent(url)}&name=${encodeURIComponent(title || "")}`;
  chrome.tabs.create({ url: target });
}

els.ask.addEventListener("click", ask);
els.question.addEventListener("keydown", (e) => {
  // Ctrl/Cmd+Enter submits, matching the site's ask box.
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
});
els.listPage.addEventListener("click", listPage);

initContext();
