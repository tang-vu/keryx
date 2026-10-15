import { describe, expect, it, vi } from "vitest";
import { discordChatRecipient, slackChatRecipient, telegramChatRecipient } from "./provider-recipient";
import { chatControlReply, chatTokenHash, exactChatControl } from "./service";
import { isTelegramAccountControl, parseAskMessage } from "../telegram/ask-message";
import { isSlackAccountControl, parseSlashCommand } from "../slack/ask-command";
import type { KeryxDB } from "../db/keryx-db";

describe("chat263 private envelopes and reserved controls (source only, UNRUN)", () => {
  it("never sends reserved arguments to research or echoes them", () => {
    for (const command of ["link", "unlink", "whoami"]) {
      for (const suffix of ["", " secret-token", "@Bot secret-token"]) {
        const update = { message: { text: `/${command}${suffix}`, chat: { id: 7, type: "private" }, from: { id: 7 } } };
        expect(isTelegramAccountControl(update)).toBe(true); expect(parseAskMessage(update)).toBeNull();
        if (suffix.includes("secret")) expect(exactChatControl(update.message.text)).toBeNull();
      }
      const params = new URLSearchParams({ command: "/keryx", text: `${command} secret-token` });
      expect(isSlackAccountControl(params)).toBe(true); expect(parseSlashCommand(params)).toBeNull();
    }
  });
  it("requires actual private provider sender envelopes; malformed member never falls back", () => {
    expect(telegramChatRecipient({ message: { chat: { id: 7, type: "private" }, from: { id: 7 } } })).not.toBeNull();
    for (const message of [{ chat: { id: -7, type: "group" }, from: { id: 7 } }, { chat: { id: 7, type: "private" }, from: { id: 8 } },
      { chat: { id: 7, type: "private" }, from: { id: 7, is_bot: true } }]) expect(telegramChatRecipient({ message })).toBeNull();
    expect(slackChatRecipient(new URLSearchParams({ team_id: "T1", user_id: "U1", channel_id: "D1" }))).not.toBeNull();
    expect(slackChatRecipient(new URLSearchParams({ team_id: "T1", user_id: "U1", channel_id: "C1" }))).toBeNull();
    expect(slackChatRecipient(new URLSearchParams("team_id=T1&team_id=T2&user_id=U1&channel_id=D1"))).toBeNull();
    const dm = { type: 2, application_id: "123", token: "synthetic-only", user: { id: "456" }, channel_id: "789" };
    expect(discordChatRecipient(dm)).not.toBeNull();
    expect(discordChatRecipient({ ...dm, member: {} }, true)).toBeNull();
    expect(discordChatRecipient({ ...dm, member: { user: { id: "456" } } })).toBeNull();
  });
  it("issues only a hash and fragment URL through an own hidden port, not prototype or spread", async () => {
    const issue = vi.fn(), lookup = vi.fn().mockResolvedValue(null);
    const store = { issue, lookup, preview: vi.fn(), complete: vi.fn(), unlink: vi.fn(), list: vi.fn(), unlinkAccount: vi.fn() };
    const db = Object.defineProperty({}, "chatAccountLinks", { value: store }) as KeryxDB;
    const options = { db: async () => db, command: "link" as const,
      recipient: { platform: "telegram" as const, scope: "telegram", userId: "7", channel: "7" },
      binding: { origin: "https://keryx.example", network: "eip155:5042" as const } };
    const reply = await chatControlReply(options), token = /#token=([a-f0-9]{64})/.exec(reply)![1];
    expect(issue).toHaveBeenCalledTimes(1); expect(issue.mock.calls[0][0].tokenHash).toBe(chatTokenHash(token));
    expect(JSON.stringify(issue.mock.calls)).not.toContain(token); expect(reply).not.toContain("?token=");
    await expect(chatControlReply({ ...options, db: async () => ({ ...db }) })).rejects.toThrow("chat_unavailable");
    await expect(chatControlReply({ ...options, db: async () => Object.create(db) })).rejects.toThrow("chat_unavailable");
  });
});
