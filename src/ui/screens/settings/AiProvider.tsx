import type { JSX } from "preact";

import { useServices } from "../../../app/services";
import { Card } from "../../components/Card";

/** Said when no provider is connected. */
export const NO_PROVIDER = "No AI provider connected";

/**
 * The AI provider's state, on the Settings screen (PRD AI-001, AI-015).
 *
 * It says which provider, if any, is connected, and what that means for
 * the person's text. It makes no AI call and no network call.
 *
 * @returns The card.
 */
export function AiProviderCard(): JSX.Element {
  const state = useServices().ai.state();
  return (
    <Card heading="AI provider">
      {state.kind === "none" ? (
        <>
          <p>
            <strong>{NO_PROVIDER}</strong>
          </p>
          <p>
            Warmly works without one. Journaling, search and everything you have
            written stay on your devices, encrypted.
          </p>
        </>
      ) : (
        <p>
          <strong>Connected: {state.name}</strong>
          {state.standIn &&
            " (built in for testing; it sends nothing anywhere)"}
        </p>
      )}
      <p>
        Reflect and conversation cards send the journal entries you choose to an
        AI provider as readable text. That only ever happens when you ask, and
        you are shown what will be sent and asked each time.
      </p>
    </Card>
  );
}
