# Device-enrollment fixtures

`v2.json` holds one device-enrollment proof (ADR-0005, issue 84): the
account's enrollment public key, a device ID, that device's public key,
and the proof a device holding the root key makes for them.

Both the browser code (`tests/frontend/devices/signing.test.ts`) and the
server code (`tests/auth/test_signing_fixture.py`) check the same file, so
the two sides cannot drift apart on how the key is derived or what is
signed.

- Everything here is synthetic. `rootKey` is the bytes 0 to 31, the same
  made-up root key as in `tests/fixtures/crypto`. It protects nothing real.
- The file was made by Python's `cryptography` (HKDF-SHA-256, then
  Ed25519) and is checked against WebCrypto by the browser tests: two
  independent implementations must agree on it.
- Ed25519 signatures are deterministic, so the same inputs always give
  this exact proof.
- **Never edit or regenerate `v2.json`.** If the derivation or the signed
  message changes, the version string changes with it and a new file is
  added beside this one.

The `enrollment` block in `tests/fixtures/signing/v1.json` is the earlier,
HMAC form of the proof. Nothing accepts it any more; it stays because that
file is never edited.
