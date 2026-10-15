import { recipientSchema, type ChatRecipient } from "./contracts";
import type { TelegramUpdate } from "../telegram/ask-message";
import type { Interaction } from "../discord/ask-interaction";

/** These mappers establish shape/private delivery only, NOT transport authentication.
 * Routes must verify their original secret/signature before calling them. */
export function telegramChatRecipient(update: TelegramUpdate, research = false): ChatRecipient | null {
  const m = update.message, id = m?.from?.id;
  if (!Number.isSafeInteger(id) || !id || id < 1 || m?.from?.is_bot || !Number.isSafeInteger(m?.chat?.id)) return null;
  if (!research && (m?.chat?.type !== "private" || m.chat.id !== id)) return null;
  return parsed({ platform: "telegram", scope: "telegram", userId: String(id), channel: String(m?.chat?.id) });
}
export function slackChatRecipient(params: URLSearchParams, research = false): ChatRecipient | null {
  if (["team_id", "user_id", "channel_id"].some(key => params.getAll(key).length !== 1)) return null;
  if (!research && !/^D[A-Z0-9]+$/.test(params.get("channel_id") ?? "")) return null;
  return parsed({ platform: "slack", scope: params.get("team_id"), userId: params.get("user_id"), channel: params.get("channel_id") });
}
export function discordChatRecipient(interaction: Interaction, research = false): ChatRecipient | null {
  const wire = interaction as Interaction & { channel_id?: unknown; guild_id?: unknown };
  // Guild controls refuse; no member-to-DM fallback. Group user identities never gain a private envelope.
  if (interaction.type !== 2 || !interaction.token) return null;
  if (!research && (interaction.member !== undefined || wire.guild_id !== undefined)) return null;
  const userId = interaction.member !== undefined ? interaction.member?.user?.id : interaction.user?.id;
  return parsed({ platform: "discord", scope: interaction.application_id, userId, channel: wire.channel_id });
}
function parsed(value: unknown): ChatRecipient | null {
  const result = recipientSchema.safeParse(value);
  return result.success ? result.data : null;
}
