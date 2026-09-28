import { publishPrivateText } from "../../lib/operator/private-text-export";

type SaveChoice = { canceled: boolean; filePath?: string };

/** The native dialog chooses the path; publication stays in the shared Operator writer. */
export async function savePrivateExport(
  choose: () => Promise<SaveChoice>,
  text: string,
  publish: typeof publishPrivateText = publishPrivateText,
): Promise<boolean> {
  const choice = await choose();
  if (choice.canceled) return false;
  if (!choice.filePath) throw new Error("Save dialog did not provide a destination");
  await publish(choice.filePath, text);
  return true;
}
