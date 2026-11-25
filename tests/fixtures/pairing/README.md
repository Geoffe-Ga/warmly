# Pairing fixture

`v1.json` holds one pairing's public values with the commitment and the
six-digit code they produce (ADR-0005). It was generated with WebCrypto from
the description in the ADR, independently of `src/`.

- The browser tests (`tests/frontend/devices/pairing.test.ts`) check that the
  app derives the same commitment and code.
- The server tests (`tests/api/test_enrollment.py`) check that the server
  recomputes the same commitment when a value is revealed.

Everything in it is synthetic: the random values are counting bytes and the
private key was discarded. **Never edit or regenerate `v1.json`.** If the
derivation changes, its label changes with it and a `v2.json` is added.
