// Helper error text keeps the outcome and recovery instruction ahead of any interpolated path
// or detail. The Rust peer rejects a wire error over MAX_ERROR_BYTES UTF-8 bytes after JSON
// decoding (see helper-protocol.ts), and boundErrorMessage keeps only a leading prefix: guidance
// placed first survives truncation of a long workspace or export path.
export function workspaceCreatedSelectionFailed(path: string): Error {
  return new Error("Workspace was created, but the selection could not be saved. " +
    `Do not create a replacement yet; reopen the created folder at ${path}`);
}
