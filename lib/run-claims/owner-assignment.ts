/** Separate discriminator/contract. Never adapt this to immutable claims.read,
 * strict ownership v1 or owned-page v2; it grants no privacy or publication writer. */
export { inboxItemSchema, projectAssignment } from "../owner-run-assignments/projection";
export type { InboxItem } from "../owner-run-assignments/projection";
