/**
 * The account's enrollment key in a real browser engine (ADR-0005,
 * issue 84; PRD DEV-002).
 *
 * `tests/fixtures/enrollment/v2.json` was made by Python's `cryptography`.
 * The unit tests check the app's code against it in Node. This checks the
 * two browser engines the app supports: each must derive the same public
 * key and make the same proof from the fixture's root key, or a device
 * added in one browser could not be registered from another.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "../fixtures/test";

interface EnrollmentFixture {
  readonly proofVersion: string;
  readonly rootKey: string;
  readonly enrollmentKey: string;
  readonly deviceId: string;
  readonly devicePublicKey: string;
  readonly proof: string;
}

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../tests/fixtures/enrollment/v2.json", import.meta.url),
    ),
    "utf8",
  ),
) as EnrollmentFixture;

test("this engine derives the fixture's enrollment key and proof", async ({
  page,
}) => {
  await page.goto("/help");

  const made = await page.evaluate(async (fixture) => {
    const bytes = (text: string): Uint8Array<ArrayBuffer> =>
      Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
    const base64 = (value: ArrayBuffer | Uint8Array): string =>
      btoa(String.fromCharCode(...new Uint8Array(value)));
    const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
      new TextEncoder().encode(text);

    const root = await crypto.subtle.importKey(
      "raw",
      bytes(fixture.rootKey),
      "HKDF",
      false,
      ["deriveBits"],
    );
    const seed = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: utf8("warmly/hkdf-salt/v1"),
          info: utf8("warmly/device-enrollment/v2"),
        },
        root,
        256,
      ),
    );
    const pkcs8 = new Uint8Array([
      0x30,
      0x2e,
      0x02,
      0x01,
      0x00,
      0x30,
      0x05,
      0x06,
      0x03,
      0x2b,
      0x65,
      0x70,
      0x04,
      0x22,
      0x04,
      0x20,
      ...seed,
    ]);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", key);
    const publicKey = (jwk.x ?? "")
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(44, "=");
    const message = utf8(
      [fixture.proofVersion, fixture.deviceId, fixture.devicePublicKey].join(
        "\n",
      ),
    );
    const proof = await crypto.subtle.sign({ name: "Ed25519" }, key, message);
    const verifier = await crypto.subtle.importKey(
      "raw",
      bytes(fixture.enrollmentKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return {
      publicKey,
      proof: base64(proof),
      fixtureProofVerifies: await crypto.subtle.verify(
        { name: "Ed25519" },
        verifier,
        bytes(fixture.proof),
        message,
      ),
    };
  }, FIXTURE);

  expect(made.publicKey).toBe(FIXTURE.enrollmentKey);
  expect(made.proof).toBe(FIXTURE.proof);
  expect(made.fixtureProofVerifies).toBe(true);
});
