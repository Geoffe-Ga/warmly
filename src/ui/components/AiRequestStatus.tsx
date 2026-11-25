import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { describeAiError, retryNote } from "../../ai/errors";
import type {
  AiRequestController,
  AiRequestState,
} from "../../ai/request-controller";
import type { AiRequest } from "../../ai/provider";
import { useServices } from "../../app/services";
import { AiDisclosureDialog } from "./AiDisclosureDialog";
import { Button } from "./Button";
import { StatusBanner } from "./StatusBanner";

/** Said when no provider is connected and one has to be named. */
const SOME_PROVIDER = "the AI provider";

/**
 * Follow a controller's state from a component.
 *
 * @param controller - The operation to follow.
 * @returns Its current state, kept up to date.
 */
export function useAiRequest<R extends AiRequest, T>(
  controller: AiRequestController<R, T>,
): AiRequestState<R, T> {
  const [state, setState] = useState(() => controller.state());
  useEffect(() => {
    setState(controller.state());
    return controller.subscribe(() => {
      setState(controller.state());
    });
  }, [controller]);
  return state;
}

/**
 * Everything a screen shows about an AI request other than its answer (PRD
 * AI-014 to AI-017, SEC-009; AC-15):
 *
 * - the disclosure dialog, whenever the controller is waiting for consent;
 * - while the request runs, that it is running and a Cancel button;
 * - after a failure, what happened, what to do next and a Try again
 *   button, which opens the disclosure dialog again.
 *
 * It never sends anything itself and has no timer. A cancelled request
 * shows nothing.
 *
 * @param props - The controller for the operation.
 * @returns The dialog and the status, or nothing when there is neither.
 */
export function AiRequestStatus<R extends AiRequest, T>(props: {
  readonly controller: AiRequestController<R, T>;
}): JSX.Element | null {
  const { ai } = useServices();
  const { controller } = props;
  const state = useAiRequest(controller);
  const connected = ai.state();
  const provider =
    connected.kind === "connected" ? connected.name : SOME_PROVIDER;

  if (state.phase === "awaiting-consent") {
    return (
      <AiDisclosureDialog
        open
        request={state.request}
        onConfirm={(consent) => {
          void controller.confirm(consent);
        }}
        onCancel={() => {
          controller.decline();
        }}
      />
    );
  }
  if (state.phase === "running") {
    return (
      <div class="ai-request">
        <p role="status">Waiting for {provider} to answer.</p>
        <Button
          onClick={() => {
            controller.cancel();
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }
  if (state.phase === "failed") {
    const said = describeAiError(state.error, provider);
    return (
      <StatusBanner tone="error" label="No answer">
        {said.happened} {said.next}
        <span class="ai-request__note">{retryNote(provider)}</span>
        <div class="button-row">
          <Button
            onClick={() => {
              controller.retry();
            }}
          >
            Try again
          </Button>
        </div>
      </StatusBanner>
    );
  }
  return null;
}
