/**
 * Stopping the wait for something that may not stop by itself (PRD
 * AI-016).
 *
 * A provider is asked to honour the signal it is given, but the app does
 * not depend on it: when the signal fires, the wait ends at once, whatever
 * the provider does. Anything the provider returns afterwards is ignored.
 */

/**
 * Wait for a result, but no longer than a signal allows.
 *
 * @param work - What is being waited for.
 * @param signal - Ends the wait when it fires.
 * @returns What the work resolved to.
 * @throws What the work rejected with, or an `AbortError` as soon as the
 *   signal fires (at once, if it already has).
 */
export function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      reject(new DOMException("The request was stopped", "AbortError"));
    };
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener("abort", stop, { once: true });
    }
    // Settling twice does nothing, so a late answer or a late failure
    // after the wait has ended is dropped here.
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", stop);
    });
  });
}
