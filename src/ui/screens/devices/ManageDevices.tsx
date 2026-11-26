import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { Link } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import {
  MAX_DEVICE_NAME_LENGTH,
  cleanDeviceName,
  type DeviceView,
} from "../../../devices/this-device";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { ActionForm, useAction } from "../../components/ActionForm";
import { describeError } from "../../error-messages";

/** What the list is showing. */
type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly devices: readonly DeviceView[] };

const UNNAMED = "Unnamed device";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}

function RenameForm(props: {
  readonly device: DeviceView;
  readonly onDone: (renamed: boolean) => void;
}): JSX.Element {
  const { devices } = useServices();
  const action = useAction();
  const [name, setName] = useState(props.device.name ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  const validate = (): boolean => {
    const problem =
      cleanDeviceName(name) === undefined
        ? `Type a name of 1 to ${String(MAX_DEVICE_NAME_LENGTH)} characters.`
        : undefined;
    setError(problem);
    return problem === undefined;
  };

  return (
    <ActionForm
      action={action}
      validate={validate}
      onValid={async () => {
        await devices.rename(props.device.id, name);
        props.onDone(true);
      }}
    >
      <TextField
        label="Device name"
        name="device-name"
        autocomplete="off"
        required
        hint="Only you can read this name. It is encrypted before it leaves this device."
        value={name}
        onInput={setName}
        error={error}
      />
      <div class="button-row">
        <Button type="submit" variant="primary" disabled={action.busy}>
          Save name
        </Button>
        <Button
          onClick={() => {
            props.onDone(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

/** Asks for the account password and confirms removing a device. */
function RemoveDialog(props: {
  readonly device: DeviceView;
  readonly name: string;
  readonly onRemoved: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const { devices } = useServices();
  const action = useAction();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const confirm = (): void => {
    if (password === "") {
      setError("Enter your account password to confirm.");
      return;
    }
    setError(undefined);
    action.run(async () => {
      await devices.revoke(props.device.id, password);
      setPassword("");
      props.onRemoved();
    });
  };

  return (
    <ConfirmDialog
      open
      title={`Remove ${props.name}?`}
      confirmLabel="Remove device"
      destructive
      onConfirm={confirm}
      onCancel={props.onCancel}
    >
      <p>
        {props.device.isCurrent
          ? "This is the device you are using. It will be signed out now and will no longer be able to open your journal."
          : "It will stop syncing straight away and will be signed out the next time it connects."}{" "}
        This cannot be undone. To use the device again you would add it as a new
        one.
      </p>
      <p>
        We cannot erase a device from here. If it is offline, it keeps what it
        already has, including anything open on its screen, until it next
        connects.
      </p>
      {action.error !== undefined && (
        <StatusBanner tone="error" label="Not removed">
          {action.error}
        </StatusBanner>
      )}
      <TextField
        label="Account password"
        type="password"
        name="current-password"
        autocomplete="current-password"
        required
        hint="Confirms it is you. This is your sign-in password, not a device passphrase."
        value={password}
        onInput={setPassword}
        error={error}
      />
    </ConfirmDialog>
  );
}

function DeviceCard(props: {
  readonly device: DeviceView;
  readonly onRenamed: () => void;
  readonly onRemoved: () => void;
}): JSX.Element {
  const { device } = props;
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = device.name ?? UNNAMED;

  if (device.revoked) {
    return (
      <Card heading={name}>
        <p>
          <strong>Removed.</strong> This device can no longer sync or open your
          journal.
        </p>
        <dl class="detail-list">
          <dt>Added</dt>
          <dd>{formatDate(device.createdAt)}</dd>
        </dl>
      </Card>
    );
  }

  return (
    <Card heading={name}>
      {device.isCurrent && (
        <p>
          <strong>This device.</strong> You are using it now.
        </p>
      )}
      <dl class="detail-list">
        <dt>Added</dt>
        <dd>{formatDate(device.createdAt)}</dd>
        <dt>Last synced</dt>
        <dd>
          {device.lastSyncAt === undefined
            ? "Not yet"
            : formatDate(device.lastSyncAt)}
        </dd>
      </dl>
      {renaming ? (
        <RenameForm
          device={device}
          onDone={(renamed) => {
            setRenaming(false);
            if (renamed) {
              props.onRenamed();
            }
          }}
        />
      ) : (
        <div class="button-row">
          <Button
            ariaLabel={`Rename ${name}`}
            onClick={() => {
              setRenaming(true);
            }}
          >
            Rename
          </Button>
          <Button
            variant="danger"
            ariaLabel={`Remove ${name}`}
            onClick={() => {
              setRemoving(true);
            }}
          >
            Remove
          </Button>
        </div>
      )}
      {removing && (
        <RemoveDialog
          device={device}
          name={name}
          onCancel={() => {
            setRemoving(false);
          }}
          onRemoved={() => {
            setRemoving(false);
            props.onRemoved();
          }}
        />
      )}
    </Card>
  );
}

/**
 * Manage Devices: the account's own devices, with the one in use marked, and
 * a way to rename or remove each (PRD DEV-002, DEV-003, DEV-004). Names are decrypted on this
 * device; the server holds only ciphertext.
 *
 * @returns The Manage Devices screen.
 */
export function ManageDevices(): JSX.Element {
  const { devices } = useServices();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<"renamed" | "removed" | undefined>(
    undefined,
  );

  const reload = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    devices.list().then(
      (found) => {
        if (!cancelled) {
          setLoad({ kind: "ready", devices: found });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({ kind: "failed", message: describeError(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [devices, attempt]);

  return (
    <PageLayout
      title="Manage Devices"
      lead="The devices registered to your account. Each one has its own key, and the server checks it on every request."
    >
      {notice === "renamed" && (
        <StatusBanner tone="success" label="Saved">
          The device has its new name.
        </StatusBanner>
      )}
      {notice === "removed" && (
        <StatusBanner tone="success" label="Removed">
          That device can no longer sync or open your journal.
        </StatusBanner>
      )}
      {load.kind === "loading" && (
        <StatusBanner tone="info" label="Loading">
          Getting your devices.
        </StatusBanner>
      )}
      {load.kind === "failed" && (
        <>
          <StatusBanner tone="error" label="Couldn't load your devices">
            {load.message}
          </StatusBanner>
          <div class="button-row">
            <Button onClick={reload}>Try again</Button>
          </div>
        </>
      )}
      {load.kind === "ready" &&
        load.devices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            onRenamed={() => {
              setNotice("renamed");
              reload();
            }}
            onRemoved={() => {
              // Removing the device in use ends its session instead; the
              // app shell takes over and this screen goes away.
              if (!device.isCurrent) {
                setNotice("removed");
                reload();
              }
            }}
          />
        ))}
      <Card heading="Add a device">
        <p>
          Sign in on the new device first. It will show a six-digit code. Then
          approve it from here, or unlock it with your recovery key instead.
        </p>
        <p>
          <Link href={pathFor("approve-device")}>Approve a new device</Link>
        </p>
      </Card>
    </PageLayout>
  );
}
