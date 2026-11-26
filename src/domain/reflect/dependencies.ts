/**
 * What a Reflect session was built from (PRD DEP-002; decision D-14 as
 * amended by ADR-0010).
 *
 * A session depends on every entry that was sent for any of its answers,
 * whether the answer quoted it or not: an answer can repeat or paraphrase
 * an entry without citing it. If any of them is changed or deleted, the
 * whole session goes, so that no follow-up is left resting on an answer
 * that is no longer there.
 */
import { ruleFor, type DerivedSource } from "../deps/index";
import type { ReflectSession } from "./types";

function sourcesOf(session: ReflectSession): DerivedSource[] {
  const sources: DerivedSource[] = [];
  for (const message of session.messages) {
    if (message.role === "answer") {
      for (const { entryId, sourceHash } of message.answer.sources) {
        sources.push({ entryId, sourceHash });
      }
      // A citation names an entry and its hash as well. Every cited entry
      // was sent, so these repeat the list above; they are read too so
      // that a session is never kept on the strength of a list that was
      // somehow shorter than its own citations.
      for (const citation of message.answer.citations) {
        for (const { entryId, sourceHash } of citation.evidence) {
          sources.push({ entryId, sourceHash });
        }
      }
    }
  }
  return sources;
}

/** The rule for Reflect sessions. */
export const REFLECT_SESSION_RULE = ruleFor("reflect-session", sourcesOf);
