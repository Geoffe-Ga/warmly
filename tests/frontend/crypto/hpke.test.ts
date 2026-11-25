import { describe, expect, it } from "vitest";

import { toBase64, utf8 } from "../../../src/crypto/encoding";
import {
  HPKE_PUBLIC_KEY_BYTES,
  HpkeOpenError,
  generateRecipientKey,
  hpkeOpen,
  hpkeSeal,
} from "../../../src/crypto/hpke";
import vectors from "../../fixtures/hpke/rfc9180-p256-sha256-aes256gcm.json";

type Bytes = Uint8Array<ArrayBuffer>;

function fromHex(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Import a P-256 private key from its scalar and public point. */
function privateKey(scalar: string, point: string): Promise<CryptoKey> {
  const publicBytes = fromHex(point);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64Url(fromHex(scalar)),
      x: base64Url(publicBytes.slice(1, 33)),
      y: base64Url(publicBytes.slice(33)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

function publicKey(point: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromHex(point),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

const MESSAGE = { info: utf8("purpose"), aad: utf8("context") };
const SECRET = new Uint8Array(32).fill(9);

describe("HPKE matches the RFC 9180 test vectors (ADR-0005)", () => {
  it("has a vector to check against", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors)(
    "seals to the vector's ciphertext with the vector's one-time key",
    async (vector) => {
      const sealed = await hpkeSeal(
        fromHex(vector.pkRm),
        { info: fromHex(vector.info), aad: fromHex(vector.aad) },
        fromHex(vector.plaintext),
        {
          privateKey: await privateKey(vector.skEm, vector.pkEm),
          publicKey: await publicKey(vector.pkEm),
        },
      );

      expect(toHex(sealed)).toBe(vector.enc + vector.ciphertext);
    },
  );

  it.each(vectors)("opens the vector's ciphertext", async (vector) => {
    const plaintext = await hpkeOpen(
      {
        privateKey: await privateKey(vector.skRm, vector.pkRm),
        publicKey: fromHex(vector.pkRm),
      },
      { info: fromHex(vector.info), aad: fromHex(vector.aad) },
      fromHex(vector.enc + vector.ciphertext),
    );

    expect(toHex(plaintext)).toBe(vector.plaintext);
  });
});

describe("sealing a secret to a new device's key", () => {
  it("round-trips, and the recipient key cannot be exported", async () => {
    const recipient = await generateRecipientKey();

    const sealed = await hpkeSeal(recipient.publicKey, MESSAGE, SECRET);

    expect(recipient.publicKey).toHaveLength(HPKE_PUBLIC_KEY_BYTES);
    expect(recipient.publicKey[0]).toBe(4);
    expect(recipient.privateKey.extractable).toBe(false);
    expect(sealed).toHaveLength(HPKE_PUBLIC_KEY_BYTES + SECRET.length + 16);
    expect(toHex(await hpkeOpen(recipient, MESSAGE, sealed))).toBe(
      toHex(SECRET),
    );
  });

  it("never produces the same bytes twice, and never contains the secret", async () => {
    const recipient = await generateRecipientKey();

    const first = toHex(await hpkeSeal(recipient.publicKey, MESSAGE, SECRET));
    const second = toHex(await hpkeSeal(recipient.publicKey, MESSAGE, SECRET));

    expect(first).not.toBe(second);
    expect(first.slice(0, 130)).not.toBe(second.slice(0, 130));
    expect(first).not.toContain(toHex(SECRET));
  });

  it.each([
    ["another recipient", "recipient"],
    ["different info", "info"],
    ["different associated data", "aad"],
    ["an altered ciphertext", "ciphertext"],
    ["an altered sender key", "enc"],
    ["a sender key that is not on the curve", "invalid"],
    ["a truncated message", "short"],
    ["an empty message", "empty"],
  ])("cannot be opened with %s", async (_name, change) => {
    const recipient = await generateRecipientKey();
    const sealed = await hpkeSeal(recipient.publicKey, MESSAGE, SECRET);
    const altered = sealed.slice();
    const last = altered.length - 1;
    altered[last] = (altered[last] ?? 0) ^ 1;
    const swapped = sealed.slice();
    swapped.set((await generateRecipientKey()).publicKey, 0);
    const invalid = sealed.slice();
    invalid.fill(0xff, 1, HPKE_PUBLIC_KEY_BYTES);

    const attempts: Record<string, Promise<unknown>> = {
      recipient: hpkeOpen(await generateRecipientKey(), MESSAGE, sealed),
      info: hpkeOpen(recipient, { ...MESSAGE, info: utf8("other") }, sealed),
      aad: hpkeOpen(recipient, { ...MESSAGE, aad: utf8("other") }, sealed),
      ciphertext: hpkeOpen(recipient, MESSAGE, altered),
      enc: hpkeOpen(recipient, MESSAGE, swapped),
      invalid: hpkeOpen(recipient, MESSAGE, invalid),
      short: hpkeOpen(recipient, MESSAGE, sealed.slice(0, 40)),
      empty: hpkeOpen(recipient, MESSAGE, new Uint8Array(0)),
    };
    for (const [name, attempt] of Object.entries(attempts)) {
      if (name !== change) {
        attempt.catch(() => undefined);
      }
    }

    await expect(attempts[change]).rejects.toBeInstanceOf(HpkeOpenError);
  });

  it("refuses to seal to a key that is not a P-256 point", async () => {
    await expect(
      hpkeSeal(new Uint8Array(65).fill(4), MESSAGE, SECRET),
    ).rejects.toThrow();
  });

  it("says nothing about why opening failed", () => {
    expect(new HpkeOpenError().message).toBe(
      "The sealed message could not be opened",
    );
  });
});
