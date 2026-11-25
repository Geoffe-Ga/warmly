import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { formatEntryDate } from "./shared";

/** What the screen has found out about the entry. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "entry"; readonly entry: JournalEntry };

function Answer(props: { readonly text: string }): JSX.Element {
  if (props.text.trim() === "") {
    return <p>Not answered yet.</p>;
  }
  // One paragraph per line the person wrote, so line breaks are kept.
  return (
    <>
      {props.text.split("\n").map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </>
  );
}

/**
 * One journal entry: its date and the three answers under their questions
 * (PRD JR-001). Opening an entry never calls AI. Editing and deleting arrive
 * with later work.
 *
 * @param props - The route's parameters; `id` names the entry.
 * @returns The entry screen.
 */
export function Entry(props: { readonly params: RouteParams }): JSX.Element {
  const { records } = useServices();
  const id = props.params["id"];
  const [found, setFound] = useState<Found>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    const load = (): void => {
      void (
        id === undefined
          ? Promise.resolve(undefined)
          : records.get("journal-entry", id)
      ).then((entry) => {
        if (current) {
          setFound(
            entry === undefined
              ? { kind: "missing" }
              : { kind: "entry", entry },
          );
        }
      });
    };
    load();
    const unsubscribe = records.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [records, id]);

  const back = (
    <p>
      <Link href={pathFor("journal")}>Back to your journal</Link>
    </p>
  );

  if (found.kind !== "entry") {
    return (
      <PageLayout title="Journal entry">
        <StatusBanner
          tone="info"
          label={found.kind === "loading" ? "Loading" : "Not here"}
        >
          {found.kind === "loading"
            ? "Getting your entry."
            : "This entry isn't on this device. It may have been deleted, or Warmly was locked since it was written."}
        </StatusBanner>
        {back}
      </PageLayout>
    );
  }

  const { entry } = found;
  return (
    <PageLayout
      title={formatEntryDate(entry.entryDate)}
      lead={
        entry.status === "draft"
          ? "A draft: not every question is answered yet."
          : "A journal entry."
      }
    >
      {PROMPTS.map((prompt) => (
        <Card key={prompt.key} heading={prompt.label}>
          <Answer text={entry.responses[prompt.key]} />
        </Card>
      ))}
      {back}
    </PageLayout>
  );
}
