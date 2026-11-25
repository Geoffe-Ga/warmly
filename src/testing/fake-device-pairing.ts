/**
 * Scripted {@link DevicePairing} for screen tests. It must never be part of
 * a production build. The real protocol is tested in
 * `tests/frontend/devices/pairing.test.ts`.
 */
import { VaultError } from "../crypto/key-vault";
import {
  PairingError,
  normalisePairingCode,
  type Approval,
  type DevicePairing,
  type JoinProgress,
  type PairingErrorCode,
  type RootKeyCredential,
} from "../devices/pairing";
import {
  FAKE_DEVICE_PASSPHRASE,
  FAKE_RECOVERY_KEY,
  normaliseRecoveryKey,
  type FakeKeyVault,
} from "./fake-key-vault";

/** The code a scripted pairing shows. */
export const FAKE_PAIRING_CODE = "042917";

/** See the module comment. */
export class FakeDevicePairing implements DevicePairing {
  readonly #vault: FakeKeyVault;
  #next: (() => void) | undefined;
  #failure: Error | undefined;
  /** Whether a new device is waiting for this one to approve it. */
  requestWaiting = false;
  /** Set to make the next `takeUpRequest` fail with this error, once. */
  failNextTakeUpWith: Error | undefined;
  /** What the approving screen did: "approved", "rejected" or nothing yet. */
  outcome: "approved" | "rejected" | undefined;
  /** How many times the new device started a pairing. */
  joins = 0;

  /** @param vault - The vault double a finished pairing unlocks. */
  constructor(vault: FakeKeyVault) {
    this.#vault = vault;
  }

  /** Let the new device's pairing move to its next step. */
  otherDeviceMovesOn(): void {
    this.#next?.();
  }

  /** End the new device's pairing early, at its next step. */
  otherDeviceEndsItWith(code: PairingErrorCode): void {
    this.#failure = new PairingError(code);
    this.#next?.();
  }

  /** Wait for the other device, or for the screen to be left. */
  #wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const settle = (): void => {
        this.#next = undefined;
        if (signal.aborted) {
          reject(new PairingError("pairing_cancelled"));
        } else if (this.#failure === undefined) {
          resolve();
        } else {
          const failure = this.#failure;
          this.#failure = undefined;
          reject(failure);
        }
      };
      this.#next = settle;
      signal.addEventListener("abort", settle, { once: true });
    });
  }

  async join(
    onProgress: (progress: JoinProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.joins += 1;
    onProgress({ kind: "waiting_for_approver" });
    await this.#wait(signal);
    onProgress({ kind: "compare_code", code: FAKE_PAIRING_CODE });
    await this.#wait(signal);
    this.#vault.acceptKeyFromAnotherDevice();
  }

  async takeUpRequest(): Promise<Approval | undefined> {
    await Promise.resolve();
    const failure = this.failNextTakeUpWith;
    this.failNextTakeUpWith = undefined;
    if (failure !== undefined) {
      throw failure;
    }
    if (!this.requestWaiting) {
      return undefined;
    }
    this.requestWaiting = false;
    return {
      expiresAt: new Date("2026-11-25T10:05:00Z"),
      approve: async (typedCode, credential) => {
        await Promise.resolve();
        if (normalisePairingCode(typedCode) !== FAKE_PAIRING_CODE) {
          this.outcome = "rejected";
          throw new PairingError("pairing_code_mismatch");
        }
        checkCredential(credential);
        this.outcome = "approved";
      },
      reject: async () => {
        await Promise.resolve();
        this.outcome = "rejected";
      },
    };
  }
}

function checkCredential(credential: RootKeyCredential): void {
  if (credential.kind === "device_passphrase") {
    if (credential.passphrase !== FAKE_DEVICE_PASSPHRASE) {
      throw new VaultError("wrong_device_passphrase");
    }
  } else if (
    normaliseRecoveryKey(credential.recoveryKey) !== FAKE_RECOVERY_KEY
  ) {
    throw new VaultError("wrong_recovery_key");
  }
}
