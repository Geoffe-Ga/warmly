/**
 * In-memory {@link DeviceDirectory} for screen tests. It must never be part
 * of a production build.
 */
import {
  DeviceError,
  cleanDeviceName,
  type DeviceDirectory,
  type DeviceView,
} from "../devices/this-device";

/** The devices a fresh {@link FakeDeviceDirectory} starts with. */
export const FAKE_DEVICES: readonly DeviceView[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Kitchen laptop",
    createdAt: new Date("2026-11-02T09:30:00Z"),
    lastSyncAt: undefined,
    isCurrent: true,
    revoked: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: undefined,
    createdAt: new Date("2026-11-20T18:05:00Z"),
    lastSyncAt: undefined,
    isCurrent: false,
    revoked: false,
  },
];

/** See the module comment. */
export class FakeDeviceDirectory implements DeviceDirectory {
  #devices: DeviceView[];
  /** Set to make the next call fail with this error, once. */
  failNextWith: Error | undefined;

  constructor(devices: readonly DeviceView[] = FAKE_DEVICES) {
    this.#devices = [...devices];
  }

  #maybeFail(): void {
    const failure = this.failNextWith;
    this.failNextWith = undefined;
    if (failure !== undefined) {
      throw failure;
    }
  }

  // Each method yields first, so a failure is a rejected promise, as with
  // the real directory.
  async list(): Promise<DeviceView[]> {
    await Promise.resolve();
    this.#maybeFail();
    return [...this.#devices];
  }

  async rename(deviceId: string, name: string): Promise<void> {
    await Promise.resolve();
    this.#maybeFail();
    const cleaned = cleanDeviceName(name);
    if (cleaned === undefined) {
      throw new DeviceError("invalid_name");
    }
    if (!this.#devices.some((device) => device.id === deviceId)) {
      throw new DeviceError("not_found");
    }
    this.#devices = this.#devices.map((device) =>
      device.id === deviceId ? { ...device, name: cleaned } : device,
    );
  }
}
