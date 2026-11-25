import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { createCollection } from "../../../domain/cards/collections";
import type { CardCollection } from "../../../domain/cards/types";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import {
  ChangeError,
  FailedNotice,
  LoadingNotice,
  useChange,
  useLoaded,
} from "./shared";

function countLabel(count: number): string {
  return count === 1 ? "1 card" : `${String(count)} cards`;
}

function CollectionList(props: {
  readonly collections: readonly CardCollection[];
}): JSX.Element {
  if (props.collections.length === 0) {
    return <p>You have no collections yet.</p>;
  }
  return (
    <nav aria-label="Your collections">
      <ul class="action-list">
        {props.collections.map((collection) => (
          <li key={collection.id}>
            <Link
              href={pathFor("collection", { id: collection.id })}
              class="action"
            >
              {collection.name}
              <span class="action__detail">
                {countLabel(collection.cardIds.length)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NewCollection(): JSX.Element {
  const { records } = useServices();
  const change = useChange();
  const [name, setName] = useState("");
  const [made, setMade] = useState("");

  return (
    <Card heading="Start a new collection">
      <form
        class="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setMade("");
          change.run(async () => {
            await createCollection({ records }, name);
            // Only once it is stored is what was typed cleared.
            setName("");
            setMade("Collection created.");
          });
        }}
      >
        <TextField
          label="Name"
          hint="For example, who or what the conversation is about. Only you see it."
          value={name}
          onInput={setName}
        />
        <ChangeError change={change} />
        <p role="status" class="hint">
          {made}
        </p>
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={change.busy}>
            Create collection
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Prepare for a Conversation: the person's private collections of cards,
 * and the way to start a new one (PRD CC-001). Nothing here calls AI.
 *
 * @returns The collections screen.
 */
export function Collections(): JSX.Element {
  const { cards } = useServices();
  const loaded = useLoaded(() => cards.collections(), "collections", cards);

  return (
    <PageLayout
      title="Prepare for a Conversation"
      lead="Cards hold what you want to say, in your words. They are private to you."
    >
      {loaded.kind === "loading" && <LoadingNotice />}
      {loaded.kind === "failed" && <FailedNotice />}
      {loaded.kind === "ready" && <CollectionList collections={loaded.value} />}
      <NewCollection />
    </PageLayout>
  );
}
