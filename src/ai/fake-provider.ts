/**
 * A stand-in AI provider that sends nothing anywhere (PRD AI-001).
 *
 * It answers from what it was given, the same way every time, so screens
 * and tests can run without a network, a key or a cost. It is never part of
 * a production build, and only the gateway may import it.
 */
import type {
  AIProvider,
  AiRequest,
  Capabilities,
  CardsRequest,
  ConfigCheck,
  ReflectRequest,
  SegmentAlternativesRequest,
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

/** The stand-in provider. Every call is recorded for tests to inspect. */
export class FakeProvider implements AIProvider {
  readonly id = "fake" as const;
  readonly name = "Test provider";
  readonly mark = FAKE_PROVIDER_MARK;
  /** The requests received, in order. */
  readonly calls: AiRequest[] = [];

  capabilities(): Capabilities {
    return CAPABILITIES;
  }

  validateConfig(): Promise<ConfigCheck> {
    return Promise.resolve({ ok: true });
  }

  estimateTokens(request: AiRequest): number {
    // About four characters to a token, which is close enough for a
    // stand-in and never zero for a request with anything in it.
    const text = JSON.stringify(request);
    return Math.ceil(text.length / 4);
  }

  async reflect(
    request: ReflectRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(request);
    return {
      answer: `A test answer about ${String(request.entries.length)} entries.`,
      sources: request.entries.map((entry) => ({
        entryId: entry.id,
        sourceHash: entry.contentHash,
      })),
    };
  }

  async generateCards(
    request: CardsRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(request);
    return {
      cards: request.entries.map((entry) => ({
        text: "A test card.",
        sources: [{ entryId: entry.id, sourceHash: entry.contentHash }],
      })),
    };
  }

  async generateSegmentAlternatives(
    request: SegmentAlternativesRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    await cancelled(signal);
    this.calls.push(request);
    return {
      alternatives: ["A test alternative.", "Another test alternative."],
    };
  }
}
