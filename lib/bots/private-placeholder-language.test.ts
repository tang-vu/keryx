import { expect, it, vi } from "vitest";
import { botControlsCatalogues } from "./language";
import { prepareTelegramPrivateReply } from "../run-claims/telegram-private";
const cases = [["en", "Answer in English. Explain x402."], ["vi", "Trả lời bằng tiếng Việt. Giải thích x402."],
  ["pt", "Responda em português. Explique x402."], ["es", "En español, explique x402."]] as const;
it.each(cases)("%s localizes only the private placeholder and preserves sender/ack admission", async (language, question) => {
  const command = { question, userId: 789, chatId: -123, chatType: "group", messageId: 42 };
  const send = vi.fn(async () => ({ message_id: 55, chat: { id: 789, type: "private" } }));
  expect(await prepareTelegramPrivateReply(command, send)).toEqual({ chatId: 789, placeholderId: 55 });
  expect(send).toHaveBeenCalledExactlyOnceWith({ chat_id: 789, text: botControlsCatalogues[language].privatePreparing, protect_content: true });
  for (const ack of [null, { message_id: 55, chat: { id: -123, type: "group" } }, { message_id: 55, chat: { id: 790, type: "private" } }])
    expect(await prepareTelegramPrivateReply(command, async () => ack)).toBeNull();
  const invalid = vi.fn();
  expect(await prepareTelegramPrivateReply({ ...command, userId: 0 }, invalid)).toBeNull();
  expect(invalid).not.toHaveBeenCalled();
});
