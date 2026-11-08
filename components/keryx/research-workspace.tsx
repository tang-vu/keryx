"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Workspace = {
  selection: { id: string; revision: number } | null;
  revision: number;
  importSelection: symbol | null;
  select: (id: string | null) => void;
  beginImport: () => symbol;
  completeImport: (id: string, expected: symbol) => void;
  clearSelection: (expected: NonNullable<Workspace["selection"]>) => void;
  refresh: () => void;
};
const Context = createContext<Workspace | null>(null);

export function ResearchWorkspace({ children }: { children: ReactNode }) {
  const [{ selection, revision, importSelection }, setWorkspace] = useState<Pick<Workspace, "selection" | "revision" | "importSelection">>({ selection: null, revision: 0, importSelection: null });
  return <Context.Provider value={{ selection, revision, importSelection,
    select: id => setWorkspace(previous => {
      const revision = previous.revision + 1;
      return { selection: id ? { id, revision } : null, revision, importSelection: null };
    }),
    beginImport: () => {
      const expected = Symbol("saved-research-import");
      setWorkspace(previous => ({ ...previous, importSelection: expected }));
      return expected;
    },
    completeImport: (id, expected) => setWorkspace(previous => {
      const revision = previous.revision + 1;
      // Every committed import refreshes the list. Only the latest import intent
      // may open a view; a later explicit selection or close revokes that intent.
      return previous.importSelection === expected
        ? { selection: { id, revision }, revision, importSelection: null }
        : { ...previous, revision };
    }),
    clearSelection: expected => {
      // A local removal may finish after the user opens another view of the same job.
      setWorkspace(previous => ({ ...previous, selection: previous.selection === expected ? null : previous.selection, revision: previous.revision + 1 }));
    },
    refresh: () => setWorkspace(previous => ({ ...previous, revision: previous.revision + 1 })),
  }}>{children}</Context.Provider>;
}

export function useResearchWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Research workspace is missing");
  return value;
}
