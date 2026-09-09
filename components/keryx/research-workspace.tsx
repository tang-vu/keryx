"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Workspace = {
  selection: { id: string; revision: number } | null;
  revision: number;
  select: (id: string | null) => void;
  refresh: () => void;
};
const Context = createContext<Workspace | null>(null);

export function ResearchWorkspace({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Workspace["selection"]>(null);
  const [revision, setRevision] = useState(0);
  return <Context.Provider value={{ selection, revision,
    select: id => { setSelection(previous => id ? { id, revision: (previous?.revision ?? 0) + 1 } : null); setRevision(value => value + 1); },
    refresh: () => setRevision(value => value + 1),
  }}>{children}</Context.Provider>;
}

export function useResearchWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Research workspace is missing");
  return value;
}
