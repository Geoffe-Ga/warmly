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
export type JournalResponseKey = "good" | "improve" | "loved";

/** The three answers of a reflection written after a conversation. */
export type AfterResponseKey = "went_well" | "difficult" | "remember";

/**
 * Any answer that can be cited. The two kinds of writing use different
 * names on purpose, so that something written after a conversation can
 * never be read as an answer to one of the journal's questions (PRD
 * PC-004; decision D-22).
 */
export type ResponseKey = JournalResponseKey | AfterResponseKey;

/** One journal entry that is sent. */
export interface JournalSource {
  readonly id: string;
  /** The entry's content hash, so an answer can be tied to what was sent. */
  readonly contentHash: string;
  /** Absent for a journal entry, which is the usual kind. */
  readonly kind?: "journal_entry";
  readonly responses: Readonly<Record<JournalResponseKey, string>>;
}

/** One reflection written after a conversation that is sent. */
export interface AfterSource {
  readonly id: string;
  /** Its content hash, so an answer can be tied to what was sent. */
  readonly contentHash: string;
  readonly kind: "post_conversation";
  readonly responses: Readonly<Record<AfterResponseKey, string>>;
}

/** One piece of the person's own writing that is sent. */
export type SourceEntry = JournalSource | AfterSource;

/** The text of a source, under whichever names its kind uses. */
export type SourceResponses = SourceEntry["responses"];

/** How much of the journal a Reflect request covers. */
export interface RequestCoverage {
  /** How many entries were left out to fit the provider's limits. */
  readonly omittedEntryCount: number;
  /**
   * Whether the journal was cut down to fit: true exactly when entries
   * were left out. An entry is sent whole or not at all, never shortened.
   */
  readonly truncated: boolean;
  /**
   * How many of the omitted entries were left out because each is too
   * long to send in one request at all. Absent when none were.
   */
  readonly tooLong?: number;
  /**
   * How many of the omitted entries are notes written after a
   * conversation, so the person can be told what was left out by its
   * right name. Absent when none were.
   */
  readonly afterOmitted?: number;
}

/**
 * An earlier question in the same Reflect session, with the prose of the
 * answer it got (PRD RF-006).
 */
export interface EarlierTurn {
  readonly question: string;
  readonly answer: string;
}

/** A question about the person's own journal. */
export interface ReflectRequest {
  readonly kind: "reflect";
  readonly question: string;
  readonly entries: readonly SourceEntry[];
  /**
   * The earlier turns of the session this question is asked in, oldest
   * first. Only that session's: nothing from any other conversation is
   * ever sent (PRD RF-006). Absent for a first question.
   */
  readonly history?: readonly EarlierTurn[];
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
  /**
   * Present only for something written after a conversation, so that a
   * provider labels it as such and does not treat it as a journal entry.
   */
  readonly kind?: "post_conversation";
  readonly responses: SourceResponses;
}

/** A Reflect request as a provider is given it. */
export interface ReflectPrompt {
  readonly kind: "reflect";
  readonly question: string;
  readonly sources: readonly AliasedSource[];
  /** The session's earlier turns, oldest first. Empty for a first question. */
  readonly history: readonly EarlierTurn[];
  /**
   * Whether these are only some of the journal's entries. A provider must
   * tell its model so, so that the answer does not speak for the whole
   * journal (PRD AC-09). The app says so itself as well, beside the
   * answer, whatever the model writes.
   */
  readonly partial: boolean;
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
