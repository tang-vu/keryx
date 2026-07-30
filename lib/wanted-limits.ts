/**
 * Shared demand-window limits for every wanted-claim surface and admission check.
 *
 * Reasoning engines emit at most four sub-claims per dispatch, so 400 recent runs can produce up
 * to 1,600 independently actionable briefs. A claim shown by the detail page must remain eligible
 * for the registration re-check even when it ranks below the condensed public board.
 */
export const WANTED_WINDOW_RUNS = 400;
export const WANTED_MAX_CLAIMS_PER_RUN = 4;
export const WANTED_DETAIL_LIMIT = WANTED_WINDOW_RUNS * WANTED_MAX_CLAIMS_PER_RUN;
