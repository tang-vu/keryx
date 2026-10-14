import { createMountedPrivateJobHistoryRoute } from "@/lib/history/private-job-history-mounted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const route = createMountedPrivateJobHistoryRoute("export");
// Non-POST exports preserve the factory's private 405 response instead of Next's default.
export { route as POST, route as GET, route as HEAD, route as OPTIONS, route as PUT, route as PATCH, route as DELETE };
