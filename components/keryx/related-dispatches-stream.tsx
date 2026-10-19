import { relatedAnswers } from "@/lib/answers-archive";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { RelatedDispatches } from "./related-dispatches";

/** Keep the archive's fresh publication checks inside this optional server
 * boundary. A slow scan must not delay an already-authorized saved report. */
export async function RelatedDispatchesStream({ current }: {
  current: Parameters<typeof relatedAnswers>[0];
}) {
  const entries = relatedAnswers(current, await getArchiveCached());
  return <RelatedDispatches entries={entries} />;
}
