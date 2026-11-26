import { describe, expect, it } from "vitest";

import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import { importRootKey } from "../../../src/crypto/root-key";
import {
  ENROLLMENT_PROOF_VERSION,
  SIGNATURE_VERSION,
  deviceEnrollmentKey,
  enrollmentProof,
  newNonce,
  signingMessage,
} from "../../../src/devices/signing";
import enrollment from "../../fixtures/enrollment/v2.json";
import fixture from "../../fixtures/signing/v1.json";
import { fixtureRootKey, otherRootKey } from "./helpers";

/**
 * `tests/fixtures/signing/v1.json` is also checked by the server's tests
 * (`tests/auth/test_signing_fixture.py`), so the browser and the server
 * cannot disagree about what is signed (ADR-0005, D-06).
 */
describe("the signed message matches the committed fixture", () => {
  it("is for the version this code writes", () => {
    expect(fixture.signatureVersion).toBe(SIGNATURE_VERSION);
  });

  it.each(fixture.requests)(
    "builds the fixture's message for $name",
    async (request) => {
      const message = await signingMessage({
        method: request.method,
        target: request.target,
        body: fromBase64(request.body),
        deviceId: fixture.deviceId,
        timestamp: request.timestamp,
        nonce: request.nonce,
      });

      expect(new TextDecoder().decode(message)).toBe(request.message);
    },
  );

  it.each(fixture.requests)(
    "the fixture's signature for $name verifies under its public key",
    async (request) => {
      const key = await crypto.subtle.importKey(
        "raw",
        fromBase64(fixture.publicKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );

      expect(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          fromBase64(request.signature),
          utf8(request.message),
        ),
      ).toBe(true);
    },
  );

  it("upper-cases the method, so the server and the browser agree", async () => {
    const parts = {
      target: "/v1/devices",
      body: new Uint8Array(),
      deviceId: fixture.deviceId,
      timestamp: 1,
      nonce: "n",
    };

    expect(await signingMessage({ ...parts, method: "get" })).toEqual(
      await signingMessage({ ...parts, method: "GET" }),
    );
  });

  it.each([
    ["method", { method: "PUT" }],
    ["target", { target: "/v1/devices?x=1" }],
    ["body", { body: utf8("{}") }],
    ["device", { deviceId: "another" }],
    ["timestamp", { timestamp: 2 }],
    ["nonce", { nonce: "m" }],
  ])("changes when the %s changes", async (_part, change) => {
    const base = {
      method: "GET",
      target: "/v1/devices",
      body: new Uint8Array(),
      deviceId: fixture.deviceId,
      timestamp: 1,
      nonce: "n",
    };

    expect(await signingMessage({ ...base, ...change })).not.toEqual(
      await signingMessage(base),
    );
  });
});

describe("nonces", () => {
  it("are 24 URL-safe characters and do not repeat", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => newNonce()));

    expect(nonces.size).toBe(200);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });
});

/**
 * `tests/fixtures/enrollment/v2.json` was made by Python's `cryptography`
 * and is also checked by the server's tests, so two independent
 * implementations agree on how the key is derived and what is signed.
 */
describe("proving a new device knows the root key (DEV-002, issue 84)", () => {
  async function verifies(
    enrollmentKey: Uint8Array<ArrayBuffer>,
    proof: string,
    deviceId: string,
    publicKey: string,
  ): Promise<boolean> {
    const key = await crypto.subtle.importKey(
      "raw",
      enrollmentKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      fromBase64(proof),
      utf8([ENROLLMENT_PROOF_VERSION, deviceId, publicKey].join("\n")),
    );
  }

  it("is for the version this code writes", () => {
    expect(enrollment.proofVersion).toBe(ENROLLMENT_PROOF_VERSION);
  });

  it("derives the fixture's public key and proof from the fixture's root key", async () => {
    const root = await importRootKey(fromBase64(enrollment.rootKey));

    expect(toBase64(await deviceEnrollmentKey(root))).toBe(
      enrollment.enrollmentKey,
    );
    expect(
      await enrollmentProof(
        root,
        enrollment.deviceId,
        enrollment.devicePublicKey,
      ),
    ).toBe(enrollment.proof);
  });

  it("makes a proof the public key verifies", async () => {
    const root = await fixtureRootKey();
    const key = await deviceEnrollmentKey(root);
    const proof = await enrollmentProof(root, "device-1", "key-1");

    expect(key).toHaveLength(32);
    expect(fromBase64(proof)).toHaveLength(64);
    expect(await verifies(key, proof, "device-1", "key-1")).toBe(true);
  });

  it("gives a different key and proof for a different root key, and neither key accepts the other's proof", async () => {
    const root = await fixtureRootKey();
    const other = await otherRootKey();
    const key = await deviceEnrollmentKey(root);
    const otherKey = await deviceEnrollmentKey(other);
    const otherProof = await enrollmentProof(other, "device-1", "key-1");

    expect(toBase64(otherKey)).not.toBe(toBase64(key));
    expect(await verifies(otherKey, otherProof, "device-1", "key-1")).toBe(
      true,
    );
    expect(await verifies(key, otherProof, "device-1", "key-1")).toBe(false);
  });

  it("binds the proof to the device ID and to the public key", async () => {
    const root = await fixtureRootKey();
    const key = await deviceEnrollmentKey(root);
    const proof = await enrollmentProof(root, "device-1", "key-1");

    expect(await verifies(key, proof, "device-2", "key-1")).toBe(false);
    expect(await verifies(key, proof, "device-1", "key-2")).toBe(false);
  });

  it("cannot be made from the public key alone", async () => {
    // What the server holds is the public key. Used as an HMAC key, the way
    // the old proof was made, it gives nothing the public key verifies.
    const root = await fixtureRootKey();
    const key = await deviceEnrollmentKey(root);
    const message = utf8(
      [ENROLLMENT_PROOF_VERSION, "device-1", "key-1"].join("\n"),
    );
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", hmacKey, message),
    );
    const forged = toBase64(new Uint8Array([...mac, ...mac]));

    expect(await verifies(key, forged, "device-1", "key-1")).toBe(false);
  });

  it("makes the same key every time, on any device that holds the root key", async () => {
    const first = await deviceEnrollmentKey(await fixtureRootKey());
    const second = await deviceEnrollmentKey(await fixtureRootKey());

    expect(toBase64(second)).toBe(toBase64(first));
  });
});
