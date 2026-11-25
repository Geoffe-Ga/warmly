/**
 * The app's own limits on AI requests (PRD AI-016).
 *
 * A provider says what its model accepts; these say what Warmly is willing
 * to send and wait for, whatever the provider would allow. The smaller of
 * the two applies. They bound what one press of a button can cost.
 */

/** The most tokens Warmly sends in one request, whatever a provider allows. */
export const APP_MAX_INPUT_TOKENS = 60_000;

/** The most tokens Warmly asks for in one answer. */
export const APP_MAX_OUTPUT_TOKENS = 4_000;

/** How long Warmly waits for an answer before it stops, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 90_000;
