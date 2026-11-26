import type { JSX } from "preact";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { Card } from "../../components/Card";
import { PageLayout } from "../../components/PageLayout";
import { DELETING_STATUS } from "../settings/StatusSummary";

/**
 * What Warmly protects, and where that protection ends (PRD SEC-001,
 * OPS-003, §13.9). Each sentence is a claim about the product, so each
 * must stay true: a test pins the words, and changing one means checking
 * that the product still does what it says. Nothing here may promise more
 * than the product does.
 */
export const PRIVACY = [
  {
    heading: "What Warmly's servers cannot read",
    text: "What you write is encrypted on your device before it is saved or synced. Warmly's servers hold it only in that encrypted form and do not have the key, so nobody at Warmly can read your journal, your cards or your reflections.",
  },
  {
    heading: "What Warmly's servers can see",
    text: "Warmly, and the sign-in service it uses, can see that your account exists and the email address you signed up with. Warmly's servers can also see which devices are on your account, how many records you have, how large each one is, what kind of record it is, and when it was changed. They cannot see what any record says.",
  },
  {
    heading: "When you ask AI for something",
    text: "Nothing is sent to an AI provider unless you ask and then agree to what would be sent. When you agree, the entries you were shown go from your device to the AI provider you connected, as readable text. They do not pass through Warmly's servers. What that provider does with them is governed by its own terms, not by Warmly.",
  },
  {
    heading: "When you delete something",
    // The same words as Settings and, in substance, the warning shown
    // before each deletion: one statement, kept in one place.
    text: DELETING_STATUS,
  },
  {
    heading: "When you remove a device",
    text: "A device you remove stops syncing straight away and is signed out the next time it connects. Removing it cannot erase what that device already holds. If it stays offline, it keeps its copy.",
  },
  {
    heading: "If you lose your recovery key",
    text: "Your recovery key, or a device you have already unlocked, is the only way to open your journal on a new device. If you lose the key and every such device, nobody can open your journal again, and Warmly cannot do it for you. Resetting your password does not bring it back.",
  },
  {
    heading: "What encryption cannot protect",
    text: "While Warmly is unlocked, what you write is readable on your device. Someone who can use your unlocked device can read it. So can harmful software on the device, or a browser extension that is allowed to read the pages you visit. Lock Warmly when you step away, and keep extensions you do not trust out of the browser you use it in.",
  },
  {
    heading: "No promise of absolute secrecy",
    text: "No app can promise that. This page says what Warmly does and where its protection ends, so you can decide what to write here.",
  },
] as const;

/**
 * The page that says what is private and what is not (PRD SEC-001). Fixed
 * words only: it shows nothing private, so it can be read signed out,
 * locked or unlocked.
 *
 * @returns The page.
 */
export function Privacy(): JSX.Element {
  return (
    <PageLayout
      title="Privacy and its limits"
      lead="What Warmly keeps private, what it cannot, and what happens to what you write."
    >
      {PRIVACY.map((section) => (
        <Card key={section.heading} heading={section.heading}>
          <p>{section.text}</p>
        </Card>
      ))}
      <p>
        <Link href={pathFor("help")}>What Warmly is and is not</Link>
      </p>
    </PageLayout>
  );
}
