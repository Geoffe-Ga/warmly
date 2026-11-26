/**
 * One AI operation from start to finish (PRD AI-014, AI-016, AI-017;
 * AC-15).
 *
 * Every screen that asks AI for something uses one of these, so that all
 * of them behave the same way:
 *
 * - **Nothing is lost.** The controller holds the request (the question,
 *   the chosen entries) for the whole operation. A failure or a cancel
 *   leaves it there to try again with.
 * - **Nothing is automatic.** A request is sent only after the person
 *   agrees in the disclosure dialog. After a failure the controller does
 *   nothing until the person presses Try again, which opens the dialog
 *   again and needs new consent. There is no timer that retries, no
 *   backoff and no second provider.
 * - **Waiting has an end.** A request that takes too long is stopped. The
 *   person can stop one themselves at any time; that is not an error.
 *
 * The phases are `idle`, `awaiting-consent`, `running`, `failed` and
 * `done`.
 */
import { untilAborted } from "./abort";
import { REQUEST_TIMEOUT_MS } from "./config";
import { classifyAiError, type AiErrorKind } from "./errors";
import type { ConsentToken } from "./gateway";
import type { AiRequest } from "./provider";

/** Where an operation stands. */
export type AiRequestState<R extends AiRequest, T> =
  /** Nothing has been asked, or the last request was cancelled. */
  | { readonly phase: "idle" }
  /** The disclosure dialog is open for this request. */
  | { readonly phase: "awaiting-consent"; readonly request: R }
  /** The request has been sent and no answer has come yet. */
  | { readonly phase: "running"; readonly request: R }
  /** The request failed. Nothing happens until the person acts. */
  | {
      readonly phase: "failed";
      readonly request: R;
      readonly error: Exclude<AiErrorKind, "cancelled">;
    }
  /** A checked answer came back. */
  | { readonly phase: "done"; readonly request: R; readonly result: T };

/** Sends a request through the gateway. */
export type Send<R extends AiRequest, T> = (
  request: R,
  consent: ConsentToken,
  signal: AbortSignal,
) => Promise<T>;

/** Why a running request was stopped. */
type Stopped = "cancelled" | "timeout";

/** Runs one kind of AI operation for one screen. */
export class AiRequestController<R extends AiRequest, T> {
  readonly #send: Send<R, T>;
  readonly #timeoutMs: number;
  readonly #listeners = new Set<() => void>();
  #state: AiRequestState<R, T> = { phase: "idle" };
  #inputs: R | undefined;
  #abort: AbortController | undefined;
  #stopped: Stopped | undefined;
  /** Changes with every run, so a late answer to an old run is ignored. */
  #run = 0;

  /**
   * @param send - Sends a request through the gateway, for example
   *   `(request, consent, signal) => ai.reflect(request, consent, signal)`.
   * @param timeoutMs - How long to wait for an answer.
   */
  constructor(send: Send<R, T>, timeoutMs: number = REQUEST_TIMEOUT_MS) {
    this.#send = send;
    this.#timeoutMs = timeoutMs;
  }

  /** @returns Where the operation stands. */
  state(): AiRequestState<R, T> {
    return this.#state;
  }

  /**
   * The request the person last asked for, kept through failure and
   * cancellation so nothing has to be typed or chosen again.
   */
  get inputs(): R | undefined {
    return this.#inputs;
  }

  /**
   * Be told when the state changes.
   *
   * @returns A function that stops the listener being called.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #set(state: AiRequestState<R, T>): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  /**
   * Start an operation: open the disclosure dialog for a request. Nothing
   * is sent. Ignored while a request is running.
   *
   * @param request - What the person wants to send.
   */
  ask(request: R): void {
    if (this.#state.phase === "running") {
      return;
    }
    this.#inputs = request;
    this.#set({ phase: "awaiting-consent", request });
  }

  /**
   * The person chose not to send. Nothing was sent and nothing is shown as
   * an error. The request is kept in {@link AiRequestController.inputs}.
   */
  decline(): void {
    if (this.#state.phase === "awaiting-consent") {
      this.#set({ phase: "idle" });
    }
  }

  /**
   * The person agreed: send the request, once.
   *
   * @param consent - Their agreement, from the disclosure dialog.
   * @returns When the request has finished, failed or been stopped. It
   *   never rejects; the outcome is in {@link AiRequestController.state}.
   */
  async confirm(consent: ConsentToken): Promise<void> {
    if (this.#state.phase !== "awaiting-consent") {
      return;
    }
    const { request } = this.#state;
    const abort = new AbortController();
    this.#run += 1;
    const run = this.#run;
    this.#abort = abort;
    this.#stopped = undefined;
    this.#set({ phase: "running", request });
    const timer = setTimeout(() => {
      this.#stop("timeout");
    }, this.#timeoutMs);
    try {
      // The wait ends when the request is stopped, even if the provider
      // never answers: Cancel and the time limit do not depend on it.
      const result = await untilAborted(
        this.#send(request, consent, abort.signal),
        abort.signal,
      );
      if (run === this.#run) {
        this.#set({ phase: "done", request, result });
      }
    } catch (error) {
      if (run === this.#run) {
        this.#failed(request, error);
      }
    } finally {
      clearTimeout(timer);
      if (run === this.#run) {
        this.#abort = undefined;
      }
    }
  }

  #failed(request: R, error: unknown): void {
    // Why it stopped is known here, whatever the provider threw when its
    // request was aborted. A request that was cut off without the person
    // or the time limit stopping it is a failure, and is shown as one.
    const thrown = classifyAiError(error);
    const kind = this.#stopped ?? (thrown === "cancelled" ? "network" : thrown);
    this.#set(
      kind === "cancelled"
        ? { phase: "idle" }
        : { phase: "failed", request, error: kind },
    );
  }

  #stop(why: Stopped): void {
    if (this.#state.phase === "running" && this.#stopped === undefined) {
      this.#stopped = why;
      this.#abort?.abort();
    }
  }

  /**
   * The person stopped a running request. The request in flight is
   * aborted. This is not an error and shows none.
   */
  cancel(): void {
    this.#stop("cancelled");
  }

  /**
   * The person asked to try again after a failure: open the disclosure
   * dialog again for the same request. Nothing is sent until they agree
   * again.
   */
  retry(): void {
    if (this.#state.phase === "failed") {
      this.#set({ phase: "awaiting-consent", request: this.#state.request });
    }
  }

  /**
   * Put the operation away: stop anything running and forget the request
   * and the answer. Called when the screen closes or the app locks, so
   * nothing private stays here.
   */
  reset(): void {
    this.#run += 1;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#stopped = undefined;
    this.#inputs = undefined;
    this.#set({ phase: "idle" });
  }
}
