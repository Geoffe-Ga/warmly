/**
 * Application shell for Warmly.
 *
 * This is a framework-free placeholder for the Home screen (PRD UX-001): exactly
 * three primary actions and no unsolicited summaries, scores or AI calls. The UI
 * framework is an open decision to be recorded in an ADR before feature work.
 */

/** One of the three primary Home actions defined by PRD UX-001. */
export interface PrimaryAction {
  readonly id: "journal" | "reflect" | "prepare";
  readonly label: string;
}

/** The three primary Home actions, in the order the PRD specifies. */
export const PRIMARY_ACTIONS: readonly PrimaryAction[] = [
  { id: "journal", label: "Journal" },
  { id: "reflect", label: "Reflect" },
  { id: "prepare", label: "Prepare for a Conversation" },
];

/**
 * Render the application shell into `root`, replacing any existing content.
 *
 * @param root - Container element to render into.
 * @returns The `<main>` landmark that was rendered.
 */
export function renderApp(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;
  const main = doc.createElement("main");
  main.className = "shell";

  const heading = doc.createElement("h1");
  heading.textContent = "Warmly";
  main.append(heading);

  const nav = doc.createElement("nav");
  nav.setAttribute("aria-label", "Primary");
  const list = doc.createElement("ul");
  for (const action of PRIMARY_ACTIONS) {
    const item = doc.createElement("li");
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset["action"] = action.id;
    button.textContent = action.label;
    item.append(button);
    list.append(item);
  }
  nav.append(list);
  main.append(nav);

  root.replaceChildren(main);
  return main;
}
