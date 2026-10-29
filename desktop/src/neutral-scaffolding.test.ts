import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeDesktopMessages } from "../../locales/en/native-desktop";
import { clientPresentationLanguage } from "../../shared/i18n/client-language";
import { desktopNeutralCatalogues, desktopNeutralMessages, type DesktopNeutralKey } from "../../shared/i18n/desktop-neutral";
import type { DesktopAPI, TaskRow, WorkspaceView } from "./contracts";

const locales = ["en", "vi", "pt", "es", "fr"] as const;
const keys = Object.keys(desktopNeutralCatalogues.en) as DesktopNeutralKey[];
const samples = [
  ["en", "Open workspace", "RESEARCH DESK", "Research question", "RESEARCH DEPTH", "Reference snapshots"],
  ["vi", "Mở không gian làm việc", "BÀN NGHIÊN CỨU", "Câu hỏi nghiên cứu", "ĐỘ SÂU NGHIÊN CỨU", "Bản chụp tài liệu tham khảo"],
  ["pt", "Abrir espaço de trabalho", "MESA DE PESQUISA", "Pergunta de pesquisa", "PROFUNDIDADE DA PESQUISA", "Cópias de referências"],
  ["es", "Abrir espacio de trabajo", "MESA DE INVESTIGACIÓN", "Pregunta de investigación", "PROFUNDIDAD DE LA INVESTIGACIÓN", "Copias de referencias"],
  ["fr", "Ouvrir un espace de travail", "BUREAU DE RECHERCHE", "Question de recherche", "PROFONDEUR DE RECHERCHE", "Copies des références"],
] as const;

describe("bounded neutral Desktop catalogue", () => {
  it("preserves every canonical English label, including spacing and symbols", () => {
    expect(keys).toHaveLength(19);
    for (const key of keys) expect(desktopNeutralMessages("en")(key)).toBe(nativeDesktopMessages[key]);
    expect(desktopNeutralMessages("en")("nativeDesktop.workspace.create")).toBe("Create workspace ");
    expect(desktopNeutralMessages("en")("nativeDesktop.task.section")).toBe("02 / RESEARCH TASKS ");
  });

  it.each(samples)("selects %s workspace, navigation, question, depth and library copy", (language, open, desk, question, depth, library) => {
    const message = desktopNeutralMessages(language);
    expect(message("nativeDesktop.workspace.open")).toBe(open);
    expect(message("nativeDesktop.breadcrumb.desk")).toBe(desk);
    expect(message("nativeDesktop.task.question")).toBe(question);
    expect(message("nativeDesktop.task.depth")).toBe(depth);
    expect(message("nativeDesktop.reference.title")).toBe(library);
  });

  it.each(locales)("keeps %s complete, immutable and outside critical copy", language => {
    const catalogue = desktopNeutralCatalogues[language];
    expect(Object.isFrozen(desktopNeutralCatalogues)).toBe(true);
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(Object.keys(catalogue).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(desktopNeutralMessages(language)(key).trim().length).toBeGreaterThan(0);
      if (language !== "en") expect(catalogue[key]).not.toBe(desktopNeutralCatalogues.en[key]);
    }
    for (const key of [
      "nativeDesktop.workspace.section", "nativeDesktop.workspace.chooseFolder",
      "nativeDesktop.task.prepareBoundary", "nativeDesktop.task.creatorBudget",
      "nativeDesktop.task.quick", "nativeDesktop.task.deep", "nativeDesktop.stage.ready",
      "nativeDesktop.savedResult.verification", "nativeDesktop.handoff.boundary",
      "nativeDesktop.reference.boundary", "constructor", "__proto__",
    ]) expect(() => desktopNeutralMessages(language)(key as DesktopNeutralKey)).toThrow("Unknown neutral Desktop message");
  });
});

// Keep React, its state updates and the real renderer. Only capture the real root
// for cleanup; no provider, native bridge, task handler or external service runs.
const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock("react-dom/client", async importOriginal => {
  const original = await importOriginal<typeof import("react-dom/client")>();
  return { ...original, createRoot: (...args: Parameters<typeof original.createRoot>) => {
    const root = original.createRoot(...args);
    mounted.root = root;
    return root;
  } };
});

describe("real Desktop neutral renderer binding", () => {
  let dom: JSDOM;
  const originalText = "Original café “x402 / USDC” [S99] {question} $&";
  const workspace: WorkspaceView = {
    name: originalText, path: "C:\\private\\original", tasks: [], invalidDirectories: 0,
    references: [{ handle: "reference-original", name: originalText, importedAt: "2026-10-15T00:00:00.000Z", bytes: 31, sha256: "ab".repeat(32) }],
  };
  let api: DesktopAPI;

  beforeEach(() => {
    vi.resetModules();
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
    Object.defineProperty(dom.window.navigator, "language", { configurable: true, value: "vi-VN" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    api = {
      researchSponsored: vi.fn(async () => { throw new Error("Unexpected public research"); }),
      refresh: vi.fn(async () => workspace),
      chooseWorkspace: vi.fn(async () => null), createWorkspace: vi.fn(async () => null),
      createTask: vi.fn(async () => { throw new Error("Unexpected task creation"); }),
      resumeTask: vi.fn(async () => { throw new Error("Unexpected original-job check"); }),
      readResult: vi.fn(async () => null), exportBrief: vi.fn(async () => false),
      exportTask: vi.fn(async () => false), importReference: vi.fn(async () => null),
    };
    (dom.window as unknown as Window).keryxDesktop = api;
  });

  afterEach(async () => {
    await act(async () => { mounted.root?.unmount(); });
    mounted.root = null;
    dom.window.close();
    vi.unstubAllGlobals();
  });

  async function openRenderer() {
    await act(async () => { await import("./renderer"); });
  }

  async function overrideLanguage(language: string) {
    const selector = dom.window.document.querySelector<HTMLSelectElement>("select[aria-label]")!;
    await act(async () => {
      selector.value = language;
      selector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  }

  function expectLabel(key: DesktopNeutralKey, selector: string, language: typeof locales[number]) {
    expect(dom.window.document.querySelector(selector)?.textContent).toContain(desktopNeutralMessages(language)(key));
  }

  it.each(locales)("uses the existing selector for actual %s workspace, form and library labels", async language => {
    const before = JSON.stringify(workspace);
    await openRenderer();
    // Existing auto/system selection is used before changing the existing override.
    expectLabel("nativeDesktop.workspace.open", ".sidebar-actions button", clientPresentationLanguage("vi-VN"));
    await overrideLanguage(language);
    const languageSelector = dom.window.document.querySelector<HTMLSelectElement>("select[aria-label]")!;
    expect(languageSelector.closest("label")?.getAttribute("lang")).toBe(language);
    expect(languageSelector.querySelector(`option[value="${language}"]`)?.getAttribute("lang")).toBe(language);
    for (const [key, selector] of [
      ["nativeDesktop.workspace.open", ".sidebar-actions button:first-child"],
      ["nativeDesktop.workspace.new", ".sidebar-actions button:last-child"],
      ["nativeDesktop.task.new", ".new-task-button"],
      ["nativeDesktop.task.section", ".tasks-label"],
      ["nativeDesktop.breadcrumb.desk", ".breadcrumb"],
      ["nativeDesktop.desk.title", "h1"],
      ["nativeDesktop.workspace.refresh", ".page-heading button"],
      ["nativeDesktop.task.question", "label.field.full"],
      ["nativeDesktop.task.depth", "legend"],
      ["nativeDesktop.reference.eyebrow", ".library .eyebrow"],
      ["nativeDesktop.reference.title", ".library h2"],
      ["nativeDesktop.reference.import", ".library button"],
    ] as const) expectLabel(key, selector, language);
    const refresh = dom.window.document.querySelector(".tasks-label button")!;
    expect(refresh.getAttribute("title")).toBe(desktopNeutralMessages(language)("nativeDesktop.workspace.refreshTasks"));
    expect(refresh.getAttribute("aria-label")).toBe(refresh.getAttribute("title"));
    expect(dom.window.document.querySelector("textarea")?.getAttribute("placeholder"))
      .toBe(desktopNeutralMessages(language)("nativeDesktop.task.questionPlaceholder"));
    expect(Array.from(dom.window.document.querySelectorAll<HTMLInputElement>('input[name="mode"]'), input => input.value)).toEqual(["quick", "deep"]);
    expect(dom.window.document.querySelector<HTMLInputElement>('input[name="mode"][value="quick"]')?.checked).toBe(true);
    const text = dom.window.document.body.textContent!;
    for (const key of ["nativeDesktop.task.prepareBoundary", "nativeDesktop.task.networkBoundary", "nativeDesktop.task.payeeHint", "nativeDesktop.reference.boundary"] as const)
      expect(text).toContain(nativeDesktopMessages[key]);
    expect(text).toContain("Quick");
    expect(text).toContain("Deep");
    expect(text).toContain(originalText);
    expect(text).toContain(`SHA-256 ${workspace.references[0].sha256}`);
    expect(JSON.stringify(workspace)).toBe(before);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    for (const [name, call] of Object.entries(api)) if (name !== "refresh") expect(call).not.toHaveBeenCalled();
    await overrideLanguage("auto");
    expectLabel("nativeDesktop.workspace.open", ".sidebar-actions button", "vi");
  });

  it.each(locales)("binds %s onboarding controls while retaining the English boundary", async language => {
    vi.mocked(api.refresh).mockResolvedValue(null);
    await openRenderer();
    await overrideLanguage(language);
    expectLabel("nativeDesktop.workspace.none", ".workspace-copy strong", language);
    expectLabel("nativeDesktop.workspace.create", ".hero-actions .primary", language);
    expectLabel("nativeDesktop.workspace.openExisting", ".hero-actions .secondary", language);
    expect(dom.window.document.querySelector(".hero-footnote")?.textContent).toBe(nativeDesktopMessages["nativeDesktop.onboarding.boundary"]);
    expect(api.createWorkspace).not.toHaveBeenCalled();
    expect(api.chooseWorkspace).not.toHaveBeenCalled();
  });

  it.each(locales)("binds %s task navigation while preserving question, mode, status and command text", async language => {
    const task: TaskRow = {
      handle: "task-original", directoryName: "task-original", question: originalText,
      mode: "quick", payee: `0x${"12".repeat(20)}`, createdAt: "2026-10-15T00:00:00.000Z",
      status: {
        schema: "keryx-operator-task-status-v1", taskId: "original-task-id",
        createdAt: "2026-10-15T00:00:00.000Z", kind: "paid_research", network: "eip155:5042",
        stage: "ready", buyerJobId: null, creatorBudgetMicros: 10000, maxTotalMicros: "100000",
        payment: "unknown", delivery: "unknown", lastObservation: null, savedResult: "absent",
        authority: "Synthetic local task for presentation only",
      },
    };
    const populated = { ...workspace, tasks: [task] };
    const before = JSON.stringify(populated);
    vi.mocked(api.refresh).mockResolvedValue(populated);
    await openRenderer();
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>(".task-item")!.click(); });
    const command = dom.window.document.querySelector(".handoff pre")!.textContent;
    const amounts = dom.window.document.querySelector(".detail-grid")!.textContent;
    await overrideLanguage(language);
    expectLabel("nativeDesktop.breadcrumb.task", ".breadcrumb", language);
    expectLabel("nativeDesktop.task.title", "h1", language);
    expect(dom.window.document.querySelector(".task-detail h2")?.textContent).toBe(originalText);
    expect(dom.window.document.querySelector(".task-item-title")?.textContent).toBe(originalText);
    expect(dom.window.document.querySelector(".task-item-foot")?.textContent).toBe("QUICKReady to purchase");
    expect(dom.window.document.querySelector(".stage-pill")?.textContent).toBe("Ready to purchase");
    expect(dom.window.document.querySelector(".detail-grid")?.textContent).toBe(amounts);
    expect(command).toContain("npm run buyer -- buy --request");
    expect(command).toContain("--max-total 0.100000");
    expect(dom.window.document.querySelector(".handoff pre")?.textContent).toBe(command);
    expect(dom.window.document.querySelector(".handoff p")?.textContent).toBe(nativeDesktopMessages["nativeDesktop.handoff.boundary"]);
    expect(JSON.stringify(populated)).toBe(before);
    expect(api.resumeTask).not.toHaveBeenCalled();
    expect(api.readResult).not.toHaveBeenCalled();
  });
});
