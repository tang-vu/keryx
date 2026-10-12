import { beforeEach, expect, it, vi } from "vitest";
import { paidJobAlertChannel } from "./paid-job-alert";
import { operationalAlertChannelsReady, sendAlert } from "./alert";
import { paidJobEscalationQueue } from "../a2a/overdue-escalation-queue";
import { syntheticA2aOriginal } from "../db/a2a-original-fixture";

vi.mock("./alert", () => ({ operationalAlertChannelsReady: vi.fn(), sendAlert: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });

it("uses the existing dedicated ops acknowledgment contract and keeps private original details out of logs", async () => {
  const order = syntheticA2aOriginal().order;
  order.request!.network = "eip155:5042002";
  const queue = await paidJobEscalationQueue({ listUnfinishedA2aOrders: async () => ({ orders: [order], unreadable: 0, truncated: false }),
    listCreatorPaymentAttemptsByQuery: async () => [] }, Date.parse(order.createdAt) + 180_001);
  const channel = paidJobAlertChannel();
  vi.mocked(operationalAlertChannelsReady).mockReturnValue(false);
  expect(channel.ready()).toBe(false);
  vi.mocked(operationalAlertChannelsReady).mockReturnValue(true);
  expect(channel.ready()).toBe(true);
  vi.mocked(sendAlert).mockResolvedValue(true);
  expect(await channel.send({ incidentId: "a".repeat(64), original: queue.overdue[0] })).toBe(true);
  const [title, detail, options] = vi.mocked(sendAlert).mock.calls[0];
  expect(title).toBe("Paid job completion target exceeded");
  expect(detail).toContain(order.id); expect(detail).toContain(order.transaction!);
  expect(detail).toContain("queued"); expect(detail).toContain("eip155:5042002");
  expect(detail).toContain("do not sign, buy, retry or refund automatically");
  expect(detail!.length).toBeLessThan(4000); expect(options).toEqual({ logDetail: false });
});
