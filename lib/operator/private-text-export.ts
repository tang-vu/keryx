import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type PrivateTextExportFile = {
  writeFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
};

export type PrivateTextExportFs = {
  open(path: string, flags: "wx", mode: number): Promise<PrivateTextExportFile>;
  link(existing: string, target: string): Promise<void>;
  unlink(path: string): Promise<void>;
};

const nodeFs: PrivateTextExportFs = { open, link, unlink };

type Step = "create staging file" | "write staging file" | "sync staging file" |
  "close staging file" | "publish final file" | "remove staging file";
type Publication = "not-published" | "unconfirmed" | "published";

export class PrivateTextExportError extends Error {
  constructor(
    readonly publication: Publication,
    readonly step: Step,
    readonly finalPath: string,
    readonly stagingPath: string | null,
    readonly stagingRemains: boolean,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const state = publication === "published"
      ? "complete final file was published; staging cleanup failed"
      : publication === "unconfirmed"
        ? "publication outcome is unconfirmed; inspect the final path before retrying"
        : "failed before publishing this attempt";
    const staging = stagingPath ? ` staging=${JSON.stringify(stagingPath)}` : "";
    const leftover = stagingRemains ? " Inspect and remove the owned staging file after checking it." : "";
    super(`Private export ${state} at ${step}; final=${JSON.stringify(finalPath)}${staging}: ${detail}.${leftover}`);
    this.name = "PrivateTextExportError";
  }
}

/** Publish complete private text without ever writing into the final pathname. */
export async function publishPrivateText(
  output: string,
  text: string,
  fs: PrivateTextExportFs = nodeFs,
): Promise<{ saved: string; private: true }> {
  const finalPath = resolve(output);
  const stagingPath = join(dirname(finalPath), `.keryx-brief-${randomUUID()}.tmp`);
  let file: PrivateTextExportFile;
  try {
    file = await fs.open(stagingPath, "wx", 0o600);
  } catch (error) {
    throw new PrivateTextExportError("not-published", "create staging file", finalPath, stagingPath, false, error);
  }

  let failure: { step: Step; error: unknown } | undefined;
  try {
    await file.writeFile(text);
  } catch (error) {
    failure = { step: "write staging file", error };
  }
  if (!failure) {
    try {
      await file.sync();
    } catch (error) {
      failure = { step: "sync staging file", error };
    }
  }
  try {
    await file.close();
  } catch (error) {
    failure ??= { step: "close staging file", error };
  }
  if (!failure) {
    try {
      await fs.link(stagingPath, finalPath);
    } catch (error) {
      failure = { step: "publish final file", error };
    }
  }
  if (failure) {
    let stagingRemains = false;
    try { await fs.unlink(stagingPath); }
    catch { stagingRemains = true; }
    const publication = failure.step === "publish final file" ? "unconfirmed" : "not-published";
    throw new PrivateTextExportError(publication, failure.step, finalPath, stagingPath, stagingRemains, failure.error);
  }

  try {
    await fs.unlink(stagingPath);
  } catch (error) {
    throw new PrivateTextExportError("published", "remove staging file", finalPath, stagingPath, true, error);
  }
  return { saved: finalPath, private: true };
}
