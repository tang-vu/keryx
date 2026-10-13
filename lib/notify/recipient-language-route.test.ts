import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), source: vi.fn(), notify: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
import { GET, POST } from "../../app/api/creator/[id]/notify/language/route";
const ctx = { params: Promise.resolve({ id: "source-a" }) };
const recipient = { email: "creator@example.org", unsubToken: "a".repeat(64) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ address: "0x" + "a".repeat(40) });
  mocks.source.mockResolvedValue({ walletAddress: "0x" + "a".repeat(40), authors: [] });
  mocks.notify.mockResolvedValue(recipient); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined);
  mocks.db.mockResolvedValue({ getSource: mocks.source, getSourceNotifyEmail: mocks.notify, getSyncState: mocks.read, setSyncState: mocks.write });
});
const request = (body: unknown) => new NextRequest("https://isolated.invalid/api/creator/source-a/notify/language", { method: "POST", body: JSON.stringify(body) });
it("refuses missing/wrong ownership before reading recipient state", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(request({}), ctx)).status).toBe(401); expect(mocks.db).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ address: "0x" + "b".repeat(40) });
  expect((await POST(request({ language: "vi" }), ctx)).status).toBe(403);
  expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
});
it("validates the closed input before writes and refuses absent email configuration", async () => {
  for (const body of [{ language: "fr" }, { language: "vi", email: "other@example.org" }, [], null])
    expect((await POST(request(body), ctx)).status).toBe(400);
  expect(mocks.write).not.toHaveBeenCalled();
  mocks.notify.mockResolvedValue(null);
  expect((await POST(request({ language: "vi" }), ctx)).status).toBe(409);
});
it("confirms saves by readback and returns no recipient, token or private storage key", async () => {
  mocks.read.mockResolvedValue("vi");
  const response = await POST(request({ language: "vi" }), ctx);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ language: "vi", available: true });
  expect(mocks.write).toHaveBeenCalledOnce();
  mocks.read.mockResolvedValue(null);
  expect((await POST(request({ language: "es" }), ctx)).status).toBe(503);
});
it("does not report the old recipient's save as a preference for a concurrent replacement", async () => {
  mocks.read.mockResolvedValue("vi");
  mocks.notify.mockResolvedValueOnce(recipient).mockResolvedValueOnce({ ...recipient, unsubToken: "b".repeat(64) });
  const response = await POST(request({ language: "vi" }), ctx);
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "notification_recipient_changed" });
});
