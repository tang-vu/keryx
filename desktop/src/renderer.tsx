import { formatAmount, formatNumber, formatDate, selectPlural, resolveViewerTimeZone } from "../../lib/i18n/format";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CreateInput, DesktopAPI, SavedResult, WorkspaceView } from "./contracts";
import { createMessages } from "../../lib/i18n/messages";
import { checkedBibliographyExportCopy } from "../../locales/en/checked-bibliography-exports";
import { clientPresentationLanguage, clientPresentationMessages } from "../../shared/i18n/client-language";

declare global { interface Window { keryxDesktop: DesktopAPI } }

const message = createMessages("en");

const initialForm: CreateInput = { question: "", mode: "quick", creatorBudget: "0.01", payee: "", totalCap: "0.10", network: "arc" };
const money = (micros: number | string) => formatAmount(micros, { denomination: "USDC", minimumFractionDigits: 6 });
// Fixed machine argument retains the shipped buyer-command contract; never parse display money.
const buyerCommandAmount = (micros: number | string) => (Number(micros) / 1e6).toFixed(6);
const clock = (value: string) => { const date = formatDate(value, "en", resolveViewerTimeZone()); return date ? `${date.text} (${date.utc})` : "Unavailable"; };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const stageLabel: Record<string, string> = { ready: message("nativeDesktop.stage.ready"), buyer_journaled: message("nativeDesktop.stage.buyerJournaled"), journal_incomplete: message("nativeDesktop.stage.incomplete") };

const busyLabel = {
  opening: message("nativeDesktop.busy.opening"),
  creating: message("nativeDesktop.busy.creating"),
  refreshing: message("nativeDesktop.busy.refreshing"),
  resuming: message("nativeDesktop.busy.resuming"),
  brief: message("nativeDesktop.busy.brief"),
  exporting: message("nativeDesktop.busy.exporting"),
  saving: message("nativeDesktop.busy.saving"),
  importing: message("nativeDesktop.busy.importing"),
} as const;
type BusyAction = keyof typeof busyLabel;
const exportLabel = {
  "bibtex": message("nativeDesktop.exports.bibtex"),
  "ris": message("nativeDesktop.exports.ris"),
  "csl-json": message("nativeDesktop.exports.csl-json"),
  "evidence-csv": message("nativeDesktop.exports.evidence-csv"),
} as const;

function MintMark({ large = false }: { large?: boolean }) {
  return <svg className={large ? "mint-mark large" : "mint-mark"} viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="76" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="80" cy="80" r="68" fill="none" stroke="currentColor" strokeWidth="7" strokeDasharray="2.2 7.1" />
    <circle cx="80" cy="80" r="60" fill="none" stroke="currentColor" strokeWidth="1" />
    <text x="80" y="110" textAnchor="middle" fill="currentColor" className="mint-mark-letter">{message("nativeDesktop.brand.mark")}</text>
  </svg>;
}

function App() {
  const [languageOverride, setLanguageOverride] = useState("auto");
  const presentationLanguage = clientPresentationLanguage(navigator.language, languageOverride);
  const presentation = clientPresentationMessages(presentationLanguage).controls;
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<CreateInput>(initialForm);
  const [busy, setBusy] = useState<BusyAction | "">("");
  const [resultLoading, setResultLoading] = useState(false);
  const [ready, setReady] = useState(false);
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
  const controlsBusy = !!busy || resultLoading;

  useLayoutEffect(() => {
    if (!selectedHandle || savedStatus !== "present_unchecked") { setResultLoading(false); return; }
    let active = true;
    setResultLoading(true);
    window.keryxDesktop.readResult(selectedHandle).then(result => {
      if (active) setSavedResult(result ? { handle: selectedHandle, value: result, revision: resultRevision } : null);
    }).catch(cause => { if (active) { setSavedResult(null); setError(message("nativeDesktop.savedResult.openFailed", { reason: errorText(cause) })); } })
      .finally(() => { if (active) setResultLoading(false); });
    return () => { active = false; };
  }, [selectedHandle, savedStatus, resultRevision]);

  async function refresh(prefer?: string) {
    const next = await window.keryxDesktop.refresh();
    if (!next) throw new Error(message("nativeDesktop.workspace.unavailable"));
    setView(next);
    setResultRevision(value => value + 1);
    setSelected(prefer ?? (current => current === null ? null : next.tasks.some(t => t.handle === current) ? current : next.tasks[0]?.handle ?? null));
  }

  async function run(label: BusyAction, action: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    window.keryxDesktop.refresh().then(setView).catch(cause => {
      setError(message("nativeDesktop.workspace.openFailed", { reason: errorText(cause) }));
    }).finally(() => setReady(true));
  }, []);

  function patch<K extends keyof CreateInput>(key: K, value: CreateInput[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
  }

  const taskLabel = task?.status.network === "eip155:5042" ? message("nativeDesktop.network.mainnet") : message("nativeDesktop.network.testnet");
  const preparedLabel = form.network === "arc" ? message("nativeDesktop.network.mainnet") : message("nativeDesktop.network.testnet");
  const buyerRail = task?.status.network === "eip155:5042" ? "arc" : "arcTestnet";
  const buyerCommand = task && view ? `$env:KERYX_NETWORK=${psQuote(buyerRail)}; $env:NEXT_PUBLIC_KERYX_NETWORK=${psQuote(buyerRail)}; npm run buyer -- buy --request ${psQuote(`${view.path}\\${task.directoryName}\\request.json`)} --payee ${task.payee} --max-total ${buyerCommandAmount(task.status.maxTotalMicros)} --state ${psQuote(`${view.path}\\${task.directoryName}\\buyer`)}` : "";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><MintMark/><div><strong>{message("nativeDesktop.brand.name")}</strong><span>{message("nativeDesktop.brand.tagline")}</span></div></div>
      <label className="sidebar-section-label">{presentation.language}<select aria-label={presentation.language} value={languageOverride} onChange={event => setLanguageOverride(event.target.value)}>
        <option value="auto">{presentation.auto}</option><option value="en">English</option><option value="vi">Tiếng Việt</option><option value="pt">Português</option><option value="es">Español</option>
      </select></label>
      <div className="sidebar-section-label">{message("nativeDesktop.workspace.section")}</div>
    <div className="workspace-card"><div className="workspace-icon">⌂</div><div className="workspace-copy"><strong>{view?.name ?? message("nativeDesktop.workspace.none")}</strong><small>{view ? message(selectPlural(view.tasks.length) === "one" ? "nativeDesktop.workspace.taskCount.one" : "nativeDesktop.workspace.taskCount.other", { count: view.tasks.length }) : message("nativeDesktop.workspace.chooseFolder")}</small></div></div>
      <div className="sidebar-actions">
        <button disabled={!ready || controlsBusy} onClick={() => run("opening", async () => { const next = await window.keryxDesktop.chooseWorkspace(); if (next) { setView(next); setSelected(next.tasks[0]?.handle ?? null); } })}>{message("nativeDesktop.workspace.open")}</button>
        <button disabled={!ready || controlsBusy} onClick={() => run("creating", async () => { const next = await window.keryxDesktop.createWorkspace(); if (next) { setView(next); setSelected(null); setNotice(next.creationState === "windows_visible_entry_unproven" ? message("nativeDesktop.workspace.createdVisible") : message("nativeDesktop.workspace.created")); } })}>{message("nativeDesktop.workspace.new")}</button>
      </div>
      {view && <><button className="new-task-button" disabled={controlsBusy} onClick={() => { setSelected(null); setAnswer(null); }}>{message("nativeDesktop.task.new")}</button><div className="sidebar-section-label tasks-label">{message("nativeDesktop.task.section")}<button className="text-icon" disabled={controlsBusy} onClick={() => run("refreshing", () => refresh())} title={message("nativeDesktop.workspace.refreshTasks")} aria-label={message("nativeDesktop.workspace.refreshTasks")}>↻</button></div>
        <div className="task-list">{view.tasks.length === 0 && <p className="quiet-list">{message("nativeDesktop.workspace.empty")}</p>}{view.tasks.map(item => <button key={item.handle} className={`task-item ${selected === item.handle ? "active" : ""}`} disabled={controlsBusy} onClick={() => setSelected(item.handle)}>
          <span className="task-item-top"><span className="task-mini-icon">◈</span><span className="task-item-title">{item.question}</span></span>
          <span className="task-item-foot"><span>{item.mode.toUpperCase()}</span><span>{stageLabel[item.status.stage] ?? item.status.stage}</span></span>
        </button>)}</div>
        <div className="sidebar-bottom"><span className="status-dot"/>{message("nativeDesktop.workspace.localTasks")}<span className="muted">{message("nativeDesktop.workspace.localBoundary")}</span></div></>}
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">{message("nativeDesktop.breadcrumb.mint")}<span>/</span>{message("nativeDesktop.breadcrumb.operator")}<span>/</span> {task ? message("nativeDesktop.breadcrumb.task") : message("nativeDesktop.breadcrumb.desk")}</div><span className="network-pill"><span className="status-dot"/> {task ? taskLabel : preparedLabel}</span></header>
      <div className="content">
        {controlsBusy && <div className="activity" role="status">{busy ? busyLabel[busy] : message("nativeDesktop.busy.savedResult")}</div>}
        {error && <div role="alert" className="alert error"><strong>{message("nativeDesktop.action.failed")}</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        {!ready ? <div className="loading-state" role="status">{message("nativeDesktop.desk.opening")}</div> : !view ? <div className="empty-hero"><div className="hero-orbit"><MintMark large/></div><span className="eyebrow">{message("nativeDesktop.onboarding.eyebrow")}</span><h1>{message("nativeDesktop.onboarding.title")}</h1><p>{message("nativeDesktop.onboarding.introduction")}</p><div className="hero-actions"><button className="primary" disabled={controlsBusy} onClick={() => run("creating", async () => { const next = await window.keryxDesktop.createWorkspace(); if (next) { setView(next); setNotice(next.creationState === "windows_visible_entry_unproven" ? message("nativeDesktop.workspace.createdVisible") : message("nativeDesktop.workspace.created")); } })}>{message("nativeDesktop.workspace.create")}<span>→</span></button><button className="secondary" disabled={controlsBusy} onClick={() => run("opening", async () => { const next = await window.keryxDesktop.chooseWorkspace(); if (next) { setView(next); setSelected(next.tasks[0]?.handle ?? null); } })}>{message("nativeDesktop.workspace.openExisting")}</button></div><p className="hero-footnote">{message("nativeDesktop.onboarding.boundary")}</p></div> : <>
          <div className="page-heading"><div><span className="eyebrow">{message("nativeDesktop.desk.eyebrow")}</span><h1>{task ? message("nativeDesktop.task.title") : message("nativeDesktop.desk.title")}</h1><p>{task ? message("nativeDesktop.task.introduction") : message("nativeDesktop.desk.introduction")}</p></div><button className="secondary refresh" disabled={controlsBusy} onClick={() => run("refreshing", () => refresh())}>{message("nativeDesktop.workspace.refresh")}</button></div>
          {task ? <section className="panel task-detail"><div className="panel-heading"><div><span className="eyebrow">{message("nativeDesktop.task.createdAt", { mode: task.mode.toUpperCase(), date: clock(task.createdAt) })}</span><h2>{task.question}</h2></div><span className="stage-pill">{stageLabel[task.status.stage] ?? task.status.stage}</span></div>
            <div className="detail-grid"><div><span>{message("nativeDesktop.task.creatorBudget")}</span><strong>{money(task.status.creatorBudgetMicros)}</strong></div><div><span>{message("nativeDesktop.task.totalCap")}</span><strong>{money(task.status.maxTotalMicros)}</strong></div><div><span>{message("nativeDesktop.task.payment")}</span><strong>{message("nativeDesktop.task.unknown")}</strong></div><div><span>{message("nativeDesktop.task.delivery")}</span><strong>{message("nativeDesktop.task.unknown")}</strong></div></div>
            <div className="pinned-payee"><span className="eyebrow">{message("nativeDesktop.task.pinnedSeller")}</span><code>{task.payee}</code></div>
            {task.status.lastObservation && <div className="observation"><div><span className="eyebrow">{message("nativeDesktop.task.lastObservation")}</span><strong>{task.status.lastObservation.status.replaceAll("_", " ")}</strong><small>{message("nativeDesktop.task.lastChecked", { date: clock(task.status.lastObservation.observedAt), payment: task.status.lastObservation.payment.replaceAll("_", " ") })}</small></div><p>{message("nativeDesktop.task.sellerReportedBoundary")}</p></div>}
            {currentSavedResult && <div className="answer"><span className="eyebrow">{lastCheck?.handle === task.handle && lastCheck.status !== "saved" ? message("nativeDesktop.savedResult.previous") : message("nativeDesktop.savedResult.current")}</span><p>{currentSavedResult.value.answer}</p>{currentSavedResult.value.citations.length > 0 && <div className="saved-citations"><strong>{presentation.citations}</strong>{currentSavedResult.value.citations.map((citation, index) => <div key={`${citation.marker}-${index}`}>{citation.marker} {citation.sourceName}</div>)}</div>}<small>{message("nativeDesktop.savedResult.verification", { date: clock(currentSavedResult.value.savedAt) })}</small></div>}
            {task.status.savedResult === "invalid" && <div className="inline-warning">{message("nativeDesktop.savedResult.invalid")}</div>}
            {answer?.handle === task.handle && <div className="answer"><span className="eyebrow">{presentation.unsavedAnswer}</span><p>{answer.text}</p><small>{message(answer.truncated ? "nativeDesktop.unsavedResult.truncatedBoundary" : "nativeDesktop.unsavedResult.boundary")}</small></div>}
            {task.status.stage === "journal_incomplete" && <div className="inline-warning">{message("nativeDesktop.task.incompleteBoundary")}</div>}
            <div className="task-actions"><button className="primary" disabled={controlsBusy || task.status.stage !== "buyer_journaled"} onClick={() => run("resuming", async () => { const result = await window.keryxDesktop.resumeTask(task.handle); const checkState = result.localResult.state === "saved" ? "saved" : result.answer ? "unsaved" : "incomplete"; setLastCheck({ handle: task.handle, status: checkState }); setAnswer(checkState === "unsaved" && result.answer ? { handle: task.handle, text: result.answer, truncated: result.answerTruncated } : null); if (checkState === "saved") setSavedResult(null); await refresh(); if (result.localResult.state === "save_failed") setError(result.localResult.message ?? message("nativeDesktop.savedResult.saveFailed")); else if (result.localObservation === "save_failed") setError(message("nativeDesktop.task.observationSaveFailed")); else setNotice(message("nativeDesktop.task.checked")); })}>{message("nativeDesktop.task.checkOriginal")}</button><button className="secondary" disabled={controlsBusy || !currentSavedResult} onClick={() => run("brief", async () => { if (await window.keryxDesktop.exportBrief(task.handle)) setNotice(message("nativeDesktop.exports.briefSaved")); })}>{message("nativeDesktop.exports.brief")}</button>{(["bibtex", "ris", "csl-json", "evidence-csv"] as const).map(format => <button key={format} className="secondary" disabled={controlsBusy || !currentSavedResult} onClick={() => run("brief", async () => { if (await window.keryxDesktop.exportBrief(task.handle, format)) setNotice(message("nativeDesktop.exports.saved", { format })); })}>{exportLabel[format]}</button>)}{checkedBibliographyExportCopy.map(choice => <button key={choice.format} className="secondary" disabled={controlsBusy || !currentSavedResult} onClick={() => run("brief", async () => { if (await window.keryxDesktop.exportBrief(task.handle, choice.format)) setNotice(choice.notice); })}>{choice.label}</button>)}<button className="secondary" disabled={controlsBusy} onClick={() => run("exporting", async () => { if (await window.keryxDesktop.exportTask(task.handle)) setNotice(message("nativeDesktop.exports.statusSaved")); })}>{message("nativeDesktop.exports.status")}</button></div>
            <details className="handoff"><summary>{message("nativeDesktop.handoff.title")}</summary><p>{message("nativeDesktop.handoff.boundary")}</p><div className="payee"><span>{message("nativeDesktop.handoff.payee")}</span><code>{task.payee}</code></div><pre>{buyerCommand}</pre></details>
          </section> : <section className="panel create-panel"><div className="panel-heading"><div><span className="eyebrow">{message("nativeDesktop.task.prepareEyebrow")}</span><h2>{message("nativeDesktop.task.prepareTitle")}</h2><p>{message("nativeDesktop.task.prepareBoundary")}</p></div><div className="panel-symbol">✦</div></div>
            <form onSubmit={event => { event.preventDefault(); run("saving", async () => { const created = await window.keryxDesktop.createTask(form); try { await refresh(created.handle); }
              catch { throw new Error(message("nativeDesktop.task.createdRefreshFailed", { path: `${view.path}\\${created.directoryName}` })); }
              setForm(initialForm); setNotice(created.publicationState === "windows_visible_entry_unproven" ? message("nativeDesktop.task.createdVisible") : message("nativeDesktop.task.created")); }); }}>
              <label className="field full">{message("nativeDesktop.task.question")}<textarea required maxLength={2000} rows={3} placeholder={message("nativeDesktop.task.questionPlaceholder")} value={form.question} onChange={event => patch("question", event.target.value)}/></label>
              <label className="field full network-field">{message("nativeDesktop.task.network")}<select value={form.network ?? "arc"} onChange={event => patch("network", event.target.value as "arc" | "arcTestnet")}><option value="arc">{message("nativeDesktop.network.mainnet")}</option><option value="arcTestnet">{message("nativeDesktop.network.testnet")}</option></select><small>{message("nativeDesktop.task.networkBoundary")}</small></label>
              <fieldset className="mode-field"><legend>{message("nativeDesktop.task.depth")}</legend><div className="mode-options"><label className={form.mode === "quick" ? "mode-option selected" : "mode-option"}><input type="radio" name="mode" value="quick" checked={form.mode === "quick"} onChange={() => patch("mode", "quick")}/><span><strong>{message("nativeDesktop.task.quick")}</strong><small>{message("nativeDesktop.task.quickHint")}</small></span></label><label className={form.mode === "deep" ? "mode-option selected" : "mode-option"}><input type="radio" name="mode" value="deep" checked={form.mode === "deep"} onChange={() => patch("mode", "deep")}/><span><strong>{message("nativeDesktop.task.deep")}</strong><small>{message("nativeDesktop.task.deepHint")}</small></span></label></div></fieldset>
              <div className="form-grid"><label className="field">{message("nativeDesktop.task.creatorBudgetField")}<input required inputMode="decimal" value={form.creatorBudget} onChange={event => patch("creatorBudget", event.target.value)} /></label><label className="field">{message("nativeDesktop.task.totalCapField")}<input required inputMode="decimal" value={form.totalCap} onChange={event => patch("totalCap", event.target.value)}/></label></div>
              <label className="field payee-field">{message("nativeDesktop.task.payeeField")}<input required spellCheck={false} placeholder={message("nativeDesktop.task.payeePlaceholder")} value={form.payee} onChange={event => patch("payee", event.target.value)}/><small>{message("nativeDesktop.task.payeeHint")}</small></label>
              <div className="form-footer"><span>{message("nativeDesktop.task.capBoundary", { network: preparedLabel })}</span><button className="primary" disabled={controlsBusy}>{message("nativeDesktop.task.save")}<span>→</span></button></div>
            </form>
          </section>}
          <div className="summary-grid"><div className="summary-card"><span>{message("nativeDesktop.summary.tasks")}</span><strong>{view.tasks.length}</strong><small>{message("nativeDesktop.summary.tasksHint")}</small></div><div className="summary-card"><span>{message("nativeDesktop.summary.references")}</span><strong>{view.references.length}</strong><small>{message("nativeDesktop.summary.referencesHint")}</small></div><div className="summary-card"><span>{message("nativeDesktop.summary.network")}</span><strong className="summary-network">{message("nativeDesktop.summary.networkValue")}</strong><small>{message("nativeDesktop.summary.networkHint")}</small></div></div>
          <section className="panel library"><div className="panel-heading"><div><span className="eyebrow">{message("nativeDesktop.reference.eyebrow")}</span><h2>{message("nativeDesktop.reference.title")}</h2><p>{message("nativeDesktop.reference.boundary")}</p></div><button className="secondary" disabled={controlsBusy} onClick={() => run("importing", async () => { if (await window.keryxDesktop.importReference()) { await refresh(); setNotice(message("nativeDesktop.reference.importedNotice")); } })}>{message("nativeDesktop.reference.import")}</button></div>
            {view.references.length ? <div className="reference-list">{view.references.map(ref => <div key={ref.handle} className="reference-row"><span className="file-icon">▤</span><div><strong>{ref.name}</strong><small>{message("nativeDesktop.reference.imported", { date: clock(ref.importedAt), bytes: formatNumber(ref.bytes) })}</small><code>{message("nativeDesktop.reference.checksum", { sha256: ref.sha256 })}</code></div></div>)}</div> : <div className="library-empty">{message("nativeDesktop.reference.empty")}</div>}
          </section>
    {view.invalidDirectories > 0 && <p className="unrecognized">{message(selectPlural(view.invalidDirectories) === "one" ? "nativeDesktop.workspace.unrecognized.one" : "nativeDesktop.workspace.unrecognized.other", { count: view.invalidDirectories })}</p>}
        </>}
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
