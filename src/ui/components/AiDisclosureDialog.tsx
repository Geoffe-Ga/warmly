import type { JSX } from "preact";
import { useMemo } from "preact/hooks";

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

/** Said when a request cannot be described, so cannot be agreed to. */
export const CANNOT_DESCRIBE =
  "Warmly couldn't prepare this request, so nothing was sent. Check in Settings that an AI provider is connected, then try again.";

function entriesText(count: number): string {
  if (count === 0) {
    return "no journal entries";
  }
  return count === 1 ? "1 journal entry" : `${String(count)} journal entries`;
}

/**
 * Put what a request would send into words.
 *
 * @param disclosure - What the gateway says the request carries.
 * @returns For example "14 journal entries and your question".
 */
export function describeSent(disclosure: Disclosure): string {
  return `${entriesText(disclosure.entries)} and ${disclosure.also}`;
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
 * request the token is made for.
 *
 * @param props - See {@link AiDisclosureDialogProps}.
 * @returns The dialog, or `null` when closed.
 * If the request cannot be described (no provider is connected, or the
 * provider cannot size it), it says so and offers nothing to agree to.
 *
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
        props.onConfirm(grantConsent(request));
      }}
    >
      <p>
        This sends <strong>{describeSent(disclosure)}</strong> to{" "}
        {disclosure.provider}, as readable text.
      </p>
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
