# ADR-0005: Device identity, request signing and pairing

- **Status:** Accepted (identity and request signing). The pairing section is
  a placeholder until issue #22.
- **Date:** 2026-11-25
- **PRD references:** §4.3 [DEV-001, DEV-002, DEV-003, DEV-010], §4.2
  [SEC-006], §8; AC-05, AC-20
- **Decision register:** D-06 (identity and signing), D-07 (pairing)

## Context

Until now the API knew only *who* was calling: it verified a session token
(see [authentication](../security/authentication.md)). A session token is a
bearer credential. It sits in `localStorage`, it stays valid until it expires,
and the API verifies it without asking the auth provider, so signing out or
revoking a session does not stop a copy from working.

The PRD asks for more than that. Device authorization must be checked on
every sync operation (SEC-006), a user must be able to see and later revoke
their own devices (DEV-003), and one account's device IDs must be invisible
to another (DEV-010).

So the API also needs to know *which device* is calling, in a way a stolen
token cannot fake and a revocation can cut off at once.

## Options

### Option 1: A device ID header, checked against a list

- **Pros:** trivial.
- **Cons:** the ID is not a secret. Anyone with the token can read the device
  list and send any ID on it. It adds a label, not a control.

### Option 2: A per-device bearer secret

- **Pros:** simple to verify.
- **Cons:** it is one more copyable string. Script that can steal the token
  can steal the secret the same way, and the server has to store something
  that would let it impersonate the device.

### Option 3: A per-device signing key that cannot leave the device

- **Pros:** the private key is a non-extractable WebCrypto key. Script can
  ask the browser to sign with it but cannot copy it, so a token copied off
  the device is useless elsewhere. The server stores only a public key.
- **Cons:** every request costs one signature and one verification, the
  server must remember recent nonces, and the device clock has to be roughly
  right.

## Decision: identity and request signing

Option 3.

### The identity

- Each device generates an **ECDSA P-256** key pair with WebCrypto, with the
  private key **non-extractable**, and a random UUID as its device ID. Both
  are kept in IndexedDB (`src/devices/identity.ts`). P-256 is the curve every
  browser's WebCrypto supports for signatures.
- There is one identity per account on a device. Two accounts used in the
  same browser do not share a key, so the server cannot link them by it.
- The device name is user content. It is encrypted on the device with the
  record envelope (ADR-0003), bound to the device ID it names, and the server
  stores the ciphertext. A name that does not decrypt is shown as "Unnamed
  device".

### What is signed

Every request to an authenticated route carries four headers:

| Header | Value |
| --- | --- |
| `Warmly-Device` | The device ID |
| `Warmly-Timestamp` | Whole seconds since the epoch |
| `Warmly-Nonce` | 16 to 64 printable ASCII characters, new for every request |
| `Warmly-Signature` | Base64 of the 64-byte signature, `r` then `s` |

The signature is ECDSA with SHA-256 over these seven lines joined by `\n`:

```
warmly-request-v1
METHOD
path and query string, exactly as sent
SHA-256 of the body, lower-case hex
timestamp
nonce
device ID
```

The client serialises the body once and signs those exact bytes
(`src/api/client.ts`). The first line is a version: a change to the message
gets a new version string rather than a silent change of meaning.

### What the server checks

`warmly/auth/device.py` runs these checks in order, after the session token
has been verified. Nothing is stored for a request that fails one.

1. The headers are present and well formed.
2. The timestamp is within **5 minutes** of the server's clock.
3. The device ID belongs to **the token's account** and is not revoked. A
   device of another account is not found, exactly like one that does not
   exist.
4. The signature verifies under that device's registered public key.
5. The nonce has not been used by that device before. Nonces are kept for 10
   minutes, which is longer than a timestamp can stay acceptable, so a
   captured request can never be replayed.

A refusal is `401` with `device.missing_signature`, `device.stale_request`
or `device.not_authorized`. The last one covers every other failure on
purpose: the response does not say whether the device exists, belongs to
someone else, is revoked, or signed badly.

### Registering a device

A new device cannot sign its first request with a key the server has never
seen, and "has a valid session token" must not be enough to add a device:
that would let a stolen token register an attacker's key and defeat the
whole scheme. So registration (`POST /v1/devices`) needs three things:

1. A valid session token.
2. A signature over the request by the key being registered, which proves
   the caller holds that private key.
3. An **enrollment proof**: `HMAC-SHA-256(verifier, "warmly-device-enrollment-v1\n" + device ID + "\n" + public key)`.

The verifier is 32 bytes derived one-way from the account root key (HKDF,
info `warmly/device-enrollment/v1`). The client sends it once, with the first
recovery envelope, and the server stores it beside the envelope. Only a
device that holds the root key can compute the proof, which means a device
that was unlocked with the recovery key or, after #22, approved by another
device. The server learns nothing about the root key from the verifier.

The app registers a device each time the journal is unlocked on a device
that is not registered yet, and again when Manage Devices is opened, so an
interrupted registration completes itself.

### Routes that are not device-signed

| Route | Why |
| --- | --- |
| `GET /v1/health`, `GET /v1/ready` | Public. |
| `GET /v1/recovery-envelope` | A new device must read the envelope before it can hold the root key, and so before it can register. What it returns is useless without the 256-bit recovery key. |
| `PUT /v1/recovery-envelope` when creating (version 0) | No device can register before the envelope and its verifier exist. It can only succeed once per account. |
| `POST /v1/devices` | Signed by the new key and carrying the enrollment proof instead. |
| `POST /v1/enrollments`, `GET /v1/enrollments/{id}` | A device asking to be approved has no registered key yet. These are stubs until #22. |

Everything else, including replacing the recovery envelope, renaming a
device and every sync route, requires a registered device's signature. A
test walks the API contract and fails if a new route is neither signed nor
on this list.

## Consequences

- A stolen session token can no longer read or write anything behind a
  signed route, and can no longer replace the recovery envelope.
- A device's clock must be within 5 minutes of the server's. The app
  explains a `device.stale_request` refusal in those terms.
- The server keeps a short-lived table of used nonces. Expired rows are
  removed as new ones arrive.
- The signature does **not** protect against script running in the app's own
  origin: such script can ask the browser to sign. The Content Security
  Policy remains the control for that (see the threat model).
- Signing proves which device sent a request. It does not prove the device
  is unlocked; that is the client's own rule (ADR-0004).
- An account created before this change has no enrollment verifier, so its
  devices cannot register. No such account exists outside development.
- Both sides are held to one committed fixture
  (`tests/fixtures/signing/v1.json`): the browser tests and the server tests
  each check the same signed requests and enrollment proof.

### Revisit when

- Revocation lands (#23): the revoked check already runs on every request;
  the route, the ledger and the client's handling are added there.
- Sync lands (epic 04): `last_sync_at` starts to be filled in.
- A passkey unlock is added (#80): it does not change the device identity.

## Pairing

To be completed by issue #22 (D-07): how an unlocked device hands the root
key to a new one through a short-lived, human-verified exchange in which the
server relays only ciphertext.
