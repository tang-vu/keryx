export type TaskRow = {
  handle: string; directoryName: string; question: string; mode: "quick" | "deep"; payee: string; createdAt: string;
  status: Awaited<ReturnType<typeof import("../../lib/operator/task").operatorTaskStatus>>;
};
export type CreationState = "unix_synced" | "windows_visible_entry_unproven";
export type CreatedTaskRow = TaskRow & { publicationState: CreationState };
export type ReferenceRow = { handle: string; name: string; importedAt: string; bytes: number; sha256: string };
export type WorkspaceView = { name: string; path: string; tasks: TaskRow[]; references: ReferenceRow[]; invalidDirectories: number;
  creationState?: CreationState };
export type CreateInput = { question: string; mode: "quick" | "deep"; creatorBudget: string; payee: string; totalCap: string };
export type SavedResult = NonNullable<Awaited<ReturnType<typeof import("../../lib/operator/task").readOperatorResult>>>;
export type DesktopAPI = {
  chooseWorkspace(): Promise<WorkspaceView | null>;
  createWorkspace(): Promise<WorkspaceView | null>;
  refresh(): Promise<WorkspaceView | null>;
  createTask(input: CreateInput): Promise<CreatedTaskRow>;
  resumeTask(handle: string): Promise<{ task: TaskRow; answer: string | null; answerTruncated: boolean; localResult: { state: string; message?: string }; localObservation: "saved" | "save_failed" }>;
  readResult(handle: string): Promise<SavedResult | null>;
  exportBrief(handle: string): Promise<boolean>;
  exportTask(handle: string): Promise<boolean>;
  importReference(): Promise<ReferenceRow | null>;
};
