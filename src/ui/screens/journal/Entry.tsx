import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor, type RouteParams } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { PROMPTS, type JournalEntry } from "../../../domain/journal/types";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { CANNOT_OPEN, formatEntryDate } from "./shared";

/** What the screen has found out about the entry. */
type Found =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" }
  | { readonly kind: "entry"; readonly entry: JournalEntry };

/** What is said when there is no entry to show. */
const NOTICES = {
  loading: { tone: "info", label: "Loading", text: "Getting your entry." },
  missing: {
    tone: "info",
    label: "Not here",
    text: "This entry isn't on this device. It may have been deleted, or this version of Warmly may not be able to read it.",
  },
  failed: {
    tone: "error",
    label: "Couldn't open your journal",
    text: CANNOT_OPEN,
  },
} as const;

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
 * One journal entry: its date, the three answers under their questions,
 * and the way to edit it (PRD JR-001, JR-005, JR-006). Opening an entry
 * never calls AI. Deleting arrives with later work.
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
      ).then(
        (entry) => {
          if (current) {
            setFound(
              entry === undefined
                ? { kind: "missing" }
                : { kind: "entry", entry },
            );
          }
        },
        () => {
          if (current) {
            setFound({ kind: "failed" });
          }
        },
      );
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
    const notice = NOTICES[found.kind];
    return (
      <PageLayout title="Journal entry">
        <StatusBanner tone={notice.tone} label={notice.label}>
          {notice.text}
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
      {entry.feelings !== undefined && entry.feelings.length > 0 && (
        <Card heading="Feelings you noted">
          <p>{entry.feelings.join(", ")}</p>
        </Card>
      )}
      <p>
        {entry.status === "draft" ? (
          <Link href={pathFor("journal-new")}>Carry on writing</Link>
        ) : (
          <Link href={pathFor("journal-edit", { id: entry.id })}>
            Edit this entry
          </Link>
        )}
      </p>
      {back}
    </PageLayout>
  );
}
