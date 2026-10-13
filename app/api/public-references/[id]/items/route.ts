import { GET as browse } from "../../route";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^public:[a-z0-9-]{1,80}$/.test(id)) return Response.json({ error: "Invalid public publisher ID" }, { status: 400 });
  const url = new URL(request.url);
  url.searchParams.set("referenceId", id);
  return browse(new Request(url, { method: "GET", headers: request.headers }));
}
