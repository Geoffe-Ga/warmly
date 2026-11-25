/**
 * The one way the app reaches an AI provider (PRD AI-001 to AI-006, SEC-009,
 * AI-014, AI-015; decision D-17).
 *
 * Every AI call in the app goes through here, and this module is the only
 * one allowed to hold or call a provider. Three rules are built in:
 *
 * - **No consent, no call.** Each call needs a consent token made by the
 *   disclosure dialog for that very request. A token works once.
 * - **One attempt.** A call is tried once. There is no retry loop and no
 *   second provider to fall back to. If it fails, the person is told and
 *   may ask again, which means agreeing again.
 * - **Nothing automatic.** Nothing here runs on a timer, on a change to the
 *   journal, or on opening a screen. It runs when a screen calls it with a
 *   token, and a token only exists because the person pressed a button.
 *
 * Journal text passes through this module on its way to the provider and is
 * never logged, stored or sent anywhere else.
 */
import { consumeConsent, sealRequest, type ConsentToken } from "./consent";
import { FakeProvider } from "./fake-provider";
import type {
  AIProvider,
  AiRequest,
  CardsRequest,
  ConfigCheck,
  ReflectRequest,
  SegmentAlternativesRequest,
} from "./provider";

/** No provider is connected, so there is nothing to send a request to. */
export class NoProviderError extends Error {
  constructor() {
    super("No AI provider is connected");
    this.name = "NoProviderError";
  }
}

/**
 * The call did not come with the person's fresh agreement to send this
 * request. Nothing was sent.
 */
export class ConsentRequiredError extends Error {
  constructor() {
    super("The person has not agreed to send this request");
    this.name = "ConsentRequiredError";
  }
}

/** The request is larger than the provider's model accepts. Nothing was sent. */
export class RequestTooLargeError extends Error {
  constructor() {
    super("The request is too large for the provider");
    this.name = "RequestTooLargeError";
  }
}

/** What the person is shown before they agree to send a request. */
export interface Disclosure {
  /** The provider's name, for example "OpenAI". */
  readonly provider: string;
  /** How many journal entries are included. */
  readonly entries: number;
  /** What else is included, in the person's own words elsewhere on screen. */
  readonly also: "your question" | "your topic" | "the wording you chose";
  /** About how many tokens the request carries. */
  readonly estimatedTokens: number;
  /** Whether the request is a large one, worth pointing out (AI-016). */
  readonly large: boolean;
}

/** Which provider is connected, for Settings to show. */
export type ProviderState =
  | { readonly kind: "none" }
  | {
      readonly kind: "connected";
      readonly name: string;
      /** Whether this is the built-in stand-in, which sends nothing. */
      readonly standIn: boolean;
    };

/**
 * A request of this many estimated tokens or more is called out as large,
 * with a word about cost, before the person agrees (PRD AI-016).
 */
export const LARGE_REQUEST_TOKENS = 4_000;

const ALSO = {
  reflect: "your question",
  cards: "your topic",
  "segment-alternatives": "the wording you chose",
} as const;

/** The gateway. One per app; screens reach it as `services.ai`. */
export class AiGateway {
  readonly #provider: AIProvider | undefined;

  /**
   * @param provider - The connected provider, if there is one.
   */
  constructor(provider: AIProvider | undefined) {
    this.#provider = provider;
  }

  /** @returns Which provider is connected. Makes no network call. */
  state(): ProviderState {
    const provider = this.#provider;
    return provider === undefined
      ? { kind: "none" }
      : {
          kind: "connected",
          name: provider.name,
          standIn: provider.id === "fake",
        };
  }

  /**
   * Check that the connected provider can be used.
   *
   * @returns The provider's answer; `no_credential` when none is connected.
   */
  validateConfig(): Promise<ConfigCheck> {
    return (
      this.#provider?.validateConfig() ??
      Promise.resolve({ ok: false, reason: "no_credential" })
    );
  }

  /**
   * Describe what sending a request would send, for the disclosure dialog.
   * Makes no network call and sends nothing.
   *
   * Describing a request seals it: from here on it cannot be changed, so
   * what is described is what would be sent.
   *
   * @param request - The request the person is about to be asked about.
   * @returns What to show them.
   * @throws NoProviderError if no provider is connected.
   */
  disclose(request: AiRequest): Disclosure {
    const provider = this.#need();
    sealRequest(request);
    const estimatedTokens = provider.estimateTokens(request);
    return {
      provider: provider.name,
      entries: request.entries.length,
      also: ALSO[request.kind],
      estimatedTokens,
      large: estimatedTokens >= LARGE_REQUEST_TOKENS,
    };
  }

  #need(): AIProvider {
    if (this.#provider === undefined) {
      throw new NoProviderError();
    }
    return this.#provider;
  }

  /**
   * The checks every call makes before anything is sent, in this order: a
   * provider, the person's agreement to this request, and a size the
   * provider accepts. The token is used up even if a later check fails.
   * If the provider throws while sizing the request, the call is refused
   * with that error after the token has been used, and nothing is sent.
   */
  #admit(request: AiRequest, consent: ConsentToken): AIProvider {
    const provider = this.#need();
    if (!consumeConsent(consent, request)) {
      throw new ConsentRequiredError();
    }
    if (
      provider.estimateTokens(request) > provider.capabilities().maxInputTokens
    ) {
      throw new RequestTooLargeError();
    }
    return provider;
  }

  /**
   * Ask a question about the journal entries in the request.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked. It must be validated before
   *   anything is done with it.
   * @throws NoProviderError, ConsentRequiredError or RequestTooLargeError
   *   before anything is sent; whatever the provider throws afterwards. It
   *   is never tried again.
   */
  reflect(
    request: ReflectRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<unknown> {
    return this.#once(request, consent, (provider) =>
      provider.reflect(request, signal),
    );
  }

  /**
   * Draft conversation cards from the entries in the request.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   * @throws As {@link AiGateway.reflect}.
   */
  generateCards(
    request: CardsRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<unknown> {
    return this.#once(request, consent, (provider) =>
      provider.generateCards(request, signal),
    );
  }

  /**
   * Offer other wordings for one part of a card.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns The provider's answer, unchecked.
   * @throws As {@link AiGateway.reflect}.
   */
  generateSegmentAlternatives(
    request: SegmentAlternativesRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<unknown> {
    return this.#once(request, consent, (provider) =>
      provider.generateSegmentAlternatives(request, signal),
    );
  }

  /** Admit a call and make it, exactly once. */
  async #once(
    request: AiRequest,
    consent: ConsentToken,
    call: (provider: AIProvider) => Promise<unknown>,
  ): Promise<unknown> {
    return call(this.#admit(request, consent));
  }
}

/**
 * Build the app's gateway.
 *
 * A production build has no provider until the person connects one (the
 * adapters arrive with #44 and #45). Other builds use the stand-in, which
 * sends nothing. The check is written against the build mode directly so
 * that the stand-in is left out of a production bundle altogether.
 *
 * @returns The gateway.
 */
export function createGateway(): AiGateway {
  return new AiGateway(
    import.meta.env.MODE === "production" ? undefined : new FakeProvider(),
  );
}
