/**
 * Devices for sync tests: each has its own local database, all share one
 * key and one in-memory server.
 */
import { importRootKey, type RootKey } from "../../../src/crypto/root-key";
import { newEntry, type JournalEntry } from "../../../src/domain/journal/types";
import { EncryptedRecordStore } from "../../../src/storage/encrypted-record-store";
import { SyncEngine, type Exclusive } from "../../../src/sync/engine";
import type { RemoteChange } from "../../../src/sync/protocol";
import type { MemoryServer } from "../../../src/sync/testing/memory-server";
import type { SyncTransport } from "../../../src/sync/transport";

/** The synthetic account every test device belongs to. */
export const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
let devices = 0;

/** One device under test. */
export interface Device {
  readonly store: EncryptedRecordStore;
  readonly engine: SyncEngine;
  /** The name of the device's local database. */
  readonly name: string;
  readonly sync: () => ReturnType<SyncEngine["sync"]>;
  online: boolean;
}

/** The synthetic root key. It protects nothing real. */
export function rootKey(): Promise<RootKey> {
  return importRootKey(Uint8Array.from({ length: 32 }, (_, i) => i));
}

/**
 * A device of the account.
 *
 * @param server - The server it syncs with.
 * @param transport - How it reaches the server, if not directly.
 * @param options - `name` opens an existing local database, as a second
 *   tab or a restart would; `exclusive` shares a lock between tabs.
 * @returns The device, unlocked.
 */
export async function device(
  server: MemoryServer,
  transport?: SyncTransport,
  options: { name?: string; exclusive?: Exclusive } = {},
): Promise<Device> {
  devices += 1;
  const name = options.name ?? `sync-test-${String(devices)}`;
  const store = new EncryptedRecordStore(() => name);
  store.unlock(await rootKey(), OWNER);
  const made: Device = {
    store,
    name,
    online: true,
    engine: new SyncEngine(
      store,
      transport ?? server.transportFor(() => OWNER),
      () => made.online,
      options.exclusive,
    ),
    sync: () => made.engine.sync(),
  };
  return made;
}

/** Apply one change from the server, as a page of its own. */
export async function apply(
  store: EncryptedRecordStore,
  change: RemoteChange,
): Promise<string | undefined> {
  const [outcome] = await store.applyPage([change], String(change.sequence));
  return outcome;
}

/** A synthetic journal entry. */
export function entry(good = "Synthetic answer"): Promise<JournalEntry> {
  return newEntry({ good, improve: "Synthetic two", loved: "Synthetic three" });
}
