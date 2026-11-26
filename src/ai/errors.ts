/**
 * Every way an AI request can fail, and what the person is told (PRD
 * AI-014, AI-017; AC-15).
 *
 * A failure never loses what the person typed or chose, is never retried
 * by the app, and is never sent to a different provider. The person is
 * told what happened, why, and what they can do, and may ask again, which
 * means being asked for consent again.
 *
 * Nothing here holds or shows the provider's own error text, the request,
 * or anything from the journal.
 */
import { MalformedResponseError } from "./contracts";
import { UngroundedCitationError } from "./grounding";

/** The kinds of failure, in the order they are tested and documented. */
export const AI_ERROR_KINDS = [
  "no_credential",
  "invalid_credential",
  "rate_limited",
  "timeout",
  "network",
  "provider_error",
  "invalid_output",
  "too_large",
  "busy",
  "cancelled",
] as const;

/**
 * One kind of failure.
 *
 * - `no_credential`: no provider is connected, or it has no key.
 * - `invalid_credential`: the provider refused the key.
 * - `rate_limited`: the provider is limiting the key or the account.
 * - `timeout`: no answer came in time.
 * - `network`: the provider could not be reached.
 * - `provider_error`: the provider failed on its side.
 * - `invalid_output`: an answer came but did not pass the app's checks.
 * - `too_large`: the request is over the budget. Nothing was sent.
 * - `busy`: another request is still running. Nothing was sent.
 * - `cancelled`: the person stopped it. Not shown as an error.
 */
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

/**
 * A failed AI request, by kind. Providers throw this for failures they can
 * name. It carries no text from the provider.
 */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  /** @param kind - Which kind of failure this is. */
  constructor(kind: AiErrorKind) {
    super(`The AI request failed (${kind})`);
    this.name = "AiError";
    this.kind = kind;
  }
}

/** No provider is connected, so there is nothing to send a request to. */
export class NoProviderError extends Error {
  constructor() {
    super("No AI provider is connected");
    this.name = "NoProviderError";
  }
}

/** The request is larger than the provider's model accepts. Nothing was sent. */
export class RequestTooLargeError extends Error {
  constructor() {
    super("The request is too large for the provider");
    this.name = "RequestTooLargeError";
  }
}

/** Another AI request is still running. Nothing was sent or used up. */
export class AiBusyError extends Error {
  constructor() {
    super("Another AI request is still running");
    this.name = "AiBusyError";
  }
}

/** What a browser throws for a request that was stopped or took too long. */
const BY_NAME: Readonly<Record<string, AiErrorKind>> = {
  AbortError: "cancelled",
  TimeoutError: "timeout",
};

/** The app's own refusals, each with its kind. */
const OWN: readonly (readonly [new () => Error, AiErrorKind])[] = [
  [NoProviderError, "no_credential"],
  [RequestTooLargeError, "too_large"],
  [AiBusyError, "busy"],
];

/**
 * Say which kind of failure an error is.
 *
 * @param error - Whatever was thrown.
 * @returns Its kind. Anything not recognised is `provider_error`: the
 *   safest thing to say when the cause is unknown, since it promises
 *   nothing about the key or the connection.
 */
export function classifyAiError(error: unknown): AiErrorKind {
  if (error instanceof AiError) {
    return error.kind;
  }
  if (
    error instanceof MalformedResponseError ||
    error instanceof UngroundedCitationError
  ) {
    return "invalid_output";
  }
  const own = OWN.find(([made]) => error instanceof made);
  if (own !== undefined) {
    return own[1];
  }
  // Read by name, not by class: what a browser throws for an aborted or
  // timed-out request is a DOMException, which is not always an `Error`.
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? error.name
      : undefined;
  const named = typeof name === "string" ? BY_NAME[name] : undefined;
  if (named !== undefined) {
    return named;
  }
  // What `fetch` throws when it cannot connect.
  return error instanceof TypeError ? "network" : "provider_error";
}

/**
 * What to tell the person about a failure.
 *
 * @param kind - The kind of failure. `cancelled` has nothing to say.
 * @param provider - The provider's name as shown, for example "OpenAI".
 * @returns What happened and why, and what to do next.
 */
export function describeAiError(
  kind: Exclude<AiErrorKind, "cancelled">,
  provider: string,
): { readonly happened: string; readonly next: string } {
  switch (kind) {
    case "no_credential":
      return {
        happened: "No AI provider is connected, so nothing was sent.",
        next: "Connect a provider in Settings, then try again.",
      };
    case "invalid_credential":
      return {
        happened: `${provider} did not accept your API key, so there is no answer.`,
        next: "Check the key in Settings, or replace it, then try again.",
      };
    case "rate_limited":
      return {
        happened: `${provider} is limiting how much your key can be used right now, or your account with them has reached a limit.`,
        next: `Wait a few minutes, or check your account with ${provider}, then try again.`,
      };
    case "timeout":
      return {
        happened: `${provider} took too long to answer, so Warmly stopped waiting. ${provider} may still have received your request and counted it.`,
        next: "Try again when you are ready.",
      };
    case "network":
      return {
        happened: `Warmly couldn't reach ${provider}. This device may be offline.`,
        next: "Check your connection, then try again.",
      };
    case "provider_error":
      return {
        happened: `${provider} had a problem and did not answer. The problem is on their side.`,
        next: "Try again in a little while.",
      };
    case "invalid_output":
      return {
        happened: `${provider} answered, but the answer could not be checked against what you wrote, so Warmly is not showing it.`,
        next: "You can ask again. A new answer may pass the check.",
      };
    case "too_large":
      return {
        happened: `This is more than Warmly sends to ${provider} in one request, so nothing was sent.`,
        next: "Choose fewer entries, or a shorter question, then try again.",
      };
    case "busy":
      return {
        happened: `Another request to ${provider} is still running, so this one was not sent.`,
        next: "Wait for it to finish, or cancel it, then try again.",
      };
  }
}

/**
 * Said with every failure: what was kept, and what trying again means.
 *
 * @param provider - The provider's name as shown, for example "OpenAI".
 * @returns The sentence.
 */
export function retryNote(provider: string): string {
  return `Nothing you wrote or chose was lost. Warmly does not try again by itself: if you do, you will be asked first, and your writing is sent to ${provider} again.`;
}
