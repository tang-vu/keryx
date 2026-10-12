import type { AskMessage } from "../telegram/ask-message";
import { botPrivatePreparing } from "../bots/language";
export interface TelegramPrivatePlaceholder { message_id?: number; chat?: { id?: number; type?: string } }
/** A group request is not research admission until Telegram acknowledges a
 * sender-private placeholder. No credential, draft or placeholder is persisted. */
export async function prepareTelegramPrivateReply(command: AskMessage,
  send: (body: Record<string, unknown>) => Promise<TelegramPrivatePlaceholder | null>) {
  if (!Number.isSafeInteger(command.userId) || command.userId <= 0
    || !["private", "group", "supergroup"].includes(command.chatType ?? "")
    || command.chatType === "private" && command.chatId !== command.userId) return null;
  const placeholder = await send({ chat_id: command.userId,
    text: botPrivatePreparing(command.question), protect_content: true,
    ...(command.chatType === "private" && Number.isSafeInteger(command.messageId) ? { reply_to_message_id: command.messageId, allow_sending_without_reply: true } : {}) });
  if (!placeholder || !Number.isSafeInteger(placeholder.message_id) || placeholder.message_id! <= 0
    || placeholder.chat?.type !== "private" || placeholder.chat.id !== command.userId) return null;
  return { chatId: command.userId, placeholderId: placeholder.message_id! };
}
