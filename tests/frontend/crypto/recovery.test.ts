import { describe, expect, it } from "vitest";

import { fromBase64, toBase64 } from "../../../src/crypto/encoding";
import {
  RECOVERY_FORMAT_VERSION,
  RECOVERY_SECRET_BYTES,
  RecoveryKeyError,
  RecoveryUnwrapError,
  UnsupportedRecoveryFormatError,
  formatRecoveryKey,
  generateRecoverySecret,
  lastGroupOf,
  normaliseRecoveryKey,
  parseRecoveryKey,
  unwrapRootKey,
  wrapRootKey,
} from "../../../src/crypto/recovery";
import { generateRootKeyBytes } from "../../../src/crypto/root-key";

const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
const OTHER_OWNER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// Bytes 0..31: synthetic, and the same secret the committed fixture uses.
const FIXED_SECRET = new Uint8Array(RECOVERY_SECRET_BYTES).map((_, i) => i);

async function problem(typed: string): Promise<string> {
  try {
    await parseRecoveryKey(typed);
  } catch (error) {
    expect(error).toBeInstanceOf(RecoveryKeyError);
    return (error as RecoveryKeyError).problem;
  }
  throw new Error("expected the key to be refused");
}

describe("recovery key text (SEC-003, D-04)", () => {
  it("is 256 random bits", () => {
    const first = generateRecoverySecret();
    const second = generateRecoverySecret();

    expect(first).toHaveLength(32);
    expect(toBase64(first)).not.toBe(toBase64(second));
  });

  it("is shown as 14 groups of 4 unambiguous characters", async () => {
    const text = await formatRecoveryKey(generateRecoverySecret());

    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(text).not.toMatch(/[ILOU]/);
  });

  it("has a stable text form for a given secret", async () => {
    expect(await formatRecoveryKey(FIXED_SECRET)).toBe(
      await formatRecoveryKey(FIXED_SECRET.slice()),
    );
    expect(await formatRecoveryKey(FIXED_SECRET)).toBe(
      "000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFQ-2PWF",
    );
  });

  it("refuses to format a secret of the wrong length", async () => {
    await expect(formatRecoveryKey(new Uint8Array(31))).rejects.toThrow(
      /32 bytes/,
    );
  });

  it("reads back exactly the secret that was shown", async () => {
    const secret = generateRecoverySecret();

    const parsed = await parseRecoveryKey(await formatRecoveryKey(secret));

    expect(toBase64(parsed)).toBe(toBase64(secret));
  });

  it("ignores case, spaces, dashes and line breaks when typed", async () => {
    const secret = generateRecoverySecret();
    const shown = await formatRecoveryKey(secret);
    const typed = `  ${shown.toLowerCase().replaceAll("-", " ")}\n`;

    expect(toBase64(await parseRecoveryKey(typed))).toBe(toBase64(secret));
    expect(toBase64(await parseRecoveryKey(shown.replaceAll("-", "")))).toBe(
      toBase64(secret),
    );
  });

  it("reads O as 0 and I or L as 1", async () => {
    const shown = await formatRecoveryKey(FIXED_SECRET);
    const typed = shown.replaceAll("0", "o").replaceAll("1", "l");
    const alsoTyped = shown.replaceAll("0", "O").replaceAll("1", "I");

    expect(typed).not.toBe(shown);
    expect(toBase64(await parseRecoveryKey(typed))).toBe(
      toBase64(FIXED_SECRET),
    );
    expect(toBase64(await parseRecoveryKey(alsoTyped))).toBe(
      toBase64(FIXED_SECRET),
    );
  });

  it("catches a single mistyped character", async () => {
    const shown = await formatRecoveryKey(FIXED_SECRET);

    for (const index of [0, 7, 30, shown.length - 1]) {
      const original = shown.charAt(index);
      const replacement = original === "Z" ? "Y" : "Z";
      const typed =
        shown.slice(0, index) + replacement + shown.slice(index + 1);

      expect(await problem(typed)).toBe("mistyped");
    }
  });

  it("catches two swapped groups", async () => {
    const groups = (await formatRecoveryKey(FIXED_SECRET)).split("-");
    [groups[2], groups[3]] = [groups[3] ?? "", groups[2] ?? ""];

    expect(await problem(groups.join("-"))).toBe("mistyped");
  });

  it.each([
    ["nothing", ""],
    ["a short key", "0000-0000"],
    ["a group too many", `${"0000-".repeat(14)}0000`],
    ["a letter keys never contain", `${"0000-".repeat(13)}000U`],
    ["punctuation", `${"0000-".repeat(13)}00!0`],
    ["the fake vault's key", "FAKE-KEY0-NOT0-REAL-0000-TEST"],
  ])("calls %s malformed, not mistyped", async (_name, typed) => {
    expect(await problem(typed)).toBe("malformed");
  });

  it("never includes the typed text in the error", async () => {
    const typed = `${"ABCD-".repeat(13)}ABCD`;

    try {
      await parseRecoveryKey(typed);
    } catch (error) {
      expect(String(error)).not.toContain("ABCD");
    }
  });

  it("normalises and finds the last group for the confirmation step", async () => {
    const shown = await formatRecoveryKey(FIXED_SECRET);

    expect(normaliseRecoveryKey(" ab-cd ol ")).toBe("ABCD01");
    expect(lastGroupOf(shown)).toBe(shown.split("-").at(-1));
    expect(lastGroupOf(shown)).toHaveLength(4);
  });
});

describe("recovery envelope (SEC-003, DEV-001 path B)", () => {
  it("wraps and unwraps the root key", async () => {
    const secret = generateRecoverySecret();
    const root = generateRootKeyBytes();

    const envelope = await wrapRootKey(secret, OWNER, root);

    expect(envelope[0]).toBe(RECOVERY_FORMAT_VERSION);
    expect(envelope).toHaveLength(1 + 12 + 32 + 16);
    expect(toBase64(await unwrapRootKey(secret, OWNER, envelope))).toBe(
      toBase64(root),
    );
  });

  it("does not contain the root key or the secret", async () => {
    const secret = generateRecoverySecret();
    const root = generateRootKeyBytes();

    const envelope = atob(toBase64(await wrapRootKey(secret, OWNER, root)));

    expect(envelope).not.toContain(atob(toBase64(root)));
    expect(envelope).not.toContain(atob(toBase64(secret)));
  });

  it("is different every time, even for the same inputs", async () => {
    const secret = generateRecoverySecret();
    const root = generateRootKeyBytes();

    const first = await wrapRootKey(secret, OWNER, root);
    const second = await wrapRootKey(secret, OWNER, root);

    expect(toBase64(first)).not.toBe(toBase64(second));
  });

  it("cannot be opened with another recovery key", async () => {
    const envelope = await wrapRootKey(
      generateRecoverySecret(),
      OWNER,
      generateRootKeyBytes(),
    );

    await expect(
      unwrapRootKey(generateRecoverySecret(), OWNER, envelope),
    ).rejects.toBeInstanceOf(RecoveryUnwrapError);
  });

  it("cannot be opened as another account's", async () => {
    const secret = generateRecoverySecret();
    const envelope = await wrapRootKey(secret, OWNER, generateRootKeyBytes());

    await expect(
      unwrapRootKey(secret, OTHER_OWNER, envelope),
    ).rejects.toBeInstanceOf(RecoveryUnwrapError);
  });

  it("detects any altered byte", async () => {
    const secret = generateRecoverySecret();
    const envelope = await wrapRootKey(secret, OWNER, generateRootKeyBytes());

    for (const index of [1, 12, 13, 44, 45, 60]) {
      const altered = envelope.slice();
      altered[index] = (altered[index] ?? 0) ^ 1;

      await expect(
        unwrapRootKey(secret, OWNER, altered),
      ).rejects.toBeInstanceOf(RecoveryUnwrapError);
    }
  });

  it.each([0, 1, 13, 60, 62])(
    "refuses an envelope of %d bytes",
    async (length) => {
      const envelope = new Uint8Array(length);
      envelope[0] = RECOVERY_FORMAT_VERSION;

      await expect(
        unwrapRootKey(generateRecoverySecret(), OWNER, envelope),
      ).rejects.toBeInstanceOf(RecoveryUnwrapError);
    },
  );

  it("fails closed on a format it does not know", async () => {
    const secret = generateRecoverySecret();
    const envelope = await wrapRootKey(secret, OWNER, generateRootKeyBytes());
    envelope[0] = 2;

    const attempt = unwrapRootKey(secret, OWNER, envelope);

    await expect(attempt).rejects.toBeInstanceOf(
      UnsupportedRecoveryFormatError,
    );
    await expect(attempt).rejects.toMatchObject({ version: 2 });
  });

  it("refuses root-key material of the wrong length", async () => {
    await expect(
      wrapRootKey(generateRecoverySecret(), OWNER, new Uint8Array(16)),
    ).rejects.toThrow(/32 bytes/);
  });

  it("says nothing about why an envelope did not open", async () => {
    const error = new RecoveryUnwrapError();

    expect(error.message).toBe("The recovery envelope could not be opened");
  });

  it("a password is not a recovery key: it cannot open the envelope (AC-18)", async () => {
    const secret = generateRecoverySecret();
    const envelope = await wrapRootKey(secret, OWNER, generateRootKeyBytes());
    const password = ["staple", "window", "orange"].join(" ");

    // A password does not even parse as a key, and using its bytes as the
    // secret opens nothing. Resetting it changes no key material.
    expect(await problem(password)).toBe("malformed");
    const asSecret = new Uint8Array(RECOVERY_SECRET_BYTES);
    asSecret.set(new TextEncoder().encode(password).subarray(0, 32));
    await expect(
      unwrapRootKey(asSecret, OWNER, envelope),
    ).rejects.toBeInstanceOf(RecoveryUnwrapError);
  });

  it("opens the committed version 1 fixture (REL-004)", async () => {
    const fixture = (await import("../../fixtures/crypto/v1/recovery.json"))
      .default;
    const secret = await parseRecoveryKey(fixture.recoveryKey);

    const root = await unwrapRootKey(
      secret,
      fixture.owner,
      fromBase64(fixture.envelope),
    );

    expect(toBase64(secret)).toBe(toBase64(FIXED_SECRET));
    expect(toBase64(root)).toBe(fixture.rootKey);
  });
});
