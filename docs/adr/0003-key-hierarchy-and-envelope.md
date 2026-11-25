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
recovery key ─┐                     (wraps: see "Recovery key" below)
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
- Wrapping the root key with the recovery key is decided below. Wrapping for
  a trusted device and for device pairing is decided in the issues that
  implement them: #20 and #22.
- The record type is in the associated data but not in the record key's
  derivation. That is deliberate: a record ID belongs to one record of one
  type, and the associated data already stops a record being read as another
  type.
- The two-byte length prefix and the one-byte record type are part of format
  version 1. Widening either needs a new format version.

## Recovery key (addendum, issue #19)

**Decision D-04.** The recovery key is 256 bits from
`crypto.getRandomValues`. Because it is uniformly random, the key that wraps
the root key is derived from it with HKDF-SHA-256; a slow password KDF would
add nothing (PRD §4.2 allows this for a high-entropy secret).

- **Text form.** 35 bytes (the 32-byte secret, then the first 3 bytes of
  `SHA-256("warmly/recovery-check/v1" | secret)`) in Crockford base32: 56
  characters, shown as 14 groups of 4. The alphabet has no I, L, O or U.
  When typed, case, spaces and dashes are ignored, O is read as 0, and I or L
  as 1. The checksum tells a typo ("mistyped") from a key that belongs to
  something else ("wrong key") without contacting the server.
- **Wrapping key.** `HKDF-SHA-256(secret, salt = "warmly/hkdf-salt/v1",
  info = "warmly/recovery-wrap/" | version | len(owner) | owner)`, used for
  AES-256-GCM.
- **Associated data.** `"warmly/recovery-envelope/" | version | len(owner) |
  owner`.
- **Recovery envelope, format version 1.** `version (1 byte) | nonce (12
  random bytes) | AES-256-GCM of the 32-byte root key and its 16-byte tag`:
  61 bytes. The server stores this and a rotation counter, nothing else.
- **Confirm before save.** New keys, and a replacement recovery key, are
  stored only after the user types back the last group of the key they were
  shown. An abandoned attempt leaves the account exactly as it was, so nobody
  can end up with keys whose recovery key they never saw.
- **Rotation.** Replacing the recovery key re-wraps the *same* root key under
  a new secret and swaps the envelope with one compare-and-swap on the
  rotation counter. Records are untouched. If the swap does not happen, the
  old key still works; if two devices race, exactly one wins and the other is
  told. Rotation asks for the current recovery key, because the root key
  cannot be exported from memory to be wrapped again.
- **What rotation does not do.** It does not change the root key. Someone
  who holds the old recovery key *and* a copy of the old envelope, for example
  from a database backup, can still unwrap the root key. Rotation stops the
  old key working against the live service; it is not revocation of a
  compromised root key. That would need re-encrypting every record under a
  new root key, which is outside the MVP and is noted in the threat model.
- **The password is not involved.** Resetting it changes no key material and
  opens nothing (AC-18).
- **What the server could do.** It can withhold or roll back the envelope,
  which denies recovery but reveals nothing. It cannot open an envelope, and
  it cannot make one account's envelope open as another's, because the owner
  is bound into both the wrapping key and the associated data.

## What the tests do and do not show

They show that the code implements this description: round trips work, any
single flipped bit is rejected, a record cannot be opened under another ID,
owner, type or key, and the committed fixtures are opened both by the
production code and by an independent implementation written from this ADR.

They do not show that the design is free of weaknesses, that WebCrypto in a
given browser is correct, or that key material cannot be read from a
compromised device. Non-extractable keys stop JavaScript from exporting a key;
they do not stop malicious script from *using* it while the app is unlocked.
