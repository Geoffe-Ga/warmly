import { describe, expect, it } from "vitest";

import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import { DecryptError, open } from "../../../src/crypto/envelope";
import { fingerprint, importRootKey } from "../../../src/crypto/root-key";

interface FixtureRecord {
  readonly name: string;
  readonly owner: string;
  readonly recordId: string;
  readonly type: number;
  readonly plaintext: string;
  readonly envelope: string;
}

interface FixtureFile {
  readonly formatVersion: number;
  readonly rootKey: string;
  readonly rootKeyFingerprint: string;
  readonly records: readonly FixtureRecord[];
}

// Every committed fixture version. A new format adds a directory here; the
// old ones stay, so old data can always still be opened (REL-004).
const FILES = import.meta.glob<FixtureFile>(
  "../../fixtures/crypto/*/records.json",
  {
    eager: true,
    import: "default",
  },
);

const FIXTURES = Object.entries(FILES).flatMap(([path, file]) =>
  file.records.map((record) => ({ path, file, record })),
);

function field(value: string): Uint8Array<ArrayBuffer> {
  const bytes = utf8(value);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = bytes.length >> 8;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function join(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Open a version 1 envelope using only WebCrypto and the description of the
 * format in ADR-0003. It shares no code with src/crypto, so agreement between
 * the two means the documented format is the implemented one.
 */
async function openFromSpecification(
  rootKey: Uint8Array<ArrayBuffer>,
  record: FixtureRecord,
  keyOwner: string = record.owner,
): Promise<Uint8Array> {
  const envelope = fromBase64(record.envelope);
  const version = new Uint8Array([1]);
  const hkdfKey = await crypto.subtle.importKey("raw", rootKey, "HKDF", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8("warmly/hkdf-salt/v1"),
      info: join(
        utf8("warmly/record-key/"),
        version,
        field(keyOwner),
        field(record.recordId),
      ),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: envelope.subarray(1, 13),
      additionalData: join(
        version,
        field(record.owner),
        field(record.recordId),
        new Uint8Array([record.type]),
      ),
    },
    key,
    envelope.subarray(13),
  );
  return new Uint8Array(plaintext);
}

describe("committed encrypted fixtures (REL-004)", () => {
  it("exist for format version 1", () => {
    expect(Object.keys(FILES).some((path) => path.includes("/v1/"))).toBe(true);
    expect(FIXTURES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(FILES))(
    "%s carries the fingerprint of its root key",
    async (_path, file) => {
      const root = await importRootKey(fromBase64(file.rootKey));

      expect(await fingerprint(root)).toBe(file.rootKeyFingerprint);
    },
  );

  it.each(FIXTURES)(
    "$record.name opens with the current code",
    async ({ file, record }) => {
      const root = await importRootKey(fromBase64(file.rootKey));

      const plaintext = await open(root, record, fromBase64(record.envelope));

      expect(toBase64(plaintext)).toBe(record.plaintext);
    },
  );

  it.each(FIXTURES.filter(({ file }) => file.formatVersion === 1))(
    "$record.name opens with an independent implementation of the v1 format",
    async ({ file, record }) => {
      const plaintext = await openFromSpecification(
        fromBase64(file.rootKey),
        record,
      );

      expect(toBase64(plaintext)).toBe(record.plaintext);
      expect(fromBase64(record.envelope)[0]).toBe(file.formatVersion);
    },
  );

  it.each(FIXTURES.filter(({ file }) => file.formatVersion === 1))(
    "$record.name has a key that depends on the owner, not only the record",
    async ({ file, record }) => {
      // The associated data is left correct here, so only the key differs.
      await expect(
        openFromSpecification(
          fromBase64(file.rootKey),
          record,
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        ),
      ).rejects.toThrow();
    },
  );

  it.each(FIXTURES)(
    "$record.name does not open as a different record",
    async ({ file, record }) => {
      const root = await importRootKey(fromBase64(file.rootKey));
      const other = { ...record, recordId: `${record.recordId}-other` };

      await expect(
        open(root, other, fromBase64(record.envelope)),
      ).rejects.toBeInstanceOf(DecryptError);
    },
  );
});
