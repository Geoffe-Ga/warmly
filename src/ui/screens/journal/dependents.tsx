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
 * @param cards - How many cards drafted by AI, and not yet changed by the
 *   person, were built from it.
 * @returns The sentence, or `undefined` when there are none.
 */
export function dependentsWarning(
  count: number,
  doing: "edit" | "delete",
  what: "entry" | "after" = "entry",
  cards = 0,
): string | undefined {
  const total = count + cards;
  if (total === 0) {
    return undefined;
  }
  // On the screen for something written after a conversation, "reflection"
  // alone could mean that writing, so the answers are named by where they
  // live.
  const from =
    what === "entry"
      ? "from this entry"
      : "in Reflect from what you wrote here";
  const things = [
    counted(count, "reflection", "reflections"),
    counted(cards, "card drafted by AI", "cards drafted by AI"),
  ]
    .filter((each) => each !== undefined)
    .join(" and ");
  const one = total === 1;
  const built = `${things} ${one ? "was" : "were"} built ${from}. ${one ? "It" : "They"}`;
  const when =
    doing === "edit"
      ? "if you change the words of your answers"
      : "when you delete it";
  const said = what === "entry" ? "what the entry said" : "what you wrote";
  return `${built} will be removed ${when}, because ${because(count, cards)} may repeat ${said}. Nothing is sent anywhere and nothing is written again.`;
}

/** "1 reflection", "3 reflections", or nothing when there are none. */
function counted(count: number, one: string, many: string): string | undefined {
  if (count === 0) {
    return undefined;
  }
  return count === 1 ? `1 ${one}` : `${count.toLocaleString("en-US")} ${many}`;
}

/** What may repeat the entry's words: an answer, a card, or both. */
function because(reflections: number, cards: number): string {
  if (cards === 0) {
    return "an answer";
  }
  if (reflections === 0) {
    return cards === 1 ? "it" : "they";
  }
  return "they";
}

/** How many of each kind of thing were built from an entry. */
export interface DependentCounts {
  readonly reflections: number;
  readonly cards: number;
}

const NONE: DependentCounts = { reflections: 0, cards: 0 };

/**
 * How many reflections and AI cards were built from an entry, counted on this device
 * from the records as they are now.
 *
 * @param entryId - The entry.
 * @returns The counts; zero until they are known, and if they cannot be
 *   read.
 */
export function useDependentCount(
  entryId: string | undefined,
): DependentCounts {
  const { records } = useServices();
  const [count, setCount] = useState<DependentCounts>(NONE);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      buildIndex(records, DEPENDENCY_RULES).then(
        (index) => {
          if (current) {
            const built = entryId === undefined ? [] : index.of(entryId);
            const cards = built.filter(
              (each) => each.kind === "conversation-card",
            ).length;
            setCount({ reflections: built.length - cards, cards });
          }
        },
        () => {
          // Not knowing is not a reason to warn about something untrue.
          if (current) {
            setCount(NONE);
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
  const built = useDependentCount(props.entryId);
  const warning = dependentsWarning(
    built.reflections,
    props.doing,
    props.what ?? "entry",
    built.cards,
  );
  return warning === undefined ? null : <p class="hint">{warning}</p>;
}
