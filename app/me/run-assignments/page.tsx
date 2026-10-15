import { OwnerRunAssignmentInbox } from "@/components/keryx/owner-run-assignment-inbox";
import { ownerRunAssignmentMessages as copy } from "@/locales/en/owner-run-assignments";
export const metadata = { title: "Owner-assigned research | Keryx", robots: { index: false, follow: false } };
export default function RunAssignmentsPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-10"><h1>{copy.title}</h1><OwnerRunAssignmentInbox /></main>;
}
