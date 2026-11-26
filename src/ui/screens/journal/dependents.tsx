import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { useServices } from "../../../app/services";
import { DEPENDENCY_RULES } from "../../../domain/dependency-rules";
import { buildIndex } from "../../../domain/deps/index";

/**
 * What is said, before an entry is changed or deleted, about the
 * reflections that were built from it (PRD DEP-003; invariant 6). It must
 * stay true to what the invalidation engine does.
 *
 * @param count - How many reflections were built from the entry.
 * @param doing - What the person is about to do.
 * @param what - Whether it is a journal entry, or something written
 *   after a conversation, which is never called an entry.
 * @returns The sentence, or `undefined` when there are none.
 */
export function dependentsWarning(
  count: number,
  doing: "edit" | "delete",
  what: "entry" | "after" = "entry",
): string | undefined {
  if (count === 0) {
    return undefined;
  }
  // On the screen for something written after a conversation, "reflection"
  // alone could mean that writing, so the answers are named by where they
  // live.
  const from =
    what === "entry"
      ? "from this entry"
      : "in Reflect from what you wrote here";
  const built =
    count === 1
      ? `1 reflection was built ${from}. It`
      : `${count.toLocaleString("en-US")} reflections were built ${from}. They`;
  const when =
    doing === "edit"
      ? "if you change the words of your answers"
      : "when you delete it";
  const said = what === "entry" ? "what the entry said" : "what you wrote";
  return `${built} will be removed ${when}, because an answer may repeat ${said}. Nothing is sent anywhere and nothing is written again.`;
}

/**
 * How many reflections were built from an entry, counted on this device
 * from the records as they are now.
 *
 * @param entryId - The entry.
 * @returns The count; zero until it is known, and if it cannot be read.
 */
export function useDependentCount(entryId: string | undefined): number {
  const { records } = useServices();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      buildIndex(records, DEPENDENCY_RULES).then(
        (index) => {
          if (current) {
            setCount(entryId === undefined ? 0 : index.of(entryId).length);
          }
        },
        () => {
          // Not knowing is not a reason to warn about something untrue.
          if (current) {
            setCount(0);
          }
        },
      );
    };
    load();
    const stop = records.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [records, entryId]);
  return count;
}

/**
 * The warning, as a line on the page.
 *
 * @param props - The entry and what the person is about to do.
 * @returns The line, or nothing when no reflection depends on the entry.
 */
export function DependentsWarning(props: {
  readonly entryId: string | undefined;
  readonly doing: "edit" | "delete";
  readonly what?: "entry" | "after";
}): JSX.Element | null {
  const warning = dependentsWarning(
    useDependentCount(props.entryId),
    props.doing,
    props.what ?? "entry",
  );
  return warning === undefined ? null : <p class="hint">{warning}</p>;
}
