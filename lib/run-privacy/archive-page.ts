import type { ArchiveEntry } from "../answers-archive";

/** Includes ineligible candidates so the original window and keyset stay exact. */
export interface PublicArchiveRow {
  id: string;
  createdAt: string;
  entry: ArchiveEntry | null;
}
