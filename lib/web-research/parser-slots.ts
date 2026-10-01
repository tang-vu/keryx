// Route bundles can contain separate copies of this module. A process-global symbol preserves
// admission across those copies, while distinct server processes remain a documented boundary.
const key = Symbol.for("keryx.web-research.parser-slot");
const processState = globalThis as typeof globalThis & { [key]?: { active: boolean } };
const state = processState[key] ??= { active: false };
/** One parser child per server process; no queue or unbounded anonymous waiters. */
export function acquireParserSlot(): () => void {
  if (state.active) throw new Error("Document parser busy");
  state.active = true; let released = false;
  return () => { if (!released) { released = true; state.active = false; } };
}
