/**
 * Consent to send one request to an AI provider (PRD SEC-009, AI-015).
 *
 * A consent token is the only thing that lets the gateway call a provider.
 * It is made in exactly one place, the confirm button of the disclosure
 * dialog, for exactly one request, and it works once. There is no other way
 * to get one, which is how "no automatic AI" is built into the structure of
 * the app and not left to care.
 *
 * Only `gateway.ts` and `AiDisclosureDialog.tsx` may import this module. A
 * lint rule and a test enforce that.
 */
import type { AiRequest } from "./provider";

declare const consent: unique symbol;

/**
 * Proof that the person has just agreed to send one particular request.
 * It carries nothing and cannot be made by spreading or copying.
 */
export interface ConsentToken {
  readonly [consent]: true;
}

/** Which request each unused token was given for. */
const granted = new WeakMap<ConsentToken, AiRequest>();

/**
 * Record the person's agreement to send one request. Called only by the
 * disclosure dialog's confirm button.
 *
 * @param request - The request that was shown to the person.
 * @returns A token that lets the gateway send that request, once.
 */
export function grantConsent(request: AiRequest): ConsentToken {
  const token = Object.freeze({}) as ConsentToken;
  granted.set(token, request);
  return token;
}

/**
 * Use a token up. Called only by the gateway.
 *
 * @param token - What the caller offered as consent.
 * @param request - The request the caller wants to send.
 * @returns Whether the token was given for exactly this request and had not
 *   been used. Either way it cannot be used again.
 */
export function consumeConsent(token: unknown, request: AiRequest): boolean {
  if (typeof token !== "object" || token === null) {
    return false;
  }
  const key = token as ConsentToken;
  const agreed = granted.get(key);
  granted.delete(key);
  // The very request that was shown, not one that merely looks the same.
  return agreed === request;
}
