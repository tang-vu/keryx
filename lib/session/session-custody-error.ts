/** Only a successful read with no retained original permits initial key creation. */
export class SessionCustodyMissingError extends Error {
  readonly code = "session_custody_missing";
  constructor() {
    super("No saved session was found for this wallet in this browser");
    this.name = "SessionCustodyMissingError";
  }
}
