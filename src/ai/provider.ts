/**
 * What an AI provider is, as far as the app is concerned (PRD AI-001 to
 * AI-006).
 *
 * A provider is a third party the person has chosen and holds their own key
 * for. It is the only place plaintext from the journal ever goes, and only
 * when the person has just said so for that one request (see `gateway.ts`).
 * Nothing in the app talks to a provider except through the gateway.
 *
 * What a provider returns is untrusted. It is typed `unknown` here on
 * purpose: nothing may use it before it has been checked against a schema
 * and against what was actually sent (AI-007 onwards).
 */

/** The providers the app knows about. `fake` exists only outside production. */
export type ProviderId = "fake" | "openai" | "anthropic";

/** One journal entry's text, as sent to a provider. */
export interface SourceEntry {
  readonly id: string;
  /** The entry's content hash, so an answer can be tied to what was sent. */
  readonly contentHash: string;
  readonly responses: {
    readonly good: string;
    readonly improve: string;
    readonly loved: string;
  };
}

/** A question about the person's own journal. */
export interface ReflectRequest {
  readonly kind: "reflect";
  readonly question: string;
  readonly entries: readonly SourceEntry[];
}

/** A request for conversation cards built from chosen entries. */
export interface CardsRequest {
  readonly kind: "cards";
  /** What the person wants to talk about, in their words. */
  readonly topic: string;
  readonly entries: readonly SourceEntry[];
}

/** A request for other ways to word one part of a card. */
export interface SegmentAlternativesRequest {
  readonly kind: "segment-alternatives";
  /** The wording to offer alternatives to. */
  readonly text: string;
  readonly entries: readonly SourceEntry[];
}

/** Anything that can be asked of a provider. */
export type AiRequest =
  ReflectRequest | CardsRequest | SegmentAlternativesRequest;

/** What a provider and its chosen model can do. */
export interface Capabilities {
  /** Whether answers can be constrained to a schema by the provider. */
  readonly structuredOutput: boolean;
  /** Whether a request in flight can be cancelled. */
  readonly cancellation: boolean;
  /** The most tokens one request may carry in. */
  readonly maxInputTokens: number;
  /** The most tokens one answer may carry out. */
  readonly maxOutputTokens: number;
}

/** Whether a provider is ready to be used. */
export type ConfigCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Why not, as a fixed reason the app can put into words. */
      readonly reason: "no_credential" | "rejected" | "unreachable";
    };

/** A third-party AI service, or the stand-in for one. */
export interface AIProvider {
  readonly id: ProviderId;
  /** The provider's name as shown to the person, for example "OpenAI". */
  readonly name: string;
  /** @returns What the provider's chosen model can do. */
  capabilities(): Capabilities;
  /** @returns Whether the provider is configured and can be used. */
  validateConfig(): Promise<ConfigCheck>;
  /**
   * Estimate, without any network call, how many tokens a request carries.
   *
   * @param request - The request.
   * @returns The estimate.
   */
  estimateTokens(request: AiRequest): number;
  /**
   * Answer a question about the journal entries sent.
   *
   * @param request - The question and the entries.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  reflect(request: ReflectRequest, signal: AbortSignal): Promise<unknown>;
  /**
   * Draft conversation cards from the entries sent.
   *
   * @param request - The topic and the entries.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  generateCards(request: CardsRequest, signal: AbortSignal): Promise<unknown>;
  /**
   * Offer other wordings for one part of a card.
   *
   * @param request - The wording and the entries it rests on.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  generateSegmentAlternatives(
    request: SegmentAlternativesRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}
