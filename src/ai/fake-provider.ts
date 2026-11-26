/**
 * A stand-in AI provider that sends nothing anywhere (PRD AI-001).
 *
 * It answers from what it was given, the same way every time, in the form
 * a real provider is asked for (`contracts.ts`), so screens and tests can
 * run without a network, a key or a cost. It is never part of
 * a production build, and only the gateway may import it.
 */
import { AiError, type AiErrorKind } from "./errors";
import type {
  AIProvider,
  AiPrompt,
  AliasedSource,
  Capabilities,
  CardsPrompt,
  ConfigCheck,
  ReflectPrompt,
  ResponseKey,
  SegmentAlternativesPrompt,
} from "./provider";

/** Marks this as a stand-in; a test checks it is not in a real build. */
export const FAKE_PROVIDER_MARK = "warmly.fake.ai-provider";

const CAPABILITIES: Capabilities = {
  structuredOutput: true,
  cancellation: true,
  maxInputTokens: 8_000,
  maxOutputTokens: 1_000,
};

function cancelled(signal: AbortSignal): Promise<void> {
  return signal.aborted
    ? Promise.reject(
        new DOMException("The request was cancelled", "AbortError"),
      )
    : Promise.resolve();
}

const KEYS: readonly ResponseKey[] = ["good", "improve", "loved"];

/** The most entries the stand-in quotes, which is also the most cards. */
const QUOTED = 3;

/**
 * Quote the start of the first answer of an entry that has any text, the
 * way a real answer must: a name, which answer, and words copied exactly.
 */
function quoteFrom(
  source: AliasedSource,
): { alias: string; key: ResponseKey; quote: string } | undefined {
  for (const key of KEYS) {
    const quote = source.responses[key].trim().slice(0, 40).trim();
    if (quote !== "") {
      return { alias: source.alias, key, quote };
    }
  }
  return undefined;
}

function quotes(sources: readonly AliasedSource[]) {
  return sources
    .map(quoteFrom)
    .filter((quote) => quote !== undefined)
    .slice(0, QUOTED);
}

/** The stand-in provider. Every call is recorded for tests to inspect. */
export class FakeProvider implements AIProvider {
  readonly id = "fake" as const;
  readonly name = "Test provider";
  readonly mark = FAKE_PROVIDER_MARK;
  /** What it was given, in order. */
  readonly calls: AiPrompt[] = [];
  #failure: AiErrorKind | undefined;
  #hanging = false;

  /**
   * Make the next call fail the way a real provider can, for tests and
   * the component gallery.
   *
   * @param kind - The kind of failure. `cancelled` fails as an aborted
   *   request does.
   */
  failNextWith(kind: AiErrorKind): void {
    this.#failure = kind;
  }

  /** Make the next call wait until it is cancelled, and never answer. */
  hangNext(): void {
    this.#hanging = true;
  }

  /** What the next call was told to do instead of answering. */
  async #outcome(signal: AbortSignal): Promise<void> {
    const failure = this.#failure;
    this.#failure = undefined;
    if (failure === "cancelled") {
      throw new DOMException("The request was cancelled", "AbortError");
    }
    if (failure !== undefined) {
      throw new AiError(failure);
    }
    if (this.#hanging) {
      this.#hanging = false;
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("The request was cancelled", "AbortError"));
        });
      });
    }
  }

  capabilities(): Capabilities {
    return CAPABILITIES;
  }

  validateConfig(): Promise<ConfigCheck> {
    return Promise.resolve({ ok: true });
  }

  estimateTokens(prompt: AiPrompt): number {
    // About four characters to a token, which is close enough for a
    // stand-in and never zero for a request with anything in it.
    const text = JSON.stringify(prompt);
    return Math.ceil(text.length / 4);
  }

  async reflect(prompt: ReflectPrompt, signal: AbortSignal): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(prompt);
    await this.#outcome(signal);
    const found = quotes(prompt.sources);
    const marks = found.map((_, index) => `[c${String(index + 1)}]`).join(" ");
    return {
      markdown:
        `A test answer about ${String(prompt.sources.length)} entries${prompt.partial ? ", which are part of the journal" : ""}${prompt.history.length > 0 ? `, after ${String(prompt.history.length)} earlier in this reflection` : ""}. ${marks}`.trim(),
      citations: found.map((quote, index) => ({
        claimId: `c${String(index + 1)}`,
        evidence: [quote],
      })),
    };
  }

  async generateCards(
    prompt: CardsPrompt,
    signal: AbortSignal,
  ): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(prompt);
    await this.#outcome(signal);
    return {
      cards: quotes(prompt.sources).map((quote) => ({
        type: "appreciation",
        theme: "A test theme",
        segments: [
          {
            category: "appreciation",
            text: "A test card.",
            evidenceKind: "paraphrase",
            teachingExplanation: "A test explanation.",
            evidence: [quote],
          },
        ],
      })),
    };
  }

  async generateSegmentAlternatives(
    prompt: SegmentAlternativesPrompt,
    signal: AbortSignal,
  ): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(prompt);
    await this.#outcome(signal);
    return {
      alternatives: ["A test alternative.", "Another test alternative."],
    };
  }
}
