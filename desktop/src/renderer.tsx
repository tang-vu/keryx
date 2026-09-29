import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CreateInput, DesktopAPI, SavedResult, WorkspaceView } from "./contracts";

declare global { interface Window { keryxDesktop: DesktopAPI } }

const initialForm: CreateInput = { question: "", mode: "quick", creatorBudget: "0.01", payee: "", totalCap: "0.10" };
const money = (micros: number | string) => `${(Number(micros) / 1e6).toFixed(6)} USDC`;
const clock = (value: string) => new Date(value).toLocaleString();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const stageLabel: Record<string, string> = { ready: "Ready to purchase", buyer_journaled: "Saved buyer attempt", journal_incomplete: "Needs review" };

function App() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<CreateInput>(initialForm);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<{ handle: string; text: string; truncated: boolean } | null>(null);
  const [savedResult, setSavedResult] = useState<{ handle: string; value: SavedResult; revision: number } | null>(null);
  const [lastCheck, setLastCheck] = useState<{ handle: string; status: "saved" | "unsaved" | "incomplete" } | null>(null);
  const [resultRevision, setResultRevision] = useState(0);
  const task = view?.tasks.find((item) => item.handle === selected) ?? null;
  const selectedHandle = task?.handle;
  const savedStatus = task?.status.savedResult;
  const currentSavedResult = savedResult && savedResult.handle === selectedHandle && savedResult.revision === resultRevision ? savedResult : null;

  useEffect(() => {
    if (!selectedHandle || savedStatus !== "present_unchecked") return;
    let active = true;
    window.keryxDesktop.readResult(selectedHandle).then(result => {
      if (active) setSavedResult(result ? { handle: selectedHandle, value: result, revision: resultRevision } : null);
    }).catch(cause => { if (active) { setSavedResult(null); setError(`Saved result cannot be opened: ${errorText(cause)}`); } });
    return () => { active = false; };
  }, [selectedHandle, savedStatus, resultRevision]);

  async function refresh(prefer?: string) {
    const next = await window.keryxDesktop.refresh();
    setView(next);
    setResultRevision(value => value + 1);
    setSelected(prefer ?? (current => current === null ? null : next.tasks.some(t => t.handle === current) ? current : next.tasks[0]?.handle ?? null));
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    window.keryxDesktop.refresh().then(setView).catch(() => undefined);
  }, []);

  function patch<K extends keyof CreateInput>(key: K, value: CreateInput[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
  }

  const buyerCommand = task && view ? `npm run buyer -- buy --request ${psQuote(`${view.path}\\${task.directoryName}\\request.json`)} --payee ${task.payee} --max-total ${money(task.status.maxTotalMicros).split(" ")[0]} --state ${psQuote(`${view.path}\\${task.directoryName}\\buyer`)}` : "";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">K</div><div><strong>Keryx</strong><span>OPERATOR · ALPHA</span></div></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <div className="workspace-card"><div className="workspace-icon">⌂</div><div className="workspace-copy"><strong>{view?.name ?? "No workspace open"}</strong><small>{view ? `${view.tasks.length} research tasks` : "Choose a private local folder"}</small></div></div>
      <div className="sidebar-actions">
        <button disabled={!!busy} onClick={() => run("opening", async () => { const next = await window.keryxDesktop.chooseWorkspace(); if (next) { setView(next); setSelected(next.tasks[0]?.handle ?? null); } })}>Open workspace</button>
        <button disabled={!!busy} onClick={() => run("creating", async () => { const next = await window.keryxDesktop.createWorkspace(); if (next) { setView(next); setSelected(null); setNotice(next.creationState === "windows_visible_entry_unproven" ? "Workspace created and visible. Keep a backup of important local work." : "Private workspace created."); } })}>New workspace</button>
      </div>
      {view && <><button className="new-task-button" onClick={() => { setSelected(null); setAnswer(null); }}>＋ New research task</button><div className="sidebar-section-label tasks-label">RESEARCH TASKS <button className="text-icon" disabled={!!busy} onClick={() => run("refreshing", () => refresh())} title="Refresh tasks">↻</button></div>
        <div className="task-list">{view.tasks.length === 0 && <p className="quiet-list">Your workspace has no tasks yet.</p>}{view.tasks.map(item => <button key={item.handle} className={`task-item ${selected === item.handle ? "active" : ""}`} onClick={() => setSelected(item.handle)}>
          <span className="task-item-top"><span className="task-mini-icon">◈</span><span className="task-item-title">{item.question}</span></span>
          <span className="task-item-foot"><span>{item.mode.toUpperCase()}</span><span>{stageLabel[item.status.stage] ?? item.status.stage}</span></span>
        </button>)}</div>
        <div className="sidebar-bottom"><span className="status-dot"/> Arc testnet <span className="muted">· local workspace</span></div></>}
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> {task ? "TASK DETAIL" : "OVERVIEW"}</div><span className="network-pill"><span className="status-dot"/> ARC TESTNET</span></header>
      <div className="content">
        {error && <div role="alert" className="alert error"><strong>Could not complete action</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        {!view ? <div className="empty-hero"><div className="hero-orbit">◈</div><span className="eyebrow">LOCAL RESEARCH OPERATIONS</span><h1>Your work, in one place.</h1><p>Open an existing Operator folder or create a private workspace to collect research tasks and local reference files.</p><div className="hero-actions"><button className="primary" disabled={!!busy} onClick={() => run("creating", async () => { const next = await window.keryxDesktop.createWorkspace(); if (next) { setView(next); setNotice(next.creationState === "windows_visible_entry_unproven" ? "Workspace created and visible. Keep a backup of important local work." : "Private workspace created."); } })}>Create workspace <span>→</span></button><button className="secondary" disabled={!!busy} onClick={() => run("opening", async () => { const next = await window.keryxDesktop.chooseWorkspace(); if (next) { setView(next); setSelected(next.tasks[0]?.handle ?? null); } })}>Open existing</button></div></div> : <>
          <div className="page-heading"><div><span className="eyebrow">OPERATOR WORKSPACE</span><h1>{task ? "Research task" : "Research desk"}</h1><p>{task ? "A local record of your request, spending boundary, and recovery state." : "Prepare a bounded research task and keep your local evidence together."}</p></div><button className="secondary refresh" disabled={!!busy} onClick={() => run("refreshing", () => refresh())}>↻ Refresh</button></div>
          <div className="summary-grid"><div className="summary-card"><span>RESEARCH TASKS</span><strong>{view.tasks.length}</strong><small>Persisted in this workspace</small></div><div className="summary-card"><span>LOCAL REFERENCES</span><strong>{view.references.length}</strong><small>Text snapshots only</small></div><div className="summary-card"><span>NETWORK</span><strong className="summary-network">Arc testnet</strong><small>Task preparation is local</small></div></div>
          {task ? <section className="panel task-detail"><div className="panel-heading"><div><span className="eyebrow">{task.mode.toUpperCase()} RESEARCH · {clock(task.createdAt)}</span><h2>{task.question}</h2></div><span className="stage-pill">{stageLabel[task.status.stage] ?? task.status.stage}</span></div>
            <div className="detail-grid"><div><span>Creator budget</span><strong>{money(task.status.creatorBudgetMicros)}</strong></div><div><span>Total job cap</span><strong>{money(task.status.maxTotalMicros)}</strong></div><div><span>Payment</span><strong>Unknown</strong></div><div><span>Delivery</span><strong>Unknown</strong></div></div>
            {task.status.lastObservation && <div className="observation"><div><span className="eyebrow">LAST CHECKED RESULT · MAY BE OUT OF DATE</span><strong>{task.status.lastObservation.status.replaceAll("_", " ")}</strong><small>Checked {clock(task.status.lastObservation.observedAt)} · payment {task.status.lastObservation.payment.replaceAll("_", " ")}</small></div><p>Payment details are reported by the seller. Check again for the latest delivery state.</p></div>}
            {currentSavedResult && <div className="answer"><span className="eyebrow">{lastCheck?.handle === task.handle && lastCheck.status !== "saved" ? "PREVIOUS SAVED RESULT · LOCAL RECHECK" : "SAVED RESEARCH RESULT · LOCAL RECHECK"}</span><p>{currentSavedResult.value.answer}</p>{currentSavedResult.value.citations.length > 0 && <div className="saved-citations"><strong>Cited sources in saved receipt</strong>{currentSavedResult.value.citations.map((citation, index) => <div key={`${citation.marker}-${index}`}>{citation.marker} {citation.sourceName}</div>)}</div>}<small>Saved {clock(currentSavedResult.value.savedAt)}. Local receipt and original task binding checked. The original server response and settlement cannot be independently rechecked offline.</small></div>}
            {task.status.savedResult === "invalid" && <div className="inline-warning">The saved result file is invalid. Keep the original buyer journal and check the original job again.</div>}
            {answer?.handle === task.handle && <div className="answer"><span className="eyebrow">ANSWER FROM LATEST CHECK · NOT SAVED LOCALLY</span><p>{answer.text}</p><small>{answer.truncated ? "Preview truncated at 50,000 characters. " : ""}The original buyer receipt remains in the buyer journal. Retry the original job check to save this answer locally.</small></div>}
            {task.status.stage === "journal_incomplete" && <div className="inline-warning">The buyer journal is incomplete. Inspect the original attempt before recovery; preserve this task directory.</div>}
            <div className="task-actions"><button className="primary" disabled={!!busy || task.status.stage !== "buyer_journaled"} onClick={() => run("resuming", async () => { const result = await window.keryxDesktop.resumeTask(task.handle); const checkState = result.localResult.state === "saved" ? "saved" : result.answer ? "unsaved" : "incomplete"; setLastCheck({ handle: task.handle, status: checkState }); setAnswer(checkState === "unsaved" && result.answer ? { handle: task.handle, text: result.answer, truncated: result.answerTruncated } : null); if (checkState === "saved") setSavedResult(null); await refresh(); if (result.localResult.state === "save_failed") setError(result.localResult.message ?? "Completed result could not be saved locally."); else if (result.localObservation === "save_failed") setError("Result checked, but its latest status could not be saved locally. The original buyer journal remains available."); else setNotice("Result checked. Payment confirmation is shown separately."); })}>Check original job</button><button className="secondary" disabled={!!busy || !currentSavedResult} onClick={() => run("brief", async () => { if (await window.keryxDesktop.exportBrief(task.handle)) setNotice("Private research brief saved."); })}>Export private brief</button><button className="secondary" disabled={!!busy} onClick={() => run("exporting", async () => { if (await window.keryxDesktop.exportTask(task.handle)) setNotice("Private status JSON saved."); })}>Export status JSON</button></div>
            <details className="handoff"><summary>Buyer CLI handoff · PowerShell</summary><p>Run this command from the Keryx repository. Before any deliberate purchase, independently confirm the pinned payee and total cap. Run the buyer CLI once for this task. If it becomes uncertain, resume the original journal.</p><div className="payee"><span>PINNED PAYEE</span><code>{task.payee}</code></div><pre>{buyerCommand}</pre></details>
          </section> : <section className="panel create-panel"><div className="panel-heading"><div><span className="eyebrow">NEW TASK</span><h2>Prepare paid research</h2><p>Save a request and spending boundary. Creating a task does not make a purchase.</p></div><div className="panel-symbol">✦</div></div>
            <form onSubmit={event => { event.preventDefault(); run("saving", async () => { const created = await window.keryxDesktop.createTask(form); try { await refresh(created.handle); }
              catch { throw new Error(`Task was created in ${view.path}\\${created.directoryName}, but the workspace view could not be refreshed. Keep that folder and inspect it before retrying.`); }
              setForm(initialForm); setNotice(created.publicationState === "windows_visible_entry_unproven" ? "Research task created and visible. Keep a backup of important local work." : "Research task created in your workspace."); }); }}>
              <label className="field full">Research question<textarea required maxLength={2000} rows={3} placeholder="What would you like to investigate?" value={form.question} onChange={event => patch("question", event.target.value)}/></label>
              <div className="form-grid"><label className="field">Research mode<select value={form.mode} onChange={event => patch("mode", event.target.value as CreateInput["mode"])}><option value="quick">Quick</option><option value="deep">Deep</option></select></label><label className="field">Creator budget · USDC<input required inputMode="decimal" value={form.creatorBudget} onChange={event => patch("creatorBudget", event.target.value)} /></label></div>
              <div className="form-grid"><label className="field">Pinned seller payee<input required spellCheck={false} placeholder="0x... independently verified" value={form.payee} onChange={event => patch("payee", event.target.value)}/></label><label className="field">Total job cap · USDC<input required inputMode="decimal" value={form.totalCap} onChange={event => patch("totalCap", event.target.value)}/></label></div>
              <div className="form-footer"><span>Arc testnet only · cap must exceed creator budget · 1 USDC maximum</span><button className="primary" disabled={!!busy}>Save task <span>→</span></button></div>
            </form>
          </section>}
          <section className="panel library"><div className="panel-heading"><div><span className="eyebrow">LOCAL LIBRARY</span><h2>Reference snapshots</h2><p>Imported text and Markdown stay in this workspace. They are not uploaded or used in research answers yet.</p></div><button className="secondary" disabled={!!busy} onClick={() => run("importing", async () => { if (await window.keryxDesktop.importReference()) { await refresh(); setNotice("Local reference snapshot imported."); } })}>+ Import file</button></div>
            {view.references.length ? <div className="reference-list">{view.references.map(ref => <div key={ref.handle} className="reference-row"><span className="file-icon">▤</span><div><strong>{ref.name}</strong><small>Imported {clock(ref.importedAt)} · {ref.bytes.toLocaleString()} bytes</small><code>SHA-256 {ref.sha256}</code></div></div>)}</div> : <div className="library-empty">No references imported yet. Choose a .txt or .md file up to 256 KiB.</div>}
          </section>
          {view.invalidDirectories > 0 && <p className="unrecognized">{view.invalidDirectories} folder{view.invalidDirectories === 1 ? "" : "s"} could not be recognized as valid Operator tasks and were left untouched.</p>}
        </>}
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
