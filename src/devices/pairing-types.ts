/**
 * What pairing looks like from outside: the ways it can end, what it needs
 * from the key vault and what the pairing screens are given (ADR-0005).
 *
 * The protocol itself is in `pairing.ts`.
 */

type Bytes = Uint8Array<ArrayBuffer>;

/** Why a pairing ended without the key being handed over. */
export type PairingErrorCode =
  /** The five minutes ran out, or a newer request replaced this one. */
  | "pairing_expired"
  /** The approving device refused the request. */
  | "pairing_rejected"
  /** A value was changed in transit. Nothing was handed over. */
  | "pairing_tampered"
  /** The typed code was not the code this pairing produced. */
  | "pairing_code_mismatch"
  /** The confirmation code typed on the new device was not the sender's. */
  | "pairing_confirmation_mismatch"
  /** The screen was left before the pairing finished. */
  | "pairing_cancelled";

/** A pairing that ended early, with a reason the UI can explain. */
export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode) {
    super(`Pairing ended: ${code}`);
    this.name = "PairingError";
    this.code = code;
  }
}

/** How the approving device proves again that it may release the root key. */
export type RootKeyCredential =
  | { readonly kind: "device_passphrase"; readonly passphrase: string }
  | { readonly kind: "recovery_key"; readonly recoveryKey: string };

/** What pairing needs from the key vault. */
export interface RootKeyAccess {
  /**
   * Hand the raw root key to `use`, then wipe it. The unlocked key cannot be
   * exported, so it is opened again with the credential, which also confirms
   * that the person approving is the account's owner.
   *
   * @throws VaultError as for unlocking with that credential.
   */
  withRootKeyBytes<T>(
    credential: RootKeyCredential,
    use: (rootKeyBytes: Bytes) => Promise<T>,
  ): Promise<T>;
  /** Unlock this device with a root key received from another device. */
  acceptRootKey(rootKeyBytes: Bytes): Promise<void>;
}

/** What the new device's screen is told while pairing. */
export type JoinProgress =
  | { readonly kind: "waiting_for_approver" }
  | { readonly kind: "compare_code"; readonly code: string };

/** A key the new device has received and not yet decided to keep. */
export interface JoinConfirmation {
  /**
   * Keep the received key, if the typed confirmation code is the one the
   * approving device shows. Unlocks this device.
   *
   * @param typedCode - The confirmation code, as typed here.
   * @throws PairingError `pairing_confirmation_mismatch`. The received key
   *   is then discarded and the pairing is over.
   */
  confirm(typedCode: string): Promise<void>;
}

/** A request the approving device has taken up and checked. */
export interface Approval {
  /** When the request stops being usable. */
  readonly expiresAt: Date;
  /**
   * Hand the root key to the new device, if the typed code is right.
   *
   * @param typedCode - The code shown on the new device, as typed here.
   * @param credential - Re-opens the root key on this device.
   * @returns The confirmation code to show, for the person to type into
   *   the new device.
   * @throws PairingError `pairing_code_mismatch` (the pairing is then over),
   *   `pairing_expired`; VaultError if the credential is wrong, after which
   *   this may be called again.
   */
  approve(typedCode: string, credential: RootKeyCredential): Promise<string>;
  /** Refuse the request. */
  reject(): Promise<void>;
}

/** What the pairing screens need. */
export interface DevicePairing {
  /**
   * New device: run a pairing until a key has arrived. This device is not
   * unlocked yet: the person must still confirm where the key came from.
   *
   * @param onProgress - Told when to wait and when to show the code.
   * @param signal - Aborted when the screen is left. A received key that
   *   has not been confirmed is then discarded.
   * @returns The received key, waiting for its confirmation code.
   * @throws PairingError if the pairing ended early.
   */
  join(
    onProgress: (progress: JoinProgress) => void,
    signal: AbortSignal,
  ): Promise<JoinConfirmation>;
  /**
   * Approving device: take up the waiting request, if there is one.
   *
   * @param signal - Aborted when the screen is left.
   * @returns The request, ready for the code to be typed, or `undefined` if
   *   no device is waiting.
   * @throws PairingError `pairing_tampered` or `pairing_expired`.
   */
  takeUpRequest(signal: AbortSignal): Promise<Approval | undefined>;
}
