/**
 * What a screen shows about an AI request: the disclosure, progress with
 * Cancel, and a failure with an explicit Try again (PRD AI-014 to AI-017,
 * SEC-009; AC-15).
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReflectionAnswer } from "../../../src/ai/contracts";
import {
  AI_ERROR_KINDS,
  describeAiError,
  retryNote,
} from "../../../src/ai/errors";
import { FakeProvider } from "../../../src/ai/fake-provider";
import { AiGateway } from "../../../src/ai/gateway";
import type { ReflectRequest } from "../../../src/ai/provider";
import { AiRequestController } from "../../../src/ai/request-controller";
import { ServicesProvider } from "../../../src/app/services";
import { AiRequestStatus } from "../../../src/ui/components/AiRequestStatus";
import { testServices } from "../app/helpers";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function request(): ReflectRequest {
  return {
    kind: "reflect",
    question: "CANARY question",
    entries: [
      {
        id: "entry-1",
        contentHash: "a".repeat(64),
        responses: { good: "CANARY good", improve: "CANARY", loved: "CANARY" },
      },
    ],
  };
}

function show(gateway?: AiGateway): {
  provider: FakeProvider;
  controller: AiRequestController<ReflectRequest, ReflectionAnswer>;
} {
  const provider = new FakeProvider();
  const ai = gateway ?? new AiGateway(provider);
  const controller = new AiRequestController<ReflectRequest, ReflectionAnswer>(
    (asked, consent, signal) => ai.reflect(asked, consent, signal),
  );
  render(
    <ServicesProvider value={{ ...testServices("unlocked"), ai }}>
      <AiRequestStatus controller={controller} />
    </ServicesProvider>,
  );
  return { provider, controller };
}

const SEND = "Send to Test provider";

describe("before anything is sent (SEC-009)", () => {
  it("shows nothing until something is asked", () => {
    show();

    expect(document.body.textContent).toBe("");
  });

  it("opens the disclosure when something is asked, and sends nothing yet", async () => {
    const { controller, provider } = show();

    controller.ask(request());

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("1 journal entry and your question");
    expect(dialog.textContent).not.toContain("CANARY");
    expect(provider.calls).toEqual([]);
  });

  it("Don't send closes the dialog, sends nothing and shows no error", async () => {
    const { controller, provider } = show();
    controller.ask(request());

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Don't send" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(provider.calls).toEqual([]);
    expect(controller.state()).toEqual({ phase: "idle" });
  });
});

describe("while a request runs (AI-016)", () => {
  it("says who is being waited for and offers Cancel, which stops it without an error", async () => {
    const { controller, provider } = show();
    const user = userEvent.setup();
    provider.hangNext();
    controller.ask(request());
    await user.click(await screen.findByRole("button", { name: SEND }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Waiting for Test provider to answer.");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toBe("");
    expect(provider.calls).toHaveLength(1);
  });

  it("shows nothing more once the answer is in: the screen shows the answer itself", async () => {
    const { controller } = show();
    controller.ask(request());

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: SEND }));

    await waitFor(() => {
      expect(controller.state().phase).toBe("done");
    });
    expect(document.body.textContent).toBe("");
  });
});

describe("after a failure (AI-014, AC-15)", () => {
  const SHOWN = AI_ERROR_KINDS.filter(
    (kind) => kind !== "cancelled" && kind !== "too_large" && kind !== "busy",
  );

  it.each(SHOWN)(
    "%s: says what happened, what to do, that nothing was lost, and offers Try again",
    async (kind) => {
      const { controller, provider } = show();
      provider.failNextWith(kind);
      controller.ask(request());

      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: SEND }));

      const alert = await screen.findByRole("alert");
      const said = describeAiError(kind, "Test provider");
      expect(alert.textContent).toContain(said.happened);
      expect(alert.textContent).toContain(said.next);
      expect(alert.textContent).toContain(retryNote("Test provider"));
      expect(alert.textContent).not.toContain("CANARY");
      expect(
        within(alert).getByRole("button", { name: "Try again" }),
      ).toBeTruthy();
      expect(provider.calls).toHaveLength(1);
    },
  );

  it("Try again opens the disclosure again and sends only after a new agreement", async () => {
    const { controller, provider } = show();
    const user = userEvent.setup();
    provider.failNextWith("network");
    controller.ask(request());
    await user.click(await screen.findByRole("button", { name: SEND }));

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    // The dialog is back, the error is gone, and nothing more was sent.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Send this to Test provider?");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(provider.calls).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: SEND }));

    await waitFor(() => {
      expect(controller.state().phase).toBe("done");
    });
    expect(provider.calls).toHaveLength(2);
  });

  it("Try again followed by Don't send sends nothing more", async () => {
    const { controller, provider } = show();
    const user = userEvent.setup();
    provider.failNextWith("provider_error");
    controller.ask(request());
    await user.click(await screen.findByRole("button", { name: SEND }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await user.click(await screen.findByRole("button", { name: "Don't send" }));

    expect(provider.calls).toHaveLength(1);
    expect(controller.inputs).toEqual(request());
  });

  it("with no provider connected, the dialog says nothing can be sent and offers only Close", async () => {
    const { controller } = show(new AiGateway(undefined));
    controller.ask(request());

    const dialog = await screen.findByRole("alertdialog");

    expect(dialog.textContent).toContain("This can't be sent");
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Close" }));
    expect(controller.state()).toEqual({ phase: "idle" });
  });

  it("names the provider generically when none is connected", async () => {
    const provider = new FakeProvider();
    const sending = new AiGateway(provider);
    const controller = new AiRequestController<
      ReflectRequest,
      ReflectionAnswer
    >((asked, consent, signal) => sending.reflect(asked, consent, signal));
    // The screen's own services have no provider, as after one is removed.
    render(
      <ServicesProvider
        value={{ ...testServices("unlocked"), ai: new AiGateway(undefined) }}
      >
        <AiRequestStatus controller={controller} />
      </ServicesProvider>,
    );
    provider.failNextWith("network");
    const asked = request();
    controller.ask(asked);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Close" }));
    // Put it straight into a failed state through the controller.
    controller.ask(asked);
    const { grantConsent } = await import("../../../src/ai/consent");
    await controller.confirm(grantConsent(asked));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Warmly couldn't reach the AI provider.",
    );
  });
});
