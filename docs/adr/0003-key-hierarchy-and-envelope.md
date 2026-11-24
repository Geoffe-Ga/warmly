# ADR-0003: Key hierarchy and the record envelope

- **Status:** Accepted
- **Date:** 2026-11-24
- **PRD references:** §4.2 [SEC-002, SEC-003, SEC-004], §10 [REL-004], §13.9

## Context

Every piece of private content is encrypted on the device before it is stored
or synced (SEC-004). This ADR fixes how keys relate to each other and what an
encrypted record looks like on disk and on the wire. Both are expensive to
change later: real data will be written in this format.

Constraints from the PRD: vetted authenticated encryption, cryptographically
secure randomness, unique nonces with an explicit policy, associated data that
binds owner, record ID, type and format version, and versioned formats.

## Options

### Option 1: One AES-GCM key for everything, random nonces

- **Pros:** simplest.
- **Cons:** AES-GCM with random 96-bit nonces has a limit on encryptions per
  key before a nonce collision becomes plausible, and a collision is
  catastrophic for that key. One key for an account's whole lifetime of saves
  and autosaves has to reason about that limit.

### Option 2: A key per record, derived from the root key, random nonces

- **Pros:** each key encrypts one record's successive versions only, so the
  count per key is tiny and nonce collision stops being a practical concern;
  derivation is one HKDF call; everything is available in WebCrypto.
- **Cons:** one extra derivation per operation.

### Option 3: XChaCha20-Poly1305 with 192-bit nonces

- **Pros:** random nonces are safe at any realistic volume under one key.
- **Cons:** not in WebCrypto, so it needs a JavaScript or WebAssembly
  dependency in the most sensitive part of the app, and WebAssembly would
  require relaxing the Content Security Policy.

## Comparison

| Dimension | One key | Key per record | XChaCha20 |
| --- | --- | --- | --- |
| Runtime dependencies added | 0 | 0 | 1 or more |
| CSP change needed | No | No | Likely (`wasm-unsafe-eval`) |
| Nonce-collision reasoning | Needs a usage bound | Negligible by construction | Negligible |
| Keys non-extractable in the browser | Yes | Yes | No (library holds raw bytes) |

## Decision

Use **option 2**, on WebCrypto only.

```
recovery key ─┐                     (wraps, ADR-0003 addendum in #19)
device key ───┼─▶ account root key ─┬─▶ record key (per record ID) ─▶ AES-256-GCM
pairing ──────┘   256 random bits   └─▶ fingerprint (public, one-way)
```

- **Root key.** 256 bits from `crypto.getRandomValues`, generated on the
  client. Imported as a non-extractable HKDF key. Its raw bytes exist only when
  generated and when unwrapped. The server never receives it, and the account
  password never derives it.
- **Derivation.** HKDF-SHA-256 with a fixed public salt and an `info` that
  names the purpose. Different purposes and different records get independent
  keys.
- **Record key.** `info = "warmly/record-key/" | version | len(owner) | owner |
  len(recordId) | recordId`, with the same two-byte lengths as the associated
  data. AES-256-GCM, non-extractable. The owner is part of the derivation, not
  only of the associated data, so two accounts can never derive the same
  record key even if a root key were ever shared or imported between them.
- **Identifiers** must be well-formed text of 1 to 65535 UTF-8 bytes. Text
  with an unpaired surrogate is refused, because it has no UTF-8 form and two
  different identifiers could otherwise encode to the same bytes.
- **Nonce policy.** A fresh random 96-bit nonce for every encryption. A nonce
  is never chosen by a counter and never reused deliberately. Because a key
  serves one record, the number of encryptions under it is the number of times
  that record is saved.
- **Associated data.** `version | len(owner) | owner | len(recordId) |
  recordId | type`, with two-byte big-endian lengths so fields cannot run
  together. It is authenticated, not stored: the reader supplies what it
  expects, and a mismatch fails decryption.
- **Envelope, format version 1.** `version (1 byte) | nonce (12 bytes) |
  ciphertext and 16-byte tag`. Sent to the API as standard base64.
- **Failure behaviour.** An unknown version raises `UnsupportedFormatError`
  and nothing is attempted. Every other failure raises `DecryptError` with one
  fixed message, so a wrong key, a wrong context and tampering cannot be told
  apart.

## Consequences

- No crypto dependency and no change to the Content Security Policy.
- A record cannot be moved to another ID, owner or type by the server; it
  would fail to decrypt.
- A new format means a new version byte, a new fixture directory under
  `tests/fixtures/crypto/`, and code that still opens every older version.
  Existing fixture directories are never edited.
- The record ID is part of the key derivation, so a record's ID can never
  change. Sync already treats IDs as permanent.
- Padding is not applied: ciphertext length reveals plaintext length. This is
  listed as residual metadata in the threat model.
- Wrapping the root key (recovery key, trusted device, device pairing) is
  decided in the issues that implement it: #19, #20 and #22.

## What the tests do and do not show

They show that the code implements this description: round trips work, any
single flipped bit is rejected, a record cannot be opened under another ID,
owner, type or key, and the committed fixtures are opened both by the
production code and by an independent implementation written from this ADR.

They do not show that the design is free of weaknesses, that WebCrypto in a
given browser is correct, or that key material cannot be read from a
compromised device. Non-extractable keys stop JavaScript from exporting a key;
they do not stop malicious script from *using* it while the app is unlocked.
