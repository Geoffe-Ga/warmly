import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

import {
  InvalidCardTextError,
  MAX_CARD_TEXT,
} from "../../../domain/cards/cards";
import {
  InvalidNameError,
  MAX_COLLECTION_NAME,
} from "../../../domain/cards/collections";
import { CARD_TYPE_LABELS, type CardType } from "../../../domain/cards/types";
import { StaleRecordError } from "../../../storage/record-store";
import { StatusBanner } from "../../components/StatusBanner";
import { describeStorageError } from "../../storage-messages";

/** What a screen knows about something it asked the store for. */
export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

/**
 * Ask for something when the screen opens, again when what it depends on
 * changes, and again whenever the store says its contents may have changed
 * (a change made here, in another tab, or by sync). An answer that arrives
 * after the screen has moved on is ignored. What is shown stays on screen
 * while a newer answer is fetched.
 *
 * @param load - Gets the value.
 * @param key - Changes when a different value is wanted.
 * @param source - Says when the value may have changed. Pass the same
 *   object every time: a new one starts over.
 * @returns Where the request stands.
 */
export function useLoaded<T>(
  load: () => Promise<T>,
  key: string,
  source?: { subscribe(listener: () => void): () => void },
): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ kind: "loading" });
  // Always the newest `load`, without making the effect depend on it.
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    let current = true;
    const fetch = (): void => {
      latest.current().then(
        (value) => {
          if (current) {
            setLoaded({ kind: "ready", value });
          }
        },
        () => {
          if (current) {
            setLoaded({ kind: "failed" });
          }
        },
      );
    };
    setLoaded({ kind: "loading" });
    fetch();
    const stop = source?.subscribe(fetch);
    return () => {
      current = false;
      stop?.();
    };
  }, [key, source]);

  return loaded;
}

/** Said when a change could not be stored, for a reason not understood. */
export const NOT_SAVED =
  "Warmly couldn't save that. Nothing was changed. Try again in a moment.";

/** Said when what was on screen was out of date. */
export const OUT_OF_DATE =
  "This was changed somewhere else since you opened it, so nothing was saved over it. The newest version is shown now. Check it, then try again.";

/** Said when a collection's name is empty or too long. */
export const NAME_NEEDED = `Give the collection a name of up to ${String(MAX_COLLECTION_NAME)} characters.`;

/** Said when a card's text is empty or too long. */
export const TEXT_NEEDED = `Write something for the card, up to ${MAX_CARD_TEXT.toLocaleString("en-US")} characters.`;

function describeChangeError(error: unknown): string {
  if (error instanceof InvalidNameError) {
    return NAME_NEEDED;
  }
  if (error instanceof InvalidCardTextError) {
    return TEXT_NEEDED;
  }
  if (error instanceof StaleRecordError) {
    return OUT_OF_DATE;
  }
  // Never the error's own text: it may hold what the person wrote.
  return describeStorageError(error, "save") ?? NOT_SAVED;
}

/** One change being made from a screen. */
export interface Change {
  /** True while the change is being stored. */
  readonly busy: boolean;
  /** What to say if the last change failed. */
  readonly error: string | undefined;
  /**
   * Make a change. A failure is caught and put into words. A second call
   * while one is running is ignored, so a double press cannot repeat it.
   *
   * @param work - Stores the change.
   */
  readonly run: (work: () => Promise<void>) => void;
}

/**
 * Track changes made from a screen: busy while one is stored, a message if
 * it fails. What the person typed is the screen's to keep; nothing here
 * clears it.
 *
 * @returns The state and the `run` function.
 */
export function useChange(): Change {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);

  const run = (work: () => Promise<void>): void => {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(true);
    setError(undefined);
    work()
      .catch((caught: unknown) => {
        setError(describeChangeError(caught));
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };

  return { busy, error, run };
}

/** Shows what went wrong with the last change, if anything did. */
export function ChangeError(props: {
  readonly change: Change;
}): JSX.Element | null {
  return props.change.error === undefined ? null : (
    <StatusBanner tone="error" label="Not saved">
      {props.change.error}
    </StatusBanner>
  );
}

const CARD_TYPES_IN_ORDER: readonly CardType[] = [
  "appreciation",
  "need_request",
  "curiosity",
  "other",
];

/**
 * Lets the person say what kind of card this is. It is a label for them:
 * nothing reads it to judge the card.
 *
 * @param props - The chosen kind and what to do when it changes.
 * @returns A group of radio buttons.
 */
export function CardTypePicker(props: {
  readonly value: CardType;
  readonly onChange: (type: CardType) => void;
}): JSX.Element {
  const name = useId();
  return (
    <fieldset class="choices">
      <legend class="field__label">What kind of card is it?</legend>
      <ul class="choices__list">
        {CARD_TYPES_IN_ORDER.map((type) => (
          <li key={type}>
            <label class="choices__option">
              <input
                type="radio"
                name={name}
                value={type}
                checked={props.value === type}
                onChange={() => {
                  props.onChange(type);
                }}
              />
              <span>{CARD_TYPE_LABELS[type]}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Said while cards are being fetched. */
export function LoadingNotice(): JSX.Element {
  return (
    <StatusBanner tone="info" label="Loading">
      Getting your cards.
    </StatusBanner>
  );
}

/** Said when cards could not be fetched. Never the underlying error. */
export function FailedNotice(): JSX.Element {
  return (
    <StatusBanner tone="error" label="Couldn't open your cards">
      Nothing was changed. Try again in a moment.
    </StatusBanner>
  );
}

/** Said when a link leads to a collection or card that is not here. */
export function MissingNotice(props: {
  readonly what: "collection" | "card";
}): JSX.Element {
  return (
    <StatusBanner tone="info" label="Not here">
      This {props.what} isn't on this device. It may have been deleted.
    </StatusBanner>
  );
}
