import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../../../src/api/client";
import { fromBase64, toBase64 } from "../../../src/crypto/encoding";
import { openJson, sealJson } from "../../../src/crypto/envelope";
import type { RootKey } from "../../../src/crypto/root-key";
import type {
  DeviceRegistration,
  DeviceRegistry,
} from "../../../src/devices/registry";
import { enrollmentProof } from "../../../src/devices/signing";
import {
  AccountDevices,
  DEVICE_NAME_RECORD_TYPE,
  DeviceError,
  MAX_DEVICE_NAME_LENGTH,
  UnavailableDeviceDirectory,
  cleanDeviceName,
  defaultDeviceName,
} from "../../../src/devices/this-device";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import {
  FAKE_DEVICES_STORAGE_KEY,
  FakeDeviceRegistry,
} from "../../../src/testing/fake-device-registry";
import { MemoryIdentityStore, fixtureRootKey, otherRootKey } from "./helpers";

const NOW = new Date("2026-11-25T10:00:00Z");
const DEFAULT_NAME = defaultDeviceName(NOW);
// Assembled from words so no credential-shaped literal sits in the repository.
const PHRASE = ["correct", "horse", "battery"].join(" ");

let auth: FakeAuthClient;
let server: FakeDeviceRegistry;
let root: RootKey;
let unlocked: RootKey | undefined;

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  auth = new FakeAuthClient();
  await auth.register("sam@example.com", PHRASE);
  await auth.completeVerification();
  server = new FakeDeviceRegistry(localStorage, () => NOW);
  root = await fixtureRootKey();
  unlocked = root;
});

/** A device with its own identity store, talking to the same server. */
function device(registry: DeviceRegistry = server): AccountDevices {
  return new AccountDevices(
    auth,
    new MemoryIdentityStore(),
    registry,
    () => unlocked,
    () => NOW,
  );
}

async function userId(): Promise<string> {
  return (await auth.currentSession())?.userId ?? "";
}

/** A registry that records registrations and can be told to fail. */
function recording(failures = 0): DeviceRegistry & {
  registrations: {
    deviceId: string;
    publicKey: string;
    sent: DeviceRegistration;
  }[];
} {
  let remaining = failures;
  const registrations: {
    deviceId: string;
    publicKey: string;
    sent: DeviceRegistration;
  }[] = [];
  return {
    registrations,
    register: async (session, identity, sent) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new ApiError("offline");
      }
      registrations.push({
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        sent,
      });
      return server.register(session, identity, sent);
    },
    list: (session, identity) => server.list(session, identity),
    rename: (session, identity, id, name) =>
      server.rename(session, identity, id, name),
    revoke: (session, identity, id) => server.revoke(session, identity, id),
  };
}

describe("registering this device (DEV-002)", () => {
  it("registers once, with an encrypted default name and a proof of the root key", async () => {
    const registry = recording();
    const devices = device(registry);

    await devices.ensureRegistered(root);
    await devices.ensureRegistered(root);

    expect(registry.registrations).toHaveLength(1);
    const sent = registry.registrations[0];
    expect(sent?.sent.enrollmentProof).toBe(
      await enrollmentProof(root, sent?.deviceId ?? "", sent?.publicKey ?? ""),
    );
    expect(
      await openJson(
        root,
        {
          owner: await userId(),
          recordId: sent?.deviceId ?? "",
          type: DEVICE_NAME_RECORD_TYPE,
        },
        fromBase64(sent?.sent.nameCiphertext ?? ""),
      ),
    ).toBe(DEFAULT_NAME);
  });

  it("never sends the device name in the clear (invariant 1)", async () => {
    await device().ensureRegistered(root);

    const stored = localStorage.getItem(FAKE_DEVICES_STORAGE_KEY) ?? "";
    expect(stored).not.toContain("Device added");
    expect(stored).not.toContain("November");
  });

  it("makes one registration when two callers ask at once", async () => {
    const registry = recording();
    const devices = device(registry);

    await Promise.all([
      devices.ensureRegistered(root),
      devices.ensureRegistered(root),
    ]);

    expect(registry.registrations).toHaveLength(1);
  });

  it("tries again after a failure, and finishes a registration the server already has", async () => {
    const registry = recording(1);
    const devices = device(registry);

    await expect(devices.ensureRegistered(root)).rejects.toMatchObject({
      code: "offline",
    });
    await devices.ensureRegistered(root);

    expect(registry.registrations).toHaveLength(1);
    expect(await devices.list()).toHaveLength(1);
  });

  it("treats 'already registered' as an earlier attempt that succeeded", async () => {
    const identities = new MemoryIdentityStore();
    const identity = await identities.getOrCreate(await userId());
    await server.register(
      { userId: await userId(), accessToken: "t" },
      identity,
      { nameCiphertext: "bmFtZQ==", enrollmentProof: "" },
    );
    const devices = new AccountDevices(
      auth,
      identities,
      server,
      () => unlocked,
    );

    await devices.ensureRegistered(root);

    expect((await identities.get(await userId()))?.registered).toBe(true);
  });

  it("does not let a background failure escape, and repairs it when the list is opened", async () => {
    const registry = recording(1);
    const devices = device(registry);

    devices.registerInBackground(root);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registry.registrations).toHaveLength(0);

    expect(await devices.list()).toHaveLength(1);
  });

  it("registers in the background when it can", async () => {
    const registry = recording();
    const devices = device(registry);

    devices.registerInBackground(root);

    await expect.poll(() => registry.registrations.length).toBe(1);
  });

  it("does nothing when nobody is signed in", async () => {
    await auth.signOut();
    const registry = recording();

    await device(registry).ensureRegistered(root);

    expect(registry.registrations).toHaveLength(0);
  });
});

describe("listing the account's devices (DEV-003)", () => {
  it("shows this device with its decrypted name, added date and current marker", async () => {
    const devices = device();

    const listed = await devices.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: DEFAULT_NAME,
      createdAt: NOW,
      lastSyncAt: undefined,
      isCurrent: true,
      revoked: false,
    });
  });

  it("shows a second device on the account, with one current device each", async () => {
    const first = device();
    const second = device();
    await first.list();

    const seenBySecond = await second.list();
    const seenByFirst = await first.list();

    expect(seenBySecond.map((entry) => entry.isCurrent)).toEqual([false, true]);
    expect(seenByFirst.map((entry) => entry.isCurrent)).toEqual([true, false]);
    expect(seenBySecond.map((entry) => entry.name)).toEqual([
      DEFAULT_NAME,
      DEFAULT_NAME,
    ]);
  });

  it("reads the sync date when the register has one", async () => {
    const registry: DeviceRegistry = {
      ...recording(),
      list: async (session, identity) =>
        (await server.list(session, identity)).map((entry) => ({
          ...entry,
          lastSyncAt: "2026-11-26T08:00:00Z",
        })),
    };

    const listed = await device(registry).list();

    expect(listed[0]?.lastSyncAt).toEqual(new Date("2026-11-26T08:00:00Z"));
  });

  it.each([
    [
      "sealed with another key",
      async (owner: string, id: string) =>
        toBase64(
          await sealJson(
            await otherRootKey(),
            { owner, recordId: id, type: DEVICE_NAME_RECORD_TYPE },
            "Stolen name",
          ),
        ),
    ],
    [
      "moved from another device",
      async (owner: string) =>
        toBase64(
          await sealJson(
            await fixtureRootKey(),
            {
              owner,
              recordId: "another-device",
              type: DEVICE_NAME_RECORD_TYPE,
            },
            "Moved name",
          ),
        ),
    ],
    [
      "not a string inside",
      async (owner: string, id: string) =>
        toBase64(
          await sealJson(
            await fixtureRootKey(),
            { owner, recordId: id, type: DEVICE_NAME_RECORD_TYPE },
            { name: "object" },
          ),
        ),
    ],
    [
      "blank inside",
      async (owner: string, id: string) =>
        toBase64(
          await sealJson(
            await fixtureRootKey(),
            { owner, recordId: id, type: DEVICE_NAME_RECORD_TYPE },
            "   ",
          ),
        ),
    ],
    ["not an envelope at all", () => Promise.resolve("bm90IGFuIGVudmVsb3Bl")],
  ])("shows a device as unnamed when its name is %s", async (_name, forge) => {
    const devices = device();
    const [mine] = await devices.list();
    const owner = await userId();
    const stored = JSON.parse(
      localStorage.getItem(FAKE_DEVICES_STORAGE_KEY) ?? "[]",
    ) as string[][];
    const row = stored[0] ?? [];
    row[2] = await forge(owner, mine?.id ?? "");
    localStorage.setItem(FAKE_DEVICES_STORAGE_KEY, JSON.stringify(stored));

    const listed = await devices.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBeUndefined();
    expect(listed[0]?.id).toBe(mine?.id);
  });

  it.each(["list", "rename"] as const)(
    "refuses to %s while locked, without contacting the server",
    async (operation) => {
      const registry = recording();
      const devices = device(registry);
      unlocked = undefined;

      const attempt =
        operation === "list" ? devices.list() : devices.rename("d", "Phone");

      await expect(attempt).rejects.toBeInstanceOf(DeviceError);
      await expect(
        operation === "list" ? devices.list() : devices.rename("d", "Phone"),
      ).rejects.toMatchObject({ code: "locked" });
      expect(registry.registrations).toHaveLength(0);
    },
  );

  it("refuses to list when signed out", async () => {
    const devices = device();
    await auth.signOut();

    await expect(devices.list()).rejects.toMatchObject({ code: "locked" });
  });
});

describe("renaming a device (DEV-003)", () => {
  it("stores the new name encrypted and shows it on every device", async () => {
    const first = device();
    const second = device();
    const [mine] = await first.list();

    await first.rename(mine?.id ?? "", "  Kitchen   laptop ");

    expect((await second.list())[0]?.name).toBe("Kitchen laptop");
    expect(localStorage.getItem(FAKE_DEVICES_STORAGE_KEY)).not.toContain(
      "Kitchen",
    );
  });

  it("can rename another of the account's devices", async () => {
    const first = device();
    const second = device();
    const [theirs] = await first.list();

    await second.rename(theirs?.id ?? "", "Old phone");

    expect((await first.list())[0]).toMatchObject({
      name: "Old phone",
      isCurrent: true,
    });
  });

  it.each(["", "   ", "x".repeat(MAX_DEVICE_NAME_LENGTH + 1)])(
    "refuses the name %j before contacting the server",
    async (name) => {
      const devices = device();
      const [mine] = await devices.list();

      await expect(devices.rename(mine?.id ?? "", name)).rejects.toMatchObject({
        name: "DeviceError",
        code: "invalid_name",
      });
      expect((await devices.list())[0]?.name).toBe(DEFAULT_NAME);
    },
  );

  it("reports a device that is not on the account as not found (DEV-010)", async () => {
    await expect(
      device().rename("d0000000-0000-4000-8000-0000000000ff", "Phone"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("removing a device (DEV-003, DEV-004, AC-20)", () => {
  /** A device that reports when it has revoked itself. */
  function reporting(): { devices: AccountDevices; reports: () => number } {
    let reports = 0;
    return {
      reports: () => reports,
      devices: new AccountDevices(
        auth,
        new MemoryIdentityStore(),
        new FakeDeviceRegistry(
          localStorage,
          () => NOW,
          () => {
            reports += 1;
          },
        ),
        () => unlocked,
        () => NOW,
        () => {
          reports += 1;
        },
      ),
    };
  }

  it("revokes another device after the password is entered again; it is then refused", async () => {
    const first = reporting();
    const second = reporting();
    await first.devices.list();
    const [, theirs] = await second.devices.list();

    await first.devices.revoke(theirs?.id ?? "", PHRASE);

    const listed = await first.devices.list();
    expect(listed.map((entry) => [entry.isCurrent, entry.revoked])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(first.reports()).toBe(0);
    await expect(second.devices.list()).rejects.toMatchObject({
      code: "device_revoked",
    });
    await expect(
      second.devices.rename(theirs?.id ?? "", "Phone"),
    ).rejects.toMatchObject({ code: "device_revoked" });
    expect(second.reports()).toBe(2);
  });

  it("a wrong password revokes nothing", async () => {
    const first = device();
    const second = device();
    await first.list();
    const [, theirs] = await second.list();

    await expect(
      first.revoke(theirs?.id ?? "", "not the password"),
    ).rejects.toMatchObject({ name: "AuthError", code: "invalid_credentials" });

    expect((await second.list()).every((entry) => !entry.revoked)).toBe(true);
  });

  it("a device can revoke itself, and says so at once", async () => {
    const { devices, reports } = reporting();
    const [mine] = await devices.list();

    await devices.revoke(mine?.id ?? "", PHRASE);

    expect(reports()).toBe(1);
    await expect(devices.list()).rejects.toMatchObject({
      code: "device_revoked",
    });
  });

  it("a revoked device cannot revoke the others", async () => {
    const first = device();
    const second = device();
    const [mine] = await first.list();
    const [, theirs] = await second.list();
    await first.revoke(theirs?.id ?? "", PHRASE);

    await expect(second.revoke(mine?.id ?? "", PHRASE)).rejects.toMatchObject({
      code: "device_revoked",
    });

    expect((await first.list())[0]?.revoked).toBe(false);
  });

  it("reports a device that is not on the account as not found (DEV-010)", async () => {
    await expect(
      device().revoke("d0000000-0000-4000-8000-0000000000ff", PHRASE),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("asks nothing of the auth service while locked", async () => {
    const devices = device();
    const [mine] = await devices.list();
    unlocked = undefined;
    let asked = false;
    auth.reauthenticate = () => {
      asked = true;
      return Promise.resolve();
    };

    await expect(devices.revoke(mine?.id ?? "", PHRASE)).rejects.toMatchObject({
      code: "locked",
    });
    expect(asked).toBe(false);
  });
});

describe("device names", () => {
  it("accepts a name of exactly the longest length, counting characters not bytes", () => {
    const longest = "é".repeat(MAX_DEVICE_NAME_LENGTH);

    expect(cleanDeviceName(longest)).toBe(longest);
    expect(cleanDeviceName(`${longest}é`)).toBeUndefined();
    expect(cleanDeviceName("😀".repeat(MAX_DEVICE_NAME_LENGTH))).toBe(
      "😀".repeat(MAX_DEVICE_NAME_LENGTH),
    );
  });

  it("trims and collapses spaces", () => {
    expect(cleanDeviceName("  My \t phone\n")).toBe("My phone");
    expect(cleanDeviceName(" ")).toBeUndefined();
  });

  it("names a new device by the day it was added", () => {
    const format = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeZone: "UTC",
    });

    expect(defaultDeviceName(new Date("2026-01-02T23:59:59Z"), format)).toBe(
      "Device added 2 January 2026",
    );
  });

  it("writes the date the way Manage Devices does by default", () => {
    const date = new Date("2026-01-02T12:00:00Z");

    expect(defaultDeviceName(date)).toBe(
      `Device added ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)}`,
    );
  });

  it("uses the real clock by default", async () => {
    const devices = new AccountDevices(
      auth,
      new MemoryIdentityStore(),
      server,
      () => unlocked,
    );

    expect((await devices.list())[0]?.name).toBe(defaultDeviceName(new Date()));
  });
});

describe("a build with no backend", () => {
  it("has no devices and cannot rename", async () => {
    const devices = new UnavailableDeviceDirectory();

    expect(await devices.list()).toEqual([]);
    await expect(devices.rename()).rejects.toMatchObject({ code: "locked" });
    await expect(devices.revoke()).rejects.toMatchObject({ code: "locked" });
  });
});
