import { CHAT_ACCOUNT_SCHEMA, CHAT_ACCOUNT_TABLES } from "./chat-accounts-schema";

/** Typed additive migration partition only. Parent composes this with the fixed
 * native bundle and existing backup/typed-row/fence admission. No executor here,
 * no independent profile matrix, no migration at application construction. */
export const CHAT_ACCOUNT_MIGRATION = Object.freeze({
  format: "keryx-chat263-additive-domain-v1" as const,
  tables: CHAT_ACCOUNT_TABLES,
  statements: CHAT_ACCOUNT_SCHEMA,
  expectedInitialRows: Object.freeze({ chat263_links: 0, chat263_tokens: 0 }),
  installsAccountOrConsent: false,
  signingResumeAuthorized: false,
});
