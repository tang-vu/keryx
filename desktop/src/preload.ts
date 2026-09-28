import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "./contracts";

const api: DesktopAPI = {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:open"),
  createWorkspace: () => ipcRenderer.invoke("workspace:create"),
  refresh: () => ipcRenderer.invoke("workspace:refresh"),
  createTask: (input) => ipcRenderer.invoke("task:create", input),
  resumeTask: (handle) => ipcRenderer.invoke("task:resume", handle),
  readResult: (handle) => ipcRenderer.invoke("task:result", handle),
  exportBrief: (handle) => ipcRenderer.invoke("task:brief", handle),
  exportTask: (handle) => ipcRenderer.invoke("task:export", handle),
  importReference: () => ipcRenderer.invoke("reference:import"),
};
contextBridge.exposeInMainWorld("keryxDesktop", api);
