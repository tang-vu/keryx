import { accountSessionContext } from "../account-sessions";
import { verifyApiKey } from "../api-keys";
import { getDb } from "../db";
import { privacyBinding } from "../run-privacy/auth";
import { createOwnedHistoryRoute } from "./owned-history-route";
export const ownedHistoryHttp = (action: "list" | "export" | "detail") => createOwnedHistoryRoute({
  session: accountSessionContext, key: verifyApiKey, db: getDb, binding: privacyBinding(),
}, action);
