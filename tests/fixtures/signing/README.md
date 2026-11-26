# Request-signing fixtures

`v1.json` holds requests signed by a browser-style key (WebCrypto ECDSA
P-256). Its `enrollment` block is the earlier, HMAC form of the
device-enrollment proof, which nothing accepts any more; the current proof
has its own fixture in `tests/fixtures/enrollment/`. Both the browser code
(`tests/frontend/devices/signing.test.ts`) and the server code
(`tests/auth/test_signing_fixture.py`) check the same file, so the two sides
cannot drift apart on what is signed or how a signature is encoded
(ADR-0005).

- Everything here is synthetic. The private key that made the signatures was
  discarded and is not in the file. The enrollment values are derived from the
  root key used in `tests/fixtures/crypto`: the bytes 0 to 31, which protect
  nothing real.
- **Never edit or regenerate `v1.json`.** If the signed message changes, the
  version string changes with it and a `v2.json` is added beside this one.
