import { beforeEach, describe, expect, it } from "vitest";

import type { AuthSession } from "../../../src/auth/auth-client";
import { AccountVault } from "../../../src/crypto/account-vault";
import { IndexedDbDeviceKeyStore } from "../../../src/crypto/device-key-store";
import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import { openJson, sealJson } from "../../../src/crypto/envelope";
import { generateRecipientKey, hpkeSeal } from "../../../src/crypto/hpke";
import type { RootKey } from "../../../src/crypto/root-key";
import {
  AccountPairing,
  PairingError,
  UnavailableDevicePairing,
  formatPairingCode,
  normalisePairingCode,
  pairingCode,
  pairingCommitment,
  type Approval,
  type PairingTiming,
  type PairingTranscript,
  type RootKeyCredential,
} from "../../../src/devices/pairing";
import type {
  PairingRelay,
  PairingRequest,
} from "../../../src/devices/pairing-relay";
import { FakeAuthClient } from "../../../src/testing/fake-auth-client";
import {
  FAKE_PAIRING_STORAGE_KEY,
  FakePairingRelay,
} from "../../../src/testing/fake-pairing-relay";
import { FakeRecoveryEnvelopeStore } from "../../../src/testing/fake-recovery-envelope-store";
import { MemoryIdentityStore } from "./helpers";

// Assembled from words so no credential-shaped literal sits in the repository.
const PHRASE = ["correct", "horse", "battery"].join(" ");
const PASSPHRASE = ["lamp", "river", "kettle"].join(" ");
const WITH_PASSPHRASE: RootKeyCredential = {
  kind: "device_passphrase",
  passphrase: PASSPHRASE,
};

let clock: number;
let auth: FakeAuthClient;
let envelopes: FakeRecoveryEnvelopeStore;
let relay: FakePairingRelay;
let recoveryKey: string;
let approverVault: AccountVault;
let approver: AccountPairing;

const timing: PairingTiming = {
  sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
  now: () => clock,
};

/** A device: its own vault, key store and identity, on the shared servers. */
function device(through: PairingRelay = relay): {
  vault: AccountVault;
  pairing: AccountPairing;
} {
  const vault = new AccountVault(
    auth,
    envelopes,
    new IndexedDbDeviceKeyStore(`pairing-test-${crypto.randomUUID()}`, 1_000),
  );
  return {
    vault,
    pairing: new AccountPairing(
      auth,
      new MemoryIdentityStore(),
      through,
      vault,
      timing,
    ),
  };
}

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  clock = Date.parse("2026-11-25T10:00:00Z");
  auth = new FakeAuthClient();
  await auth.register("sam@example.com", PHRASE);
  await auth.completeVerification();
  envelopes = new FakeRecoveryEnvelopeStore();
  relay = new FakePairingRelay(localStorage, () => clock);
  const first = device();
  approverVault = first.vault;
  approver = first.pairing;
  recoveryKey = await approverVault.createAccountKeys();
  await approverVault.confirmRecoveryKey();
  await approverVault.trustThisDevice(PASSPHRASE);
});

/** What happened on the new device. */
interface Joining {
  /** Settles when the new device's pairing ends. */
  readonly done: Promise<void>;
  /** The code the new device shows, once it shows one. */
  readonly code: Promise<string>;
  readonly progress: string[];
  readonly abort: AbortController;
}

function startJoining(pairing: AccountPairing): Joining {
  const abort = new AbortController();
  const progress: string[] = [];
  let showCode: (code: string) => void = () => undefined;
  const code = new Promise<string>((resolve) => {
    showCode = resolve;
  });
  const done = pairing.join((step) => {
    progress.push(step.kind);
    if (step.kind === "compare_code") {
      showCode(step.code);
    }
  }, abort.signal);
  // Failures are asserted by the test that expects them.
  done.catch(() => undefined);
  return { done, code, progress, abort };
}

/** Wait until the new device's request has reached the relay. */
async function requested(joining: Joining): Promise<void> {
  await expect.poll(() => joining.progress.length).toBeGreaterThan(0);
}

/** Look for the waiting request until there is one, as the screen does. */
async function takeUp(pairing: AccountPairing = approver): Promise<Approval> {
  const abort = new AbortController();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const approval = await pairing.takeUpRequest(abort.signal);
    if (approval !== undefined) {
      return approval;
    }
    await timing.sleep(0, abort.signal);
  }
  throw new Error("no request appeared");
}

async function codeOf(error: Promise<unknown>): Promise<string> {
  try {
    await error;
  } catch (caught) {
    return (caught as { code?: string }).code ?? String(caught);
  }
  throw new Error("expected a failure");
}

describe("pairing a new device with an unlocked one (AC-19, DEV-001 path A)", () => {
  it("hands over the root key: the new device unlocks and reads what the first wrote", async () => {
    const context = { owner: "o", recordId: "r", type: 1 };
    const written = await sealJson(
      approverVault.rootKey() as RootKey,
      context,
      "written on the first device",
    );
    const joiner = device();
    const joining = startJoining(joiner.pairing);

    const approval = await takeUp();
    await approval.approve(await joining.code, WITH_PASSPHRASE);
    await joining.done;

    expect(await joiner.vault.fingerprint()).toBe(
      await approverVault.fingerprint(),
    );
    expect(
      await openJson(joiner.vault.rootKey() as RootKey, context, written),
    ).toBe("written on the first device");
    // As after a recovery, the new device may now be trusted.
    expect(joiner.vault.deviceTrustPending()).toBe(true);
  });

  it("tells the new device to wait, then to show a six-digit code", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);

    const approval = await takeUp();
    const code = await joining.code;
    await approval.approve(code, WITH_PASSPHRASE);
    await joining.done;

    expect(joining.progress).toEqual(["waiting_for_approver", "compare_code"]);
    expect(code).toMatch(/^\d{6}$/);
    expect(approval.expiresAt.getTime()).toBe(clock + 5 * 60 * 1_000);
  });

  it("accepts the code typed with spaces, and the recovery key as the credential", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);

    const approval = await takeUp();
    await approval.approve(` ${formatPairingCode(await joining.code)} `, {
      kind: "recovery_key",
      recoveryKey,
    });
    await joining.done;

    expect(await joiner.vault.fingerprint()).toBe(
      await approverVault.fingerprint(),
    );
  });

  it("the relay only ever holds public values and ciphertext (invariant 1)", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;
    await approval.approve(code, WITH_PASSPHRASE);
    await joining.done;

    const held = localStorage.getItem(FAKE_PAIRING_STORAGE_KEY) ?? "";
    const [stored] = JSON.parse(held) as { request: PairingRequest }[];

    expect(held).not.toContain(code);
    expect(held).not.toContain(PASSPHRASE);
    // 65-byte sender key, 32-byte root key, 16-byte tag.
    expect(fromBase64(stored?.request.wrappedKey ?? "")).toHaveLength(113);
  });
});

describe("the person must compare the code", () => {
  it("a wrong code ends the pairing and hands nothing over", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;
    const wrong = code === "000000" ? "000001" : "000000";

    expect(await codeOf(approval.approve(wrong, WITH_PASSPHRASE))).toBe(
      "pairing_code_mismatch",
    );

    expect(await codeOf(joining.done)).toBe("pairing_rejected");
    expect(await joiner.vault.fingerprint()).toBeUndefined();
    expect(localStorage.getItem(FAKE_PAIRING_STORAGE_KEY)).not.toContain(
      "wrappedKey",
    );
  });

  it("allows one guess: the right code after a wrong one is too late", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;
    await codeOf(approval.approve("not the code", WITH_PASSPHRASE));

    expect(await codeOf(approval.approve(code, WITH_PASSPHRASE))).toBe(
      "pairing_expired",
    );
    expect(await joiner.vault.fingerprint()).toBeUndefined();
  });

  it("a wrong passphrase releases nothing, and the right one can still be given", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;

    expect(
      await codeOf(
        approval.approve(code, {
          kind: "device_passphrase",
          passphrase: "not the passphrase",
        }),
      ),
    ).toBe("wrong_device_passphrase");
    expect(await joiner.vault.fingerprint()).toBeUndefined();

    await approval.approve(code, WITH_PASSPHRASE);
    await joining.done;
    expect(await joiner.vault.fingerprint()).toBe(
      await approverVault.fingerprint(),
    );
  });

  it("the approving device can refuse", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();

    await approval.reject();

    expect(await codeOf(joining.done)).toBe("pairing_rejected");
    expect(await joiner.vault.fingerprint()).toBeUndefined();
  });

  it("a locked approving device cannot release the key", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;
    approverVault.lock();

    expect(await codeOf(approval.approve(code, WITH_PASSPHRASE))).toBe(
      "locked",
    );
    expect(await joiner.vault.fingerprint()).toBeUndefined();
  });
});

/** A relay that changes what one device sees. */
function tampering(
  change: (request: PairingRequest) => PairingRequest,
): PairingRelay {
  const base: PairingRelay = relay;
  const alter = async (
    result: Promise<PairingRequest | undefined>,
  ): Promise<PairingRequest | undefined> => {
    const request = await result;
    return request === undefined ? undefined : change(request);
  };
  return {
    start: async (session, start) => change(await base.start(session, start)),
    read: (session, id) => alter(base.read(session, id)),
    openRequest: (session, identity) =>
      alter(base.openRequest(session, identity)),
    claim: (session, identity, id, nonce) =>
      alter(base.claim(session, identity, id, nonce)),
    reveal: (session, id, nonce) => alter(base.reveal(session, id, nonce)),
    approve: (session, identity, id, key) =>
      alter(base.approve(session, identity, id, key)),
    reject: (session, identity, id) => base.reject(session, identity, id),
  };
}

function other32(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

describe("a relay in the middle cannot get the key (AC-19, D-07)", () => {
  it("swapping the new device's public key is caught by the commitment", async () => {
    const attacker = await generateRecipientKey();
    const swapping = tampering((request) => ({
      ...request,
      publicKey: toBase64(attacker.publicKey),
    }));
    const joiner = device();
    const joining = startJoining(joiner.pairing);

    expect(await codeOf(takeUp(device(swapping).pairing))).toBe(
      "pairing_tampered",
    );
    expect(await codeOf(joining.done)).toBe("pairing_rejected");
  });

  it("a relay that swaps the key and forges a matching commitment changes the code", async () => {
    const attacker = await generateRecipientKey();
    const attackerNonce = crypto.getRandomValues(new Uint8Array(32));
    // The relay shows the approving device its own key, commitment and
    // random value in place of the new device's, all consistent.
    const impersonating = tampering((request) => ({
      ...request,
      publicKey: toBase64(attacker.publicKey),
      joinerNonce:
        request.joinerNonce === undefined ? undefined : toBase64(attackerNonce),
    }));
    const forged: PairingRelay = {
      ...impersonating,
      openRequest: async (session, identity) => {
        const request = await impersonating.openRequest(session, identity);
        return request === undefined
          ? undefined
          : {
              ...request,
              commitment: toBase64(
                await pairingCommitment(
                  request.deviceId,
                  attacker.publicKey,
                  attackerNonce,
                ),
              ),
            };
      },
    };
    const first = device(forged);
    await first.vault.unlockWithRecoveryKey(recoveryKey);
    const joiner = device();
    const joining = startJoining(joiner.pairing);

    // The forgery passes every check a device can make by itself.
    const approval = await takeUp(first.pairing);

    // Only the code the person compares gives it away.
    expect(
      await codeOf(
        approval.approve(await joining.code, {
          kind: "recovery_key",
          recoveryKey,
        }),
      ),
    ).toBe("pairing_code_mismatch");
    expect(await joiner.vault.fingerprint()).toBeUndefined();
    expect(localStorage.getItem(FAKE_PAIRING_STORAGE_KEY)).not.toContain(
      "wrappedKey",
    );
  });

  it.each([
    ["the server challenge", { challenge: other32() }],
    ["the approving device's random value", { approverNonce: other32() }],
  ])(
    "changing %s for the new device changes its code",
    async (_name, change) => {
      const altered = tampering((request) =>
        request.approverNonce === undefined && "approverNonce" in change
          ? request
          : { ...request, ...change },
      );
      const joiner = device(altered);
      const joining = startJoining(joiner.pairing);
      const approval = await takeUp();

      expect(
        await codeOf(approval.approve(await joining.code, WITH_PASSPHRASE)),
      ).toBe("pairing_code_mismatch");
      expect(await joiner.vault.fingerprint()).toBeUndefined();
    },
  );

  it.each([
    ["the device ID", { deviceId: "d0000000-0000-4000-8000-0000000000ff" }],
    ["the commitment", { commitment: other32() }],
    ["the revealed value", { joinerNonce: other32() }],
  ])(
    "changing %s for the approving device is caught",
    async (_name, change) => {
      const altered = tampering((request) =>
        request.joinerNonce === undefined && "joinerNonce" in change
          ? request
          : { ...request, ...change },
      );
      const joining = startJoining(device().pairing);

      expect(await codeOf(takeUp(device(altered).pairing))).toBe(
        "pairing_tampered",
      );
      expect(await codeOf(joining.done)).toBe("pairing_rejected");
    },
  );

  it.each([
    ["not base64", { publicKey: "not base64!" }],
    ["a key of the wrong length", { publicKey: "c2hvcnQ=" }],
    ["a commitment of the wrong length", { commitment: "c2hvcnQ=" }],
    ["a challenge of the wrong length", { challenge: "c2hvcnQ=" }],
  ])("a request with %s is refused, not trusted", async (_name, change) => {
    const altered = tampering((request) => ({ ...request, ...change }));
    const joining = startJoining(device().pairing);

    expect(await codeOf(takeUp(device(altered).pairing))).toBe(
      "pairing_tampered",
    );
    expect(await codeOf(joining.done)).toBe("pairing_rejected");
  });

  it.each([
    ["garbage", () => Promise.resolve("Z2FyYmFnZQ==")],
    ["text that is not base64", () => Promise.resolve("not base64!")],
    [
      "a key sealed by someone else for another purpose",
      async (request: PairingRequest) =>
        toBase64(
          await hpkeSeal(
            fromBase64(request.publicKey),
            { info: utf8("other"), aad: new Uint8Array(0) },
            new Uint8Array(32).fill(1),
          ),
        ),
    ],
  ])(
    "a wrapped key replaced with %s is refused by the new device",
    async (_name, forge) => {
      const replacing: PairingRelay = {
        ...tampering((request) => request),
        read: async (session, id) => {
          const request = await relay.read(session, id);
          return request?.wrappedKey === undefined
            ? request
            : { ...request, wrappedKey: await forge(request) };
        },
      };
      const joiner = device(replacing);
      const joining = startJoining(joiner.pairing);
      const approval = await takeUp();
      await approval.approve(await joining.code, WITH_PASSPHRASE);

      expect(await codeOf(joining.done)).toBe("pairing_tampered");
      expect(await joiner.vault.fingerprint()).toBeUndefined();
    },
  );

  it("a wrapped key from an earlier pairing cannot be replayed into a new one", async () => {
    const earlier = startJoining(device().pairing);
    await (await takeUp()).approve(await earlier.code, WITH_PASSPHRASE);
    await earlier.done;
    const [old] = JSON.parse(
      localStorage.getItem(FAKE_PAIRING_STORAGE_KEY) ?? "[]",
    ) as { request: PairingRequest }[];
    const replaying: PairingRelay = {
      ...tampering((request) => request),
      read: async (session, id) => {
        const request = await relay.read(session, id);
        return request?.wrappedKey === undefined
          ? request
          : { ...request, wrappedKey: old?.request.wrappedKey };
      },
    };
    const joiner = device(replaying);
    const joining = startJoining(joiner.pairing);
    await (await takeUp()).approve(await joining.code, WITH_PASSPHRASE);

    expect(await codeOf(joining.done)).toBe("pairing_tampered");
    expect(await joiner.vault.fingerprint()).toBeUndefined();
  });
});

describe("a request is short-lived and single use", () => {
  it("expires for the new device after five minutes", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    await requested(joining);

    clock += 5 * 60 * 1_000;

    expect(await codeOf(joining.done)).toBe("pairing_expired");
    expect(await approver.takeUpRequest(joining.abort.signal)).toBeUndefined();
  });

  it("expires for the approving device, which then cannot hand the key over", async () => {
    const joiner = device();
    const joining = startJoining(joiner.pairing);
    const approval = await takeUp();
    const code = await joining.code;

    clock += 5 * 60 * 1_000;

    expect(await codeOf(approval.approve(code, WITH_PASSPHRASE))).toBe(
      "pairing_expired",
    );
    expect(await codeOf(joining.done)).toBe("pairing_expired");
    expect(await joiner.vault.fingerprint()).toBeUndefined();
  });

  it("judges the expiry by this device's clock too, whatever the relay says", async () => {
    const lying = tampering((request) => ({ ...request, status: "pending" }));
    const lyingClock: PairingRelay = {
      ...lying,
      read: (session, id) =>
        new FakePairingRelay(localStorage, () => 0).read(session, id),
    };
    const joining = startJoining(device(lyingClock).pairing);
    await requested(joining);

    clock += 5 * 60 * 1_000;

    expect(await codeOf(joining.done)).toBe("pairing_expired");
  });

  it("a newer request replaces an older one", async () => {
    const first = startJoining(device().pairing);
    await requested(first);
    const second = startJoining(device().pairing);

    expect(await codeOf(first.done)).toBe("pairing_expired");
    await (await takeUp()).approve(await second.code, WITH_PASSPHRASE);
    await second.done;
  });

  it("only one of two approving devices gets the request", async () => {
    const second = device();
    await second.vault.unlockWithRecoveryKey(recoveryKey);
    const joining = startJoining(device().pairing);
    await requested(joining);

    const [mine, theirs] = await Promise.all([
      approver.takeUpRequest(joining.abort.signal),
      second.pairing.takeUpRequest(joining.abort.signal),
    ]);

    expect([mine, theirs].filter((taken) => taken !== undefined)).toHaveLength(
      1,
    );
  });

  it("finds nothing when no device is waiting", async () => {
    expect(
      await approver.takeUpRequest(new AbortController().signal),
    ).toBeUndefined();
  });

  it("stops when the screen is left", async () => {
    const joining = startJoining(device().pairing);
    await requested(joining);

    joining.abort.abort();

    expect(await codeOf(joining.done)).toBe("pairing_cancelled");
  });

  it("the default timing waits, and stops waiting when the screen is left", async () => {
    const pairing = new AccountPairing(
      auth,
      new MemoryIdentityStore(),
      relay,
      approverVault,
    );
    const abort = new AbortController();
    const done = pairing.join(() => undefined, abort.signal);
    done.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));

    abort.abort();

    expect(await codeOf(done)).toBe("pairing_cancelled");
  });
});

describe("pairing never crosses accounts", () => {
  it("another account's device sees no request and cannot take it up", async () => {
    const joining = startJoining(device().pairing);
    await requested(joining);
    const mine = (await auth.currentSession()) as AuthSession;
    await auth.signOut();
    await auth.register("alex@example.com", PHRASE);
    await auth.completeVerification();
    const stranger = device();
    await stranger.vault.createAccountKeys();
    await stranger.vault.confirmRecoveryKey();

    expect(
      await stranger.pairing.takeUpRequest(new AbortController().signal),
    ).toBeUndefined();
    const theirs = (await auth.currentSession()) as AuthSession;
    expect(theirs.userId).not.toBe(mine.userId);
    const [stored] = JSON.parse(
      localStorage.getItem(FAKE_PAIRING_STORAGE_KEY) ?? "[]",
    ) as { request: PairingRequest }[];
    expect(await relay.read(theirs, stored?.request.id ?? "")).toBeUndefined();
    joining.abort.abort();
  });

  it("needs a signed-in user on both sides", async () => {
    await auth.signOut();
    const signal = new AbortController().signal;

    expect(await codeOf(device().pairing.join(() => undefined, signal))).toBe(
      "pairing_cancelled",
    );
    expect(await codeOf(approver.takeUpRequest(signal))).toBe(
      "pairing_cancelled",
    );
  });
});

describe("the pairing code", () => {
  const transcript: PairingTranscript = {
    owner: "owner",
    requestId: "request",
    deviceId: "device",
    publicKey: new Uint8Array(65).fill(4),
    commitment: new Uint8Array(32).fill(1),
    challenge: new Uint8Array(32).fill(2),
    approverNonce: new Uint8Array(32).fill(3),
    joinerNonce: new Uint8Array(32).fill(5),
  };

  it("is six digits and the same on both devices for the same exchange", async () => {
    const code = await pairingCode(transcript);

    expect(code).toMatch(/^\d{6}$/);
    expect(await pairingCode({ ...transcript })).toBe(code);
  });

  it("a relay that swaps the new device's public key changes the code (AC-19)", async () => {
    const swapped = { ...transcript, publicKey: new Uint8Array(65).fill(7) };

    expect(await pairingCode(swapped)).not.toBe(await pairingCode(transcript));
  });

  it.each([
    ["owner", { owner: "other" }],
    ["request", { requestId: "other" }],
    ["device", { deviceId: "other" }],
    ["commitment", { commitment: new Uint8Array(32).fill(9) }],
    ["challenge", { challenge: new Uint8Array(32).fill(9) }],
    ["approving device's value", { approverNonce: new Uint8Array(32).fill(9) }],
    ["new device's value", { joinerNonce: new Uint8Array(32).fill(9) }],
  ])("changes when the %s changes", async (_name, change) => {
    expect(await pairingCode({ ...transcript, ...change })).not.toBe(
      await pairingCode(transcript),
    );
  });

  it("keeps leading zeros", async () => {
    const codes = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        pairingCode({ ...transcript, requestId: `request-${String(index)}` }),
      ),
    );

    expect(codes.every((code) => code.length === 6)).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(35);
  });

  it("is shown in two groups and read back whatever separates them", () => {
    expect(formatPairingCode("042917")).toBe("042 917");
    expect(normalisePairingCode(" 042-917\n")).toBe("042917");
    expect(normalisePairingCode("o42917")).toBe("42917");
  });

  it("the commitment binds the device, the key and the value", async () => {
    const key = new Uint8Array(65).fill(4);
    const value = new Uint8Array(32).fill(5);
    const base = toBase64(await pairingCommitment("device", key, value));

    expect(base).toBe(toBase64(await pairingCommitment("device", key, value)));
    expect(fromBase64(base)).toHaveLength(32);
    for (const other of [
      await pairingCommitment("other", key, value),
      await pairingCommitment("device", new Uint8Array(65).fill(6), value),
      await pairingCommitment("device", key, new Uint8Array(32).fill(6)),
    ]) {
      expect(toBase64(other)).not.toBe(base);
    }
  });
});

describe("a build with no backend", () => {
  it("has no request to approve and cannot join", async () => {
    const pairing = new UnavailableDevicePairing();

    expect(await pairing.takeUpRequest()).toBeUndefined();
    await expect(pairing.join()).rejects.toBeInstanceOf(PairingError);
  });
});
