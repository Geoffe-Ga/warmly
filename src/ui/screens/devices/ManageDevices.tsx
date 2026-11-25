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
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { StatusBanner } from "../../components/StatusBanner";
import { AccountForm, describeError, useAction } from "../account/shared";

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
    <AccountForm
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
    </AccountForm>
  );
}

function DeviceCard(props: {
  readonly device: DeviceView;
  readonly onRenamed: () => void;
}): JSX.Element {
  const { device } = props;
  const [renaming, setRenaming] = useState(false);
  const name = device.name ?? UNNAMED;

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
        </div>
      )}
    </Card>
  );
}

/**
 * Manage Devices: the account's own devices, with the one in use marked, and
 * a way to rename each (PRD DEV-002, DEV-003). Names are decrypted on this
 * device; the server holds only ciphertext.
 *
 * @returns The Manage Devices screen.
 */
export function ManageDevices(): JSX.Element {
  const { devices } = useServices();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [renamed, setRenamed] = useState(false);

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
      {renamed && (
        <StatusBanner tone="success" label="Saved">
          The device has its new name.
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
              setRenamed(true);
              reload();
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
      <StatusBanner tone="info" label="Coming soon">
        Removing a device is not built yet.
      </StatusBanner>
    </PageLayout>
  );
}
