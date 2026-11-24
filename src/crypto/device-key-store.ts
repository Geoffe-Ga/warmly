/**
 * Where a trusted device keeps what it needs to unlock without the recovery
 * key (PRD DEV-006). The real store, which wraps the root key with a
 * non-exportable device key, arrives with trusted-device unlock (issue #20).
 * Until then production has no device store, and unlocking always takes the
 * recovery key.
 */

/** Keeps root-key material for one account on this device. */
export interface DeviceKeyStore {
  /** @returns The root-key material for the account, if this device has it. */
  load(userId: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  /** Remember the root-key material for the account on this device. */
  save(userId: string, rootKeyBytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
