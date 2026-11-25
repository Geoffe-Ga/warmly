import { describe, expect, it } from "vitest";

import { fromBase64, toBase64, utf8 } from "../../../src/crypto/encoding";
import {
  SIGNATURE_VERSION,
  deviceEnrollmentVerifier,
  enrollmentProof,
  newNonce,
  signingMessage,
} from "../../../src/devices/signing";
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

describe("proving a new device knows the root key (DEV-002)", () => {
  it("derives the fixture's verifier and proof from the fixture's root key", async () => {
    const root = await fixtureRootKey();

    expect(toBase64(await deviceEnrollmentVerifier(root))).toBe(
      fixture.enrollment.verifier,
    );
    expect(
      await enrollmentProof(root, fixture.deviceId, fixture.publicKey),
    ).toBe(fixture.enrollment.proof);
  });

  it("gives a different verifier and proof for a different root key", async () => {
    const other = await otherRootKey();

    expect(toBase64(await deviceEnrollmentVerifier(other))).not.toBe(
      fixture.enrollment.verifier,
    );
    expect(
      await enrollmentProof(other, fixture.deviceId, fixture.publicKey),
    ).not.toBe(fixture.enrollment.proof);
  });

  it("binds the proof to the device ID and to the public key", async () => {
    const root = await fixtureRootKey();

    expect(
      await enrollmentProof(root, "another-device", fixture.publicKey),
    ).not.toBe(fixture.enrollment.proof);
    expect(
      await enrollmentProof(root, fixture.deviceId, "another-key"),
    ).not.toBe(fixture.enrollment.proof);
  });
});
