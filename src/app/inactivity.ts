/**
 * The inactivity lock's clock (PRD DEV-005, AC-21).
 *
 * Inactivity is measured from the last user input, in wall-clock time. A
 * timer alone is not enough: a browser suspends timers in a background tab or
 * a sleeping device, so the elapsed time is also checked whenever the page
 * becomes visible again. A tab that slept through the limit locks on resume.
 */

/** How long the app may sit unused before it locks: 30 minutes. */
export const INACTIVITY_LIMIT_MS = 30 * 60_000;

/** Input that counts as the user being present. */
const INPUT_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "input",
] as const;

/** What {@link watchInactivity} needs from its surroundings. */
export interface InactivityOptions {
  /** Called once when the limit is reached. The watch then stops. */
  readonly onIdle: () => void;
  /** The idle limit in milliseconds. Defaults to 30 minutes. */
  readonly limitMs?: number;
  /** Wall-clock time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Where input events are heard. Defaults to `window`. */
  readonly target?: EventTarget;
  /** The document whose visibility is watched. Defaults to `document`. */
  readonly page?: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
}

/** A running inactivity watch. */
export interface InactivityWatch {
  /** Stop watching and release every listener and timer. */
  stop(): void;
}

/**
 * Call `onIdle` once the user has given no input for the limit.
 *
 * Each input only records a timestamp, so typing costs nothing. The timer
 * re-arms itself for whatever time remains when it fires.
 *
 * @param options - See {@link InactivityOptions}.
 * @returns A handle that stops the watch.
 */
export function watchInactivity(options: InactivityOptions): InactivityWatch {
  const limit = options.limitMs ?? INACTIVITY_LIMIT_MS;
  const now = options.now ?? (() => Date.now());
  const target = options.target ?? window;
  const page = options.page ?? document;
  let lastInput = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    clearTimeout(timer);
    for (const name of INPUT_EVENTS) {
      target.removeEventListener(name, onInput);
    }
    page.removeEventListener("visibilitychange", check);
  };

  function check(): void {
    if (stopped) {
      return;
    }
    clearTimeout(timer);
    const elapsed = now() - lastInput;
    const remaining = limit - elapsed;
    // A clock that has gone backwards cannot be trusted to measure the
    // limit, so it counts as idle. Locking early is the safe mistake.
    if (remaining <= 0 || elapsed < 0) {
      stop();
      options.onIdle();
      return;
    }
    timer = setTimeout(check, remaining);
  }

  function onInput(): void {
    lastInput = now();
  }

  for (const name of INPUT_EVENTS) {
    target.addEventListener(name, onInput, { passive: true });
  }
  page.addEventListener("visibilitychange", check);
  check();
  return { stop };
}
