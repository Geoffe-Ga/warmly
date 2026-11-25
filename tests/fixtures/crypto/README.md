# Encrypted fixtures

Committed envelopes that every future version of the crypto code must still be
able to open (PRD §10 REL-004). They are how a format change is caught before
it strands real data.

- One directory per envelope format version: `v1/`, later `v2/`, and so on.
- **Never edit or regenerate an existing directory.** If the format changes,
  add a new directory and keep the old one. The test suite opens every
  directory.
- Everything here is synthetic. The root key in `v1/records.json` is the bytes
  0 to 31 and protects nothing real. No real key or journal text may ever be
  committed.

`v1/recovery.json` is a recovery envelope (ADR-0003): a synthetic recovery
key, the owner it is bound to, the root key it wraps, and the envelope. The
keys in these files are published in this repository, so they must never be
reused for anything real.

Each `records.json` file holds the root key, its fingerprint, and a list of records. A record
gives the owner, record ID and type it is bound to, the plaintext, and the
envelope, all as standard base64 where they are bytes.

`tests/frontend/crypto/fixtures.test.ts` checks each envelope two ways: with
the production code, and with a from-scratch implementation of the format
written directly against WebCrypto from the description in ADR-0003. The second
check is what proves the documented layout is the real one.
