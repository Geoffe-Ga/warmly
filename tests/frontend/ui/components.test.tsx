import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../../../src/ui/components/Button";
import { Card } from "../../../src/ui/components/Card";
import { ConfirmDialog } from "../../../src/ui/components/ConfirmDialog";
import { TextArea, TextField } from "../../../src/ui/components/Field";
import { PageLayout } from "../../../src/ui/components/PageLayout";
import {
  StatusBanner,
  type StatusTone,
} from "../../../src/ui/components/StatusBanner";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("never submits a form unless asked to", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "type",
      "button",
    );
  });

  it("can be a submit button", () => {
    render(<Button type="submit">Save</Button>);

    expect(screen.getByRole("button")).toHaveProperty("type", "submit");
  });

  it.each(["primary", "secondary", "danger"] as const)(
    "applies the %s variant",
    (variant) => {
      render(<Button variant={variant}>Go</Button>);

      expect(screen.getByRole("button").className).toBe(
        `button button--${variant}`,
      );
    },
  );

  it("defaults to the secondary variant", () => {
    render(<Button>Go</Button>);

    expect(screen.getByRole("button").className).toContain("button--secondary");
  });

  it("calls onClick when activated by mouse or keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button"));
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("stays focusable but inert when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button");

    await userEvent.click(button);
    button.focus();

    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
  });

  it("does nothing when clicked without a handler", async () => {
    render(<Button>Go</Button>);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBeNull();
  });
});

describe.each([
  ["TextField", TextField, "textbox"],
  ["TextArea", TextArea, "textbox"],
] as const)("%s", (_name, Field, role) => {
  it("links its label to the control", () => {
    render(<Field label="Your answer" value="" onInput={() => undefined} />);

    expect(screen.getByLabelText("Your answer")).toBe(screen.getByRole(role));
  });

  it("reports each edit", async () => {
    function Harness(): preact.JSX.Element {
      const [value, setValue] = useState("");
      return <Field label="Your answer" value={value} onInput={setValue} />;
    }
    render(<Harness />);

    await userEvent.type(screen.getByRole(role), "hello");

    expect(screen.getByRole(role)).toHaveProperty("value", "hello");
  });

  it("has no description and is not invalid by default", () => {
    render(<Field label="Your answer" value="" onInput={() => undefined} />);
    const control = screen.getByRole(role);

    expect(control.getAttribute("aria-describedby")).toBeNull();
    expect(control.getAttribute("aria-invalid")).toBeNull();
    expect(control).toHaveProperty("required", false);
  });

  it("describes the control with its hint", () => {
    render(
      <Field
        label="Your answer"
        hint="Any length is fine."
        value=""
        onInput={() => undefined}
      />,
    );
    const control = screen.getByRole(role);
    const hint = screen.getByText("Any length is fine.");

    expect(control.getAttribute("aria-describedby")).toBe(hint.id);
    expect(control.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the control invalid and describes it with hint then error", () => {
    render(
      <Field
        label="Your answer"
        hint="Any length is fine."
        error="Write something here to finish."
        required
        value=""
        onInput={() => undefined}
      />,
    );
    const control = screen.getByRole(role);
    const hint = screen.getByText("Any length is fine.");
    const error = screen.getByText("Write something here to finish.");

    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toBe(
      `${hint.id} ${error.id}`,
    );
    expect(control).toHaveProperty("required", true);
  });

  it("gives two fields on one screen different ids", () => {
    render(
      <>
        <Field label="First" value="" onInput={() => undefined} />
        <Field label="Second" value="" onInput={() => undefined} />
      </>,
    );

    expect(screen.getByLabelText("First").id).not.toBe(
      screen.getByLabelText("Second").id,
    );
  });
});

describe("TextField", () => {
  it.each(["email", "password"] as const)("supports type %s", (type) => {
    render(
      <TextField
        label="Value"
        type={type}
        autocomplete="off"
        name="value"
        value=""
        onInput={() => undefined}
      />,
    );
    const control = screen.getByLabelText("Value");

    expect(control).toHaveProperty("type", type);
    expect(control.getAttribute("autocomplete")).toBe("off");
    expect(control.getAttribute("name")).toBe("value");
  });

  it("defaults to a text input", () => {
    render(<TextField label="Value" value="" onInput={() => undefined} />);

    expect(screen.getByLabelText("Value")).toHaveProperty("type", "text");
  });
});

describe("TextArea", () => {
  it("uses the requested number of rows, four by default", () => {
    render(
      <>
        <TextArea label="Short" value="" onInput={() => undefined} />
        <TextArea label="Long" rows={9} value="" onInput={() => undefined} />
      </>,
    );

    expect(screen.getByLabelText("Short")).toHaveProperty("rows", 4);
    expect(screen.getByLabelText("Long")).toHaveProperty("rows", 9);
  });
});

describe("Card", () => {
  it("renders its heading as an h2", () => {
    render(<Card heading="Buttons">Body</Card>);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Buttons",
    );
  });

  it("renders without a heading", () => {
    render(<Card>Body</Card>);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Body")).toBeDefined();
  });
});

describe("StatusBanner", () => {
  it.each([
    ["info", "status"],
    ["success", "status"],
    ["warning", "status"],
    ["error", "alert"],
  ] as const)("announces %s as role=%s", (tone: StatusTone, role) => {
    render(
      <StatusBanner tone={tone} label="Offline">
        Saved on this device.
      </StatusBanner>,
    );
    const banner = screen.getByRole(role);

    expect(banner.textContent).toBe("Offline: Saved on this device.");
    expect(banner.className).toBe(`banner banner--${tone}`);
  });
});

describe("PageLayout", () => {
  it("renders one focusable h1, the lead and the content", () => {
    render(
      <PageLayout title="Journal" lead="Your entries.">
        <p>Content</p>
      </PageLayout>,
    );
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading.textContent).toBe("Journal");
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("Your entries.")).toBeDefined();
    expect(screen.getByText("Content")).toBeDefined();
  });

  it("omits the lead when there is none", () => {
    const { container } = render(<PageLayout title="Journal" />);

    expect(container.querySelector(".page-lead")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  function Harness(props: {
    readonly onConfirm?: () => void;
    readonly onCancel?: () => void;
    readonly destructive?: boolean;
  }): preact.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Delete entry
        </Button>
        <ConfirmDialog
          open={open}
          title="Delete this entry?"
          confirmLabel="Delete"
          destructive={props.destructive === true}
          onConfirm={() => {
            setOpen(false);
            props.onConfirm?.();
          }}
          onCancel={() => {
            setOpen(false);
            props.onCancel?.();
          }}
        >
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      </>
    );
  }

  async function openDialog(): Promise<HTMLElement> {
    await userEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    return screen.getByRole("alertdialog");
  }

  it("renders nothing while closed", () => {
    render(<Harness />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is a labelled, described modal dialog", async () => {
    render(<Harness />);
    const dialog = await openDialog();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("Delete this entry?");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("This cannot be undone.");
  });

  it("moves focus to Cancel, the safe choice, when it opens", async () => {
    render(<Harness />);
    await openDialog();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    render(<Harness />);
    await openDialog();
    const user = userEvent.setup();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });

    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("cancels on Escape and returns focus to the opener", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await openDialog();

    await userEvent.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete entry" }),
    );
  });

  it("cancels on a backdrop click but not on a click inside", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const dialog = await openDialog();

    await userEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms only when the confirm button is pressed", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} destructive />);
    await openDialog();
    const confirm = screen.getByRole("button", { name: "Delete" });

    expect(confirm.className).toContain("button--danger");
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("uses the primary style and a custom cancel label when not destructive", async () => {
    render(
      <ConfirmDialog
        open
        title="Sign out?"
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <p>You can sign in again later.</p>
      </ConfirmDialog>,
    );

    expect(
      screen.getByRole("button", { name: "Sign out" }).className,
    ).toContain("button--primary");
    expect(
      screen.getByRole("button", { name: "Stay signed in" }),
    ).toBeDefined();
  });

  it("ignores other keys", async () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await openDialog();

    await userEvent.keyboard("a");

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeDefined();
  });
});
