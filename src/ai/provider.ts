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
 * and against what was actually sent (AI-007 onwards; `contracts.ts` and
 * `grounding.ts`). The gateway does that before it returns anything.
 *
 * A provider is never given an entry's ID or content hash. It gets the text
 * under a short name that means something only in that one request.
 */

/** The providers the app knows about. `fake` exists only outside production. */
export type ProviderId = "fake" | "openai" | "anthropic";

/** The three answers of a journal entry. */
export type ResponseKey = "good" | "improve" | "loved";

/** One journal entry the person chose to send. */
export interface SourceEntry {
  readonly id: string;
  /** The entry's content hash, so an answer can be tied to what was sent. */
  readonly contentHash: string;
  readonly responses: Readonly<Record<ResponseKey, string>>;
}

/** How much of the journal a Reflect request covers. */
export interface RequestCoverage {
  /** How many entries were left out to fit the provider's limits. */
  readonly omittedEntryCount: number;
  /** Whether any included entry was shortened. */
  readonly truncated: boolean;
}

/** A question about the person's own journal. */
export interface ReflectRequest {
  readonly kind: "reflect";
  readonly question: string;
  readonly entries: readonly SourceEntry[];
  /** What was left out, if anything. Nothing was, when this is absent. */
  readonly coverage?: RequestCoverage;
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

/**
 * One entry as a provider sees it: a name that means something only in
 * this request, and the text. No entry ID and no hash (decision D-16).
 */
export interface AliasedSource {
  /** The entry's name in this request, for example `E1`. */
  readonly alias: string;
  readonly responses: Readonly<Record<ResponseKey, string>>;
}

/** A Reflect request as a provider is given it. */
export interface ReflectPrompt {
  readonly kind: "reflect";
  readonly question: string;
  readonly sources: readonly AliasedSource[];
}

/** A cards request as a provider is given it. */
export interface CardsPrompt {
  readonly kind: "cards";
  readonly topic: string;
  readonly sources: readonly AliasedSource[];
}

/** A request for other wordings as a provider is given it. */
export interface SegmentAlternativesPrompt {
  readonly kind: "segment-alternatives";
  readonly text: string;
  readonly sources: readonly AliasedSource[];
}

/**
 * Anything a provider can be given. The gateway makes it from an
 * {@link AiRequest}; a provider never sees the request itself.
 */
export type AiPrompt = ReflectPrompt | CardsPrompt | SegmentAlternativesPrompt;

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
   * @param prompt - What would be sent.
   * @returns The estimate.
   */
  estimateTokens(prompt: AiPrompt): number;
  /**
   * Answer a question about the journal entries sent.
   *
   * @param prompt - The question and the entries.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  reflect(prompt: ReflectPrompt, signal: AbortSignal): Promise<unknown>;
  /**
   * Draft conversation cards from the entries sent.
   *
   * @param prompt - The topic and the entries.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  generateCards(prompt: CardsPrompt, signal: AbortSignal): Promise<unknown>;
  /**
   * Offer other wordings for one part of a card.
   *
   * @param prompt - The wording and the entries it rests on.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   */
  generateSegmentAlternatives(
    prompt: SegmentAlternativesPrompt,
    signal: AbortSignal,
  ): Promise<unknown>;
}
