/** Human-readable, explicit caller request. Source text or augmented context
 * cannot select this format; adapters pass the original caller text only. */
export const API_INTEGRATION_NOTE_REQUEST = "Prepare an API integration note.";
export function requestsApiIntegrationNote(question: string): boolean {
  return question.trimStart().split(/\r?\n/u, 1)[0] === API_INTEGRATION_NOTE_REQUEST;
}
