import { describe, expect, it } from "vitest";

import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import {
  DecryptError,
  FORMAT_VERSION,
  NONCE_BYTES,
  UnsupportedFormatError,
  open,
  openJson,
  seal,
  sealJson,
  type RecordContext,
} from "../../../src/crypto/envelope";
import {
  ROOT_KEY_BYTES,
  fingerprint,
  generateRootKeyBytes,
  importRootKey,
} from "../../../src/crypto/root-key";

const OWNER = "0b0f7c1e-5a2d-4a53-9c1d-2f6a3e1b7c90";
const RECORD_A = "11111111-1111-4111-8111-111111111111";
const RECORD_B = "22222222-2222-4222-8222-222222222222";
const CONTEXT: RecordContext = { owner: OWNER, recordId: RECORD_A, type: 1 };
const PLAINTEXT = utf8("What's going well? We cooked dinner together.");

async function newRoot() {
  return importRootKey(generateRootKeyBytes());
}

function flipBit(
  bytes: Uint8Array<ArrayBuffer>,
  index: number,
): Uint8Array<ArrayBuffer> {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

describe("root key (SEC-002)", () => {
  it("is 256 bits of fresh randomness each time", () => {
    const first = generateRootKeyBytes();
    const second = generateRootKeyBytes();

    expect(first).toHaveLength(ROOT_KEY_BYTES);
    expect(ROOT_KEY_BYTES).toBe(32);
    expect(toBase64(first)).not.toBe(toBase64(second));
  });

  it("rejects key material of the wrong length", async () => {
    await expect(importRootKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });

  it("cannot be exported once imported", async () => {
    const root = await newRoot();

    expect(root.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", root.key)).rejects.toThrow();
  });

  it("has a stable fingerprint that differs between keys", async () => {
    const bytes = generateRootKeyBytes();
    const same = [await importRootKey(bytes), await importRootKey(bytes)];
    const other = await newRoot();

    const [a, b] = await Promise.all(same.map(fingerprint));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await fingerprint(other)).not.toBe(a);
  });

  it("does not reveal the key through its fingerprint", async () => {
    const bytes = generateRootKeyBytes();
    const print = await fingerprint(await importRootKey(bytes));
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

    expect(hex).not.toContain(print);
  });
});

describe("record envelope (SEC-002, AC-04)", () => {
  it("round-trips a record", async () => {
    const root = await newRoot();

    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    // Compared as text: jsdom and Node each have their own Uint8Array class.
    expect(toBase64(await open(root, CONTEXT, envelope))).toBe(
      toBase64(PLAINTEXT),
    );
  });

  it("round-trips an empty record", async () => {
    const root = await newRoot();

    const envelope = await seal(root, CONTEXT, new Uint8Array());

    expect(await open(root, CONTEXT, envelope)).toHaveLength(0);
  });

  it("has the documented layout: version, nonce, ciphertext and tag", async () => {
    const root = await newRoot();

    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    expect(envelope[0]).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBe(1);
    expect(NONCE_BYTES).toBe(12);
    expect(envelope).toHaveLength(1 + 12 + PLAINTEXT.length + 16);
  });

  it("contains no plaintext", async () => {
    const root = await newRoot();
    const canary = "CANARY-journal-plaintext";

    const envelope = await seal(root, CONTEXT, utf8(canary));

    expect(new TextDecoder().decode(envelope)).not.toContain("CANARY");
    expect(atob(toBase64(envelope))).not.toContain(canary);
  });

  it("uses a fresh nonce every time, so equal plaintexts differ", async () => {
    const root = await newRoot();

    const sealed = await Promise.all(
      Array.from({ length: 50 }, () => seal(root, CONTEXT, PLAINTEXT)),
    );
    const nonces = sealed.map((e) => toBase64(e.slice(1, 1 + NONCE_BYTES)));

    expect(new Set(nonces).size).toBe(50);
    expect(new Set(sealed.map(toBase64)).size).toBe(50);
  });

  it("rejects a record replayed under another record ID", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    await expect(
      open(root, { ...CONTEXT, recordId: RECORD_B }, envelope),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a record presented as another owner's", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    await expect(
      open(root, { ...CONTEXT, owner: RECORD_B }, envelope),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a record presented as another type", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    await expect(
      open(root, { ...CONTEXT, type: 2 }, envelope),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a record opened with a different root key", async () => {
    const envelope = await seal(await newRoot(), CONTEXT, PLAINTEXT);

    await expect(
      open(await newRoot(), CONTEXT, envelope),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects any single flipped bit in the nonce, ciphertext or tag", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    for (let index = 1; index < envelope.length; index += 1) {
      await expect(
        open(root, CONTEXT, flipBit(envelope, index)),
        `byte ${String(index)}`,
      ).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects a truncated envelope", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    for (const length of [0, 1, 12, 13, 28, envelope.length - 1]) {
      await expect(
        open(root, CONTEXT, envelope.slice(0, length)),
        `length ${String(length)}`,
      ).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it.each([0, 2, 255])(
    "fails closed on unknown format version %i",
    async (version) => {
      const root = await newRoot();
      const envelope = await seal(root, CONTEXT, PLAINTEXT);
      envelope[0] = version;

      await expect(open(root, CONTEXT, envelope)).rejects.toBeInstanceOf(
        UnsupportedFormatError,
      );
    },
  );

  it("names the unsupported version without revealing anything else", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);
    envelope[0] = 9;

    await expect(open(root, CONTEXT, envelope)).rejects.toThrow(
      "Unsupported envelope format version 9",
    );
  });

  it("gives decrypt failures one uninformative message", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, PLAINTEXT);

    await expect(
      open(root, { ...CONTEXT, recordId: RECORD_B }, envelope),
    ).rejects.toThrow("The record could not be decrypted");
  });

  it("cannot be confused by fields that run together", async () => {
    // "ab" + "c" and "a" + "bc" must not produce the same binding.
    const root = await newRoot();
    const envelope = await seal(
      root,
      { owner: "ab", recordId: "c", type: 1 },
      PLAINTEXT,
    );

    await expect(
      open(root, { owner: "a", recordId: "bc", type: 1 }, envelope),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it.each([-1, 256, 1.5, Number.NaN])(
    "refuses to seal with record type %s",
    async (type) => {
      const root = await newRoot();

      await expect(seal(root, { ...CONTEXT, type }, PLAINTEXT)).rejects.toThrow(
        /record type/i,
      );
    },
  );

  it.each(["", "x".repeat(65_536)])(
    "refuses to seal with an owner or record ID of length %#",
    async (value) => {
      const root = await newRoot();

      await expect(
        seal(root, { ...CONTEXT, recordId: value }, PLAINTEXT),
      ).rejects.toThrow(/identifier/i);
    },
  );

  it.each([
    ["a lone high surrogate", "record-\ud83d"],
    ["a lone low surrogate", "\udc9b-record"],
  ])(
    "refuses an identifier with %s, which has no UTF-8 form",
    async (_name, value) => {
      const root = await newRoot();
      const envelope = await seal(root, CONTEXT, PLAINTEXT);

      for (const context of [
        { ...CONTEXT, recordId: value },
        { ...CONTEXT, owner: value },
      ]) {
        await expect(seal(root, context, PLAINTEXT)).rejects.toThrow(
          /well-formed/,
        );
        await expect(open(root, context, envelope)).rejects.toThrow(
          /well-formed/,
        );
      }
    },
  );

  it("accepts an identifier with a properly paired surrogate", async () => {
    const root = await newRoot();
    const context = { ...CONTEXT, recordId: "record-\ud83d\udc9b" };

    const envelope = await seal(root, context, PLAINTEXT);

    expect(toBase64(await open(root, context, envelope))).toBe(
      toBase64(PLAINTEXT),
    );
  });
});

describe("JSON records", () => {
  it("round-trips a structured record", async () => {
    const root = await newRoot();
    const entry = {
      responses: { good: "cooked dinner", improve: "listening", loved: "tea" },
      feelings: ["calm", "grateful"],
      unicode: "naïve café 💛",
    };

    const envelope = await sealJson(root, CONTEXT, entry);

    expect(await openJson(root, CONTEXT, envelope)).toEqual(entry);
  });

  it("rejects decrypted bytes that are not JSON", async () => {
    const root = await newRoot();
    const envelope = await seal(root, CONTEXT, utf8("not json {"));

    await expect(openJson(root, CONTEXT, envelope)).rejects.toBeInstanceOf(
      DecryptError,
    );
  });
});

describe("encoding", () => {
  it("round-trips bytes through standard base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);

    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    expect(toBase64(bytes)).toBe("AAEC+vv8/f7/");
  });

  it("produces what the API accepts as an opaque payload", async () => {
    const root = await newRoot();

    const encoded = toBase64(await seal(root, CONTEXT, PLAINTEXT));

    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("handles a payload far larger than a call-stack-sized chunk", () => {
    const bytes = new Uint8Array(300_000).map((_, index) => index % 251);

    expect(toBase64(fromBase64(toBase64(bytes)))).toBe(toBase64(bytes));
  });

  it("rejects text that is not base64", () => {
    expect(() => fromBase64("not base64!")).toThrow(/base64/i);
  });
});
