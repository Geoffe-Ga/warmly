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

/**
 * Tokens set aside in every request for the instructions the app sends
 * with it (how to answer, what not to do, the form of the answer).
 */
export const POLICY_RESERVE_TOKENS = 1_500;

/**
 * The share of the budget left unused, because a token estimate made on
 * the device is only an estimate (decision D-18).
 */
export const ESTIMATE_MARGIN = 0.15;

/** How long Warmly waits for an answer before it stops, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 90_000;
