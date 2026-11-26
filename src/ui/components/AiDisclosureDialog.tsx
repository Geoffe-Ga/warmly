import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";

import { grantConsent, type ConsentToken } from "../../ai/consent";
import type { Disclosure } from "../../ai/gateway";
import { useServices } from "../../app/services";
import type { AiRequest } from "../../ai/provider";
import { ConfirmDialog } from "./ConfirmDialog";

/** Props for {@link AiDisclosureDialog}. */
export interface AiDisclosureDialogProps {
  readonly open: boolean;
  /**
   * The request the person is being asked about. The dialog works out what
   * to say about it from this request and nothing else, so it cannot
   * describe one thing and ask about another. Showing the dialog seals the
   * request: it cannot be changed afterwards.
   */
  readonly request: AiRequest;
  /**
   * Called when the person agrees, with their consent to send this request
   * once.
   */
  readonly onConfirm: (consent: ConsentToken) => void;
  readonly onCancel: () => void;
}

/** What else a follow-up question sends (PRD RF-006). */
export const EARLIER_TURNS =
  "the earlier questions and answers in this reflection";

/** Said when the journal is too long to send whole (PRD RF-004, AC-09). */
export const NOT_EVERYTHING =
  "Your whole journal does not fit in one request. Warmly chose your newest entries, the ones that share words with your question, and a spread of older ones. The answer can only be about the entries that are sent.";

/**
 * Said when entries are left out because each is too long to send at all.
 *
 * @param count - How many such entries there are.
 * @returns The sentence.
 */
export function tooLongNote(count: number): string {
  return count === 1
    ? "1 entry is too long to send in one request, so it is left out. Warmly sends whole entries only, never part of one."
    : `${count.toLocaleString("en-US")} entries are too long to send in one request, so they are left out. Warmly sends whole entries only, never part of one.`;
}

/** Said when a request cannot be described, so cannot be agreed to. */
export const CANNOT_DESCRIBE =
  "Warmly couldn't prepare this request, so nothing was sent. Check in Settings that an AI provider is connected, then try again.";

function entriesText(count: number): string {
  if (count === 0) {
    return "no journal entries";
  }
  return count === 1 ? "1 journal entry" : `${String(count)} journal entries`;
}

function number(count: number): string {
  return count.toLocaleString("en-US");
}

/** The journal entries of a request, and how many were left out. */
function journalText(sent: number, omitted: number): string {
  return omitted > 0
    ? `${number(sent)} of your ${number(sent + omitted)} journal entries`
    : entriesText(sent);
}

/**
 * The notes written after conversations in a request, by their own name:
 * they are never counted as journal entries (PRD PC-004).
 */
function afterText(sent: number, omitted: number): string {
  if (omitted > 0) {
    return `${number(sent)} of your ${number(sent + omitted)} notes written after conversations`;
  }
  return sent === 1
    ? "1 note written after a conversation"
    : `${number(sent)} notes written after conversations`;
}

/** What was written, of either kind, that a request carries. */
function writingText(disclosure: Disclosure): readonly string[] {
  const { after, afterOmitted } = disclosure;
  const journal = journalText(
    disclosure.entries - after,
    disclosure.omitted - afterOmitted,
  );
  if (after + afterOmitted === 0) {
    return [journal];
  }
  const notes = afterText(after, afterOmitted);
  // With no journal entry at all, only the notes are named.
  return disclosure.entries - after + (disclosure.omitted - afterOmitted) === 0
    ? [notes]
    : [journal, notes];
}

/** "a", "a and b", "a, b, and c". */
function listed(parts: readonly string[]): string {
  if (parts.length < 3) {
    return parts.join(" and ");
  }
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1) ?? ""}`;
}

/**
 * Put what a request would send into words.
 *
 * @param disclosure - What the gateway says the request carries.
 * @returns For example "14 journal entries and your question"; when some
 *   did not fit, "14 of your 5,000 journal entries and your question"; and
 *   for a follow-up, "14 journal entries, your question, and the earlier
 *   questions and answers in this reflection". Notes written after
 *   conversations are counted apart: "2 journal entries, 1 note written
 *   after a conversation, and your question".
 */
export function describeSent(disclosure: Disclosure): string {
  return listed([
    ...writingText(disclosure),
    disclosure.also,
    ...(disclosure.earlierTurns > 0 ? [EARLIER_TURNS] : []),
  ]);
}

/**
 * Asks the person, every time, before anything is sent to an AI provider
 * (PRD SEC-009, AI-015).
 *
 * It says who the text goes to, what is being sent, that the provider is a
 * third party with its own terms, and that using your own key does not mean
 * the provider keeps nothing. Agreeing is the only way a request can be
 * sent: the confirm button is the one place a consent token is made, and
 * the token is for this request only and works once. Cancel is the default,
 * and it sends nothing.
 *
 * What it says comes from the gateway's own description of the very
 * request the token is made for, worked out once each time it is shown. If
 * the request cannot be described (no provider is connected, or the
 * provider cannot size it), it says so and offers nothing to agree to. If
 * the provider goes away while the dialog is open, agreeing still makes a
 * token, and the gateway refuses the call when it is made.
 *
 * Each showing makes at most one token, however many times Send is
 * pressed.
 *
 * @param props - See {@link AiDisclosureDialogProps}.
 * @returns The dialog, or `null` when closed.
 */
export function AiDisclosureDialog(
  props: AiDisclosureDialogProps,
): JSX.Element | null {
  const { ai } = useServices();
  const { request, open } = props;
  // Worked out once for each request that is shown, not on every render:
  // a real provider's count may be slow.
  const disclosure = useMemo(() => {
    if (!open) {
      return undefined;
    }
    try {
      return ai.disclose(request);
    } catch {
      // No provider, or the request could not be described. Either way
      // there is nothing the person can safely agree to.
      return "failed" as const;
    }
  }, [ai, request, open]);

  const agreed = useRef(false);
  useEffect(() => {
    // A new showing, or a different request, may be agreed to afresh.
    agreed.current = false;
  }, [request, open]);

  if (disclosure === undefined) {
    return null;
  }
  if (disclosure === "failed") {
    return (
      <ConfirmDialog
        open
        title="This can't be sent"
        cancelLabel="Close"
        onConfirm={props.onCancel}
        onCancel={props.onCancel}
      >
        <p>{CANNOT_DESCRIBE}</p>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      open
      title={`Send this to ${disclosure.provider}?`}
      confirmLabel={`Send to ${disclosure.provider}`}
      cancelLabel="Don't send"
      onCancel={props.onCancel}
      onConfirm={() => {
        // One agreement, one token: a second press before the dialog has
        // closed does nothing.
        if (!agreed.current) {
          agreed.current = true;
          props.onConfirm(grantConsent(request));
        }
      }}
    >
      <p>
        This sends <strong>{describeSent(disclosure)}</strong> to{" "}
        {disclosure.provider}, as readable text.
      </p>
      {disclosure.omitted > disclosure.tooLong && <p>{NOT_EVERYTHING}</p>}
      {disclosure.tooLong > 0 && <p>{tooLongNote(disclosure.tooLong)}</p>}
      {disclosure.large && (
        <p>
          This is a large request (about{" "}
          {disclosure.estimatedTokens.toLocaleString("en-US")} tokens), which
          costs more with your provider.
        </p>
      )}
      <p>
        {disclosure.provider} is a separate company. What you send is handled
        under its terms and privacy policy, not Warmly's. Using your own key
        does not mean {disclosure.provider} keeps nothing.
      </p>
      <p>
        Nothing is sent unless you choose Send. It is sent once, and you are
        asked again each time.
      </p>
    </ConfirmDialog>
  );
}
