import { invoke } from "@tauri-apps/api/core";
import type { DesktopAPI } from "./contracts";

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const raw = await invoke<string>(command, args);
  return JSON.parse(raw) as T;
}

const api: DesktopAPI = {
  chooseWorkspace: () => call("choose_workspace"),
  createWorkspace: () => call("create_workspace"),
  refresh: () => call("refresh"),
  createTask: (input) => call("create_task", { input: JSON.stringify(input) }),
  resumeTask: (handle) => call("resume_task", { handle }),
  readResult: (handle) => call("read_result", { handle }),
  exportBrief: (handle) => call("export_brief", { handle }),
  exportTask: (handle) => call("export_task", { handle }),
  importReference: () => call("import_reference"),
};

window.keryxDesktop = api;

declare global { interface Window { keryxDesktop: DesktopAPI } }
