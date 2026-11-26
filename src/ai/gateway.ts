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
 * - **Nothing unchecked comes back.** A provider is given the entries under
 *   names made for that one request, never their IDs. Its answer is checked
 *   against the agreed form and against what was sent before anything is
 *   returned (`contracts.ts`, `grounding.ts`; ADR-0008). An answer that
 *   fails is refused whole, and is not asked for again.
 *
 * Journal text passes through this module on its way to the provider and is
 * never logged, stored or sent anywhere else.
 */
import { untilAborted } from "./abort";
import { budgetFor, withinBudget, type Budget } from "./budget";
import { consumeConsent, sealRequest, type ConsentToken } from "./consent";
import type {
  GeneratedCard,
  ReflectionAnswer,
  SegmentAlternatives,
} from "./contracts";
import { AiBusyError, NoProviderError, RequestTooLargeError } from "./errors";
import { FakeProvider } from "./fake-provider";
import { groundAlternatives, groundCards, groundReflection } from "./grounding";
import { buildManifest, promptFor, type Manifest } from "./manifest";
import type {
  AIProvider,
  AiRequest,
  CardsRequest,
  ConfigCheck,
  ReflectRequest,
  SegmentAlternativesRequest,
} from "./provider";

// The type of a consent token, for code that passes one through without
// being able to make one. Making a token still needs the consent module,
// which only the disclosure dialog may import.
export type { ConsentToken } from "./consent";

// Defined beside the other failures; exported here too because this is
// where callers meet them.
export { AiBusyError, NoProviderError, RequestTooLargeError } from "./errors";

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

/** What the person is shown before they agree to send a request. */
export interface Disclosure {
  /** The provider's name, for example "OpenAI". */
  readonly provider: string;
  /** How many journal entries are included. */
  readonly entries: number;
  /**
   * How many finished entries were left out because they do not fit in
   * one request (PRD RF-004). Zero when everything is included.
   */
  readonly omitted: number;
  /**
   * How many of those were left out because each is too long to send in
   * one request at all.
   */
  readonly tooLong: number;
  /**
   * How many of {@link Disclosure.entries} are notes written after a
   * conversation, not journal entries (PRD PC-004).
   */
  readonly after: number;
  /** How many of {@link Disclosure.omitted} are such notes. */
  readonly afterOmitted: number;
  /** What else is included, in the person's own words elsewhere on screen. */
  readonly also: "your question" | "your topic" | "the wording you chose";
  /**
   * How many earlier turns of the same Reflect session go with the
   * question (PRD RF-006). Zero for a first question and for other kinds.
   */
  readonly earlierTurns: number;
  /** About how many tokens the request carries. */
  readonly estimatedTokens: number;
  /** Whether the request is a large one, worth pointing out (AI-016). */
  readonly large: boolean;
}

/** The limits on a request, and a way to size one without sending it. */
export interface Sizing {
  readonly budget: Budget;
  /**
   * @param request - A request that will not be sent as it is.
   * @returns About how many tokens it would carry.
   */
  readonly estimate: (request: AiRequest) => number;
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
  /** Whether a call is running. Only one runs at a time. */
  #busy = false;

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
    const estimatedTokens = provider.estimateTokens(
      promptFor(request, buildManifest(request.entries)),
    );
    return {
      provider: provider.name,
      entries: request.entries.length,
      omitted:
        request.kind === "reflect"
          ? (request.coverage?.omittedEntryCount ?? 0)
          : 0,
      tooLong:
        request.kind === "reflect" ? (request.coverage?.tooLong ?? 0) : 0,
      after: request.entries.filter(
        (entry) => "kind" in entry && entry.kind === "post_conversation",
      ).length,
      afterOmitted:
        request.kind === "reflect" ? (request.coverage?.afterOmitted ?? 0) : 0,
      also: ALSO[request.kind],
      earlierTurns:
        request.kind === "reflect" ? (request.history ?? []).length : 0,
      estimatedTokens,
      large: estimatedTokens >= LARGE_REQUEST_TOKENS,
    };
  }

  /**
   * What is needed to choose how much of a journal fits in one request
   * (PRD RF-004): the limits, and a way to size a request. Sizing sends
   * nothing, makes no network call and does not seal the request.
   *
   * @returns The limits and the sizing function, or `undefined` when no
   *   provider is connected.
   */
  sizing(): Sizing | undefined {
    const provider = this.#provider;
    if (provider === undefined) {
      return undefined;
    }
    return {
      budget: budgetFor(provider.capabilities()),
      estimate: (request) =>
        provider.estimateTokens(
          promptFor(request, buildManifest(request.entries)),
        ),
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
   * provider, the person's agreement to this request, and a size within
   * the budget (the smaller of what the provider accepts and what the app
   * allows; see `budget.ts`). The token is used up even if a later check fails.
   * If the provider throws while sizing the request, the call is refused
   * with that error after the token has been used, and nothing is sent.
   */
  #admit(
    request: AiRequest,
    consent: ConsentToken,
  ): { provider: AIProvider; manifest: Manifest } {
    const provider = this.#need();
    if (!consumeConsent(consent, request)) {
      throw new ConsentRequiredError();
    }
    const manifest = buildManifest(request.entries);
    if (
      !withinBudget(
        provider.estimateTokens(promptFor(request, manifest)),
        budgetFor(provider.capabilities()),
      )
    ) {
      throw new RequestTooLargeError();
    }
    return { provider, manifest };
  }

  /**
   * Make one call, and only one at a time (PRD AI-016). A second call
   * while one is running is refused before its consent is looked at, so
   * its token is not used up.
   *
   * The call ends as soon as its signal fires, whether or not the
   * provider stops: the gateway is free for the next request at once, and
   * whatever the stopped call returns later is dropped unread. A call
   * whose signal has already fired is refused before anything is used up.
   */
  async #one<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
    if (this.#busy) {
      throw new AiBusyError();
    }
    if (signal.aborted) {
      throw new DOMException("The request was stopped", "AbortError");
    }
    this.#busy = true;
    try {
      return await untilAborted(call(), signal);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Ask a question about the journal entries in the request.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns The answer, checked: every citation points at an entry that
   *   was sent and at words that are in it.
   * @throws NoProviderError, ConsentRequiredError, RequestTooLargeError or
   *   DuplicateSourceError before anything is sent; whatever the provider
   *   throws afterwards; MalformedResponseError or UngroundedCitationError
   *   if the answer fails its checks. It is never tried again.
   */
  async reflect(
    request: ReflectRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ReflectionAnswer> {
    return this.#one(signal, async () => {
      const { provider, manifest } = this.#admit(request, consent);
      const raw = await provider.reflect(promptFor(request, manifest), signal);
      return groundReflection(raw, manifest, request.coverage);
    });
  }

  /**
   * Draft conversation cards from the entries in the request.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns One to three checked cards.
   * @throws As {@link AiGateway.reflect}.
   */
  async generateCards(
    request: CardsRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<readonly GeneratedCard[]> {
    return this.#one(signal, async () => {
      const { provider, manifest } = this.#admit(request, consent);
      const raw = await provider.generateCards(
        promptFor(request, manifest),
        signal,
      );
      return groundCards(raw, manifest);
    });
  }

  /**
   * Offer other wordings for one part of a card.
   *
   * @param request - The request the person agreed to send.
   * @param consent - Their agreement, from the disclosure dialog.
   * @param signal - Cancels the request.
   * @returns The checked wordings.
   * @throws As {@link AiGateway.reflect}.
   */
  async generateSegmentAlternatives(
    request: SegmentAlternativesRequest,
    consent: ConsentToken,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SegmentAlternatives> {
    return this.#one(signal, async () => {
      const { provider, manifest } = this.#admit(request, consent);
      const raw = await provider.generateSegmentAlternatives(
        promptFor(request, manifest),
        signal,
      );
      return groundAlternatives(raw);
    });
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
