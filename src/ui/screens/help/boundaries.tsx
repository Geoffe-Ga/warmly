import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";

/**
 * What Warmly is not, in a sentence each (PRD §0, RF-012, RF-013). These
 * are promises about the product, so each must stay true: a test pins the
 * words, and changing one means checking the product still keeps it.
 */
export const BOUNDARIES = [
  {
    heading: "Not therapy",
    text: "Warmly is not a therapist or counsellor and does not replace one. Nothing it shows you is clinical advice, and it does not diagnose you, your partner or your relationship.",
  },
  {
    heading: "Not a medical or crisis service",
    text: "Warmly cannot help in an emergency and nobody at Warmly reads what you write. It does not watch your journal for signs of crisis: your writing is encrypted on your device and there is no monitoring of any kind.",
  },
  {
    heading: "Not a judge of who is right",
    text: "Warmly does not decide who is right, score your relationship or tell you whether to stay or leave. Your journal is your own account of your own experience.",
  },
  {
    heading: "A fallible aid",
    text: "When you choose to ask a question, the answer is written by an AI provider you connected. It can be wrong, it can miss things, and it only knows the entries that were sent. Where it suggests how you or your partner might feel, that is a possibility to check with them, not a fact.",
  },
] as const;

/** What to do when someone is in danger. General guidance, not a service. */
export const IN_DANGER =
  "If you or someone else is in danger, or you are afraid for your safety, contact your local emergency services now. If you are struggling and it is not an emergency, a doctor, a counsellor or a local support line can help in ways this app cannot.";

/** What the app's own checks can and cannot show (PRD §13.9). */
export const WHAT_IS_CHECKED =
  "Warmly checks what it controls: nothing is sent until you agree, an answer is shown only if every quote in it is really in the entries that were sent, and answers are removed when the entries they were built from change. No test can prove how an AI model will behave, so read its answers as suggestions.";

/**
 * A short line for sign-up and for Reflect, pointing at the full page.
 *
 * @returns The line with its link.
 */
export function BoundaryNotice(): JSX.Element {
  return (
    <p class="hint">
      Warmly is a private journal and a memory aid. It is not therapy, a medical
      or crisis service, or a judge of who is right.{" "}
      <Link href={pathFor("help")}>What Warmly is and is not</Link>
    </p>
  );
}

/**
 * The help page that says what the product is not (PRD RF-012, RF-013).
 * Fixed words only: it shows nothing private, so it can be read signed
 * out, locked or unlocked.
 *
 * @returns The page.
 */
export function Boundaries(): JSX.Element {
  return (
    <PageLayout
      title="What Warmly is and is not"
      lead="Warmly is a private journal about your own relationship, and a way to prepare for calm conversations. It is a memory aid."
    >
      {BOUNDARIES.map((boundary) => (
        <Card key={boundary.heading} heading={boundary.heading}>
          <p>{boundary.text}</p>
        </Card>
      ))}
      <Card heading="If you are in danger">
        <p>{IN_DANGER}</p>
      </Card>
      <Card heading="What Warmly checks, and what it cannot">
        <p>{WHAT_IS_CHECKED}</p>
      </Card>
    </PageLayout>
  );
}
