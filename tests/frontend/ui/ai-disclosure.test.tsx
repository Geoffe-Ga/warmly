import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway, ConsentRequiredError } from "../../../src/ai/gateway";
import type { Disclosure } from "../../../src/ai/gateway";
import type { ReflectRequest } from "../../../src/ai/provider";
import {
  AiDisclosureDialog,
  describeSent,
} from "../../../src/ui/components/AiDisclosureDialog";
import { NO_PROVIDER } from "../../../src/ui/screens/settings/AiProvider";
import { renderApp, testServices } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const REQUEST: ReflectRequest = {
  kind: "reflect",
  question: "CANARY question",
  entries: [],
};

const DISCLOSURE: Disclosure = {
  provider: "Example AI",
  entries: 14,
  also: "your question",
  estimatedTokens: 900,
  large: false,
};

function open(
  disclosure: Disclosure = DISCLOSURE,
  request: ReflectRequest = REQUEST,
): {
  confirmed: ReturnType<typeof vi.fn>;
  cancelled: ReturnType<typeof vi.fn>;
} {
  const confirmed = vi.fn();
  const cancelled = vi.fn();
  render(
    <AiDisclosureDialog
      open
      request={request}
      disclosure={disclosure}
      onConfirm={confirmed}
      onCancel={cancelled}
    />,
  );
  return { confirmed, cancelled };
}

describe("what a request sends, in words (AI-015)", () => {
  it.each([
    [0, "your question", "no journal entries and your question"],
    [1, "your topic", "1 journal entry and your topic"],
    [14, "your question", "14 journal entries and your question"],
    [3, "the wording you chose", "3 journal entries and the wording you chose"],
  ] as const)("%i entries with %s", (entries, also, text) => {
    expect(describeSent({ ...DISCLOSURE, entries, also })).toBe(text);
  });
});

describe("the disclosure before anything is sent (SEC-009, AI-015)", () => {
  it("says who it goes to, what is sent, that it is a third party, and that a key does not mean nothing is kept", () => {
    open();

    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByRole("heading").textContent).toBe(
      "Send this to Example AI?",
    );
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("14 journal entries and your question");
    expect(text).toContain("as readable text");
    expect(text).toContain("Example AI is a separate company");
    expect(text).toContain("under its terms and privacy policy, not Warmly's");
    expect(text).toContain("does not mean Example AI keeps nothing");
    expect(text).toContain("you are asked again each time");
  });

  it("shows nothing of what the person wrote", () => {
    open();

    expect(screen.getByRole("alertdialog").textContent).not.toContain("CANARY");
  });

  it("points out a large request and its cost, only when it is one (AI-016)", () => {
    open({ ...DISCLOSURE, large: true, estimatedTokens: 5_200 });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "large request (about 5,200 tokens), which costs more",
    );
    cleanup();

    open();
    expect(screen.getByRole("alertdialog").textContent).not.toContain("large");
  });

  it("starts on the choice that sends nothing", () => {
    open();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Don't send" }),
    );
  });

  it("sends nothing and makes no consent when cancelled, by button or by Escape", async () => {
    const { confirmed, cancelled } = open();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Don't send" }));
    await user.keyboard("{Escape}");

    expect(cancelled).toHaveBeenCalledTimes(2);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("is not shown at all when closed", () => {
    render(
      <AiDisclosureDialog
        open={false}
        request={REQUEST}
        disclosure={DISCLOSURE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("agreeing gives consent that sends this request once, and no other", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const { confirmed } = open(gateway.disclose(REQUEST));

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send to Test provider" }));

    expect(confirmed).toHaveBeenCalledTimes(1);
    const consent = confirmed.mock.calls[0]?.[0] as never;
    const other: ReflectRequest = { ...REQUEST };
    await expect(gateway.reflect(other, consent)).rejects.toThrow(
      ConsentRequiredError,
    );
    expect(provider.calls).toEqual([]);
  });

  it("the consent from the dialog lets the gateway send exactly what was shown", async () => {
    const provider = new FakeProvider();
    const gateway = new AiGateway(provider);
    const { confirmed } = open(gateway.disclose(REQUEST));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send to Test provider" }));
    const consent = confirmed.mock.calls[0]?.[0] as never;

    await gateway.reflect(REQUEST, consent);
    await expect(gateway.reflect(REQUEST, consent)).rejects.toThrow(
      ConsentRequiredError,
    );

    expect(provider.calls).toEqual([REQUEST]);
  });
});

describe("the AI provider on the Settings screen (AI-001, AC-23)", () => {
  it("says no provider is connected in a production build, and that Warmly works without one", async () => {
    vi.stubEnv("MODE", "production");
    const services = testServices("unlocked");

    await renderApp("/settings", services);

    const card = within(
      (await screen.findByRole("heading", { name: "AI provider" })).closest(
        ".card",
      ) as HTMLElement,
    );
    expect(card.getByText(NO_PROVIDER)).toBeTruthy();
    expect(card.getByText(/Warmly works without one/)).toBeTruthy();
    expect(card.getByText(/only ever happens when you ask/)).toBeTruthy();
  });

  it("names the stand-in outside production and says it sends nothing", async () => {
    await renderApp("/settings", testServices("unlocked"));

    const heading = await screen.findByRole("heading", { name: "AI provider" });
    const text = heading.closest(".card")?.textContent ?? "";
    expect(text).toContain("Connected: Test provider");
    expect(text).toContain("it sends nothing anywhere");
    expect(text).not.toContain(NO_PROVIDER);
  });

  it("opening Settings makes no AI call", async () => {
    const provider = new FakeProvider();
    const services = {
      ...testServices("unlocked"),
      ai: new AiGateway(provider),
    };

    await renderApp("/settings", services);
    await screen.findByRole("heading", { name: "AI provider" });

    expect(provider.calls).toEqual([]);
  });
});
