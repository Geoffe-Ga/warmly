/**
 * Building the request for a Reflect question (PRD RF-003, RF-004).
 *
 * The request is made of fresh copies: the entry's ID, its content hash and
 * its three answers, and nothing else about it. The gateway seals a
 * request once it has been shown, and sealing a stored record would freeze
 * something the rest of the app still uses.
 *
 * Which entries fit when the journal is long is decided elsewhere (the
 * context budget). Until then every finished entry is included, and a
 * journal too long for one request is refused whole, with a message, and
 * never cut down quietly.
 */
import type { ReflectRequest, SourceEntry } from "../../ai/provider";
import type { JournalEntry } from "../journal/types";

/** The longest a question may be, in characters. */
export const MAX_QUESTION = 2000;

/** A question was empty or too long. Nothing was sent. */
export class InvalidQuestionError extends Error {
  constructor() {
    super("A question needs some text, up to 2000 characters");
    this.name = "InvalidQuestionError";
  }
}

function sourceOf(entry: JournalEntry): SourceEntry {
  return {
    id: entry.id,
    contentHash: entry.contentHash,
    responses: {
      good: entry.responses.good,
      improve: entry.responses.improve,
      loved: entry.responses.loved,
    },
  };
}

/**
 * Make the request for a question.
 *
 * @param question - The person's own question.
 * @param entries - The journal. Drafts are left out: an unfinished entry
 *   is not sent.
 * @returns The request, oldest entry first.
 * @throws InvalidQuestionError if the question is empty or too long.
 */
export function reflectRequest(
  question: string,
  entries: readonly JournalEntry[],
): ReflectRequest {
  const asked = question.trim();
  if (asked === "" || [...asked].length > MAX_QUESTION) {
    throw new InvalidQuestionError();
  }
  const finished = entries
    .filter((entry) => entry.status === "complete")
    .sort(
      (a, b) =>
        a.entryDate.date.localeCompare(b.entryDate.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  return {
    kind: "reflect",
    question: asked,
    entries: finished.map(sourceOf),
  };
}
