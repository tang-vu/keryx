"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Workspace = {
  selection: { id: string; revision: number } | null;
  revision: number;
  select: (id: string | null) => void;
  clearSelection: (expected: NonNullable<Workspace["selection"]>) => void;
  refresh: () => void;
};
const Context = createContext<Workspace | null>(null);

export function ResearchWorkspace({ children }: { children: ReactNode }) {
  const [{ selection, revision }, setWorkspace] = useState<Pick<Workspace, "selection" | "revision">>({ selection: null, revision: 0 });
  return <Context.Provider value={{ selection, revision,
    select: id => setWorkspace(previous => {
      const revision = previous.revision + 1;
      return { selection: id ? { id, revision } : null, revision };
    }),
    clearSelection: expected => {
      // A local removal may finish after the user opens another view of the same job.
      setWorkspace(previous => ({ selection: previous.selection === expected ? null : previous.selection, revision: previous.revision + 1 }));
    },
    refresh: () => setWorkspace(previous => ({ ...previous, revision: previous.revision + 1 })),
  }}>{children}</Context.Provider>;
}

export function useResearchWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Research workspace is missing");
  return value;
}
