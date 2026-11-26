/**
 * What one AI request may send, ask for and wait for (PRD AI-016).
 *
 * The budget is the smaller of what the provider's model accepts and what
 * the app allows (`config.ts`). It is checked before anything is sent.
 */
import {
  APP_MAX_INPUT_TOKENS,
  APP_MAX_OUTPUT_TOKENS,
  ESTIMATE_MARGIN,
  POLICY_RESERVE_TOKENS,
  REQUEST_TIMEOUT_MS,
} from "./config";
import type { Capabilities } from "./provider";

/** The limits on one request. */
export interface Budget {
  /** The most tokens the request may carry in. */
  readonly maxInputTokens: number;
  /** The most tokens the answer may carry out. */
  readonly maxOutputTokens: number;
  /** How long to wait for the answer, in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * Work out the budget for requests to a provider.
 *
 * @param capabilities - What the provider's model accepts.
 * @returns The limits that apply.
 */
export function budgetFor(capabilities: Capabilities): Budget {
  return {
    maxInputTokens: Math.min(capabilities.maxInputTokens, APP_MAX_INPUT_TOKENS),
    maxOutputTokens: Math.min(
      capabilities.maxOutputTokens,
      APP_MAX_OUTPUT_TOKENS,
    ),
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
}

/**
 * Whether a request of this size may be sent.
 *
 * @param estimatedTokens - The provider's estimate for the request.
 * @param budget - The limits that apply.
 * @returns `false` if it is over the input limit, or the estimate is not a
 *   usable number: a request whose size is unknown is not sent.
 */
export function withinBudget(estimatedTokens: number, budget: Budget): boolean {
  return (
    Number.isFinite(estimatedTokens) &&
    estimatedTokens >= 0 &&
    estimatedTokens <= budget.maxInputTokens
  );
}

/**
 * How many tokens of journal entries one request may carry (PRD RF-004;
 * decision D-18).
 *
 * From the input limit, set aside the app's instructions, the answer's
 * maximum length, the question and whatever of the current session is
 * sent with it. Then leave a margin unused, because the sizes are
 * estimates. What remains is for entries.
 *
 * @param budget - The limits on the request.
 * @param reserved - Tokens the question and the session's earlier turns
 *   will take.
 * @returns The tokens available for entries; never less than zero.
 */
export function contextBudget(budget: Budget, reserved: number): number {
  const room =
    budget.maxInputTokens -
    POLICY_RESERVE_TOKENS -
    budget.maxOutputTokens -
    Math.max(0, Math.ceil(reserved));
  return Math.max(0, Math.floor(room * (1 - ESTIMATE_MARGIN)));
}
