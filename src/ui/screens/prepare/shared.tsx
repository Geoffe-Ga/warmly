import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { StatusBanner } from "../../components/StatusBanner";

/** What a screen knows about something it asked the store for. */
export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

/**
 * Ask for something when the screen opens, and again when what it depends
 * on changes. An answer that arrives after the screen has moved on is
 * ignored.
 *
 * @param load - Gets the value.
 * @param key - Changes when the value should be fetched again.
 * @returns Where the request stands.
 */
export function useLoaded<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setLoaded({ kind: "loading" });
    load().then(
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
    return () => {
      current = false;
    };
    // `load` is a new function on every render; `key` says when to rerun.
  }, [key]);

  return loaded;
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
