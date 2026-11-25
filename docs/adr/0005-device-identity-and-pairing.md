# ADR-0005: Device identity, request signing and pairing

- **Status:** Accepted
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
| `POST /v1/enrollments`, `GET /v1/enrollments/{id}`, `POST /v1/enrollments/{id}/reveal` | A device asking to be approved has no registered key yet. Nothing these routes do can release a key: see Pairing below. |

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
- **An account whose envelope predates this change has no verifier**, and
  nothing can add one: only the first write of the envelope sets it, so that
  a session token alone can never plant a verifier on an account that
  already has keys. Such an account gets `device.account_not_ready` and
  cannot register a device. This is acceptable only because no deployed
  database exists yet: the only such rows are in developers' local
  databases, which are reset. The release checklist requires confirming
  that no envelope in the production database lacks a verifier. If that
  ever stopped being true, the fix would be a signed, one-time upgrade
  designed for the purpose, not a relaxation of this rule.
- **The enrollment verifier is a secret the server holds.** It is the HMAC
  key for the registration proof, so someone who can read the database *and*
  holds a valid session token for the account could register a device of
  their own. They would still hold no key: every record stays ciphertext to
  them, and they could not write a record the user's devices would accept as
  decryptable. What they would gain is what a registered device can do
  without the root key: read and submit ciphertext, and replace the recovery
  envelope, which would stop the recovery key working. The design goal here
  was the stolen-token case, which it meets. The stronger design is for the
  server to hold only a public key derived from the root key and for the new
  device to sign its registration with the matching private key, so the
  server holds nothing that can make a proof. WebCrypto cannot derive an
  ECDSA key from HKDF output directly, so that needs care; it is recorded
  under "Revisit when".
- **Creating the first recovery envelope is unsigned.** A session token
  stolen in the short time between sign-up and the user confirming their
  recovery key could create an envelope, and its verifier, first. The real
  user's own attempt would then be refused ("already set up on another
  device"), so it would be noticed at once, and nothing of theirs exists yet
  to lose.
- Both sides are held to one committed fixture
  (`tests/fixtures/signing/v1.json`): the browser tests and the server tests
  each check the same signed requests and enrollment proof.

### Revisit when

- Revocation lands (#23): the revoked check already runs on every request;
  the route, the ledger and the client's handling are added there.
- Sync lands (epic 04): `last_sync_at` starts to be filled in.
- Before real users: replace the stored HMAC verifier with a public key
  derived from the root key (see the limit above). Tracked in #84.
- A passkey unlock is added (#80): it does not change the device identity.

## Pairing

How an unlocked device hands the root key to a new one (PRD DEV-001 path A,
AC-19; D-07). The alternative, unlocking the new device with the recovery
key, already exists (ADR-0003).

### What has to be true

- The server relays the messages and must learn nothing: not the root key,
  and not enough to get it.
- A server that misbehaves, or someone holding a stolen session token, must
  not be able to get the key by putting themselves between the two devices.
- The same must hold in the other direction: the new device must not end
  up holding a key that the server, rather than the other device, chose.
  Otherwise it would encrypt the journal under a key the server knows.
- A person has to be able to check that, without a camera and with a screen
  reader.

### Options

1. **Encrypt the root key to the new device's public key and trust the
   server to relay that key honestly.** One message, but a server in the
   middle substitutes its own key and receives the root key.
2. **Add a six-digit code derived from both public keys and a server
   challenge** (D-07 as first written). Better, but the server picks the
   challenge and can see everything the code is derived from before either
   device commits to it. It can try keys and challenges until its
   substitute produces the same six digits: about a million tries, which
   takes no time.
3. **The same code, with each device fixing a random value before it learns
   the other's** (commit, then reveal). This is the construction Bluetooth
   numeric comparison and ZRTP use. A relay in the middle has to choose its
   values blind, so it gets one guess in a million per attempt.

### Decision

Option 3. This strengthens D-07 rather than replacing it: the code is still
derived from the public key and the server challenge, with two random values
added.

The exchange, relayed through `/v1/enrollments`:

| Step | Who | What |
| --- | --- | --- |
| 1. start | New device | Sends its device ID, a one-time P-256 public key, and a **commitment**: SHA-256 over the device ID, that key and a 32-byte random value it keeps to itself. The server adds a random challenge. |
| 2. claim | Approving device | Reads the request and sends its own 32-byte random value. |
| 3. reveal | New device | Only now sends its random value. |
| 4. check | Approving device | Recomputes the commitment from the revealed value. If it does not match, it refuses the request. |
| 5. compare | Person | The new device shows a six-digit code. The person **types it** into the approving device. |
| 6. approve | Approving device | If the typed code equals the code it computed, it picks a random six-digit **confirmation code**, encrypts the root key and that code together to the new device's public key, sends the result, and shows the confirmation code. |
| 7. confirm | Person, new device | The new device opens the message and asks for the confirmation code. It keeps the key only if the person types the one the approving device shows. |

- **The code** is SHA-256 over the account, the request ID, the device ID,
  the public key, the commitment, the challenge and both random values,
  reduced to six digits. Each device computes it from what *it* saw, so any
  substitution on the way makes the two codes differ.
- **Typed, not just confirmed.** A "yes, they match" button gets pressed
  without looking. Typing the code is the comparison. The approving device
  never displays its own code.
- **Why a second code.** The first code only protects the approving device:
  it knows it is sending to the real new device. The new device knows
  nothing yet. HPKE in base mode does not say who sealed a message, and
  everything needed to seal one to the new device (its public key and the
  whole transcript) passes through the relay. So a relay could seal a key
  of its own to the new device, with or without a real approval. The
  confirmation code closes that: it travels only inside the encrypted
  message and on the approving device's screen, so the relay cannot know
  the one the person will type. Signing the transfer with a key the
  approving device contributes was considered and is not enough by itself:
  a relay that substitutes that key makes the first code mismatch on the
  approving device, which refuses, but the new device has no way to learn
  of the refusal except through the relay. Only something the person
  carries between the two screens can tell it.
- **One guess, for each code.** A wrong first code refuses the request. A
  wrong confirmation code makes the new device discard what it received.
  Neither code can be searched for. The person starts again.
- **Re-authentication.** The unlocked root key cannot be exported, so the
  approving device opens it again with its device passphrase, or with the
  recovery key on a device that has no passphrase. That also confirms the
  person approving is the owner, not someone who picked up an unlocked
  phone. A wrong passphrase releases nothing and can be corrected.
- **Key transfer** uses HPKE (RFC 9180) in base mode with DHKEM(P-256,
  HKDF-SHA256), HKDF-SHA256 and AES-256-GCM, single-shot. The HPKE `info`
  is the whole transcript, so a wrapped key cannot be moved into another
  pairing. The new device's private key is non-extractable and lives only
  in memory for the few minutes of the pairing.
- **Why not a library.** The project takes no cryptography dependency
  (ADR-0003). `src/crypto/hpke.ts` is about 150 lines on WebCrypto and is
  checked against the RFC's own test vectors for this suite
  (`tests/fixtures/hpke/`), both sealing with the vector's one-time key and
  opening its ciphertext.
- **Nothing is unlocked early.** The received key is held in memory, not
  adopted, until the confirmation code is typed. Leaving the screen wipes
  it.
- **After the confirmation** the new device holds the root key, so it registers
  itself exactly as a device that used the recovery key does: with the
  enrollment proof described above.

What the server enforces (`warmly/api/enrollment.py`,
`warmly/db/enrollment_store.py`):

- A request lasts **5 minutes**. After that it reads as `expired`, cannot be
  advanced, and gives up no wrapped key.
- A revealed value that does not match the commitment is refused and
  leaves the request as it was, so someone holding only a session token
  cannot spoil a pairing by revealing a made-up value first. This is a
  courtesy: the approving device makes the same check and is the one that
  must not be fooled.
- Each step is one `UPDATE` that names the state it expects, so it happens
  once and in order. A request cannot be claimed twice, a value cannot be
  revealed twice, and a second wrapped key cannot replace the first.
- Only the device that claimed a request can approve or reject it.
- Starting a new request ends the account's earlier open ones, so there is
  only ever one for an approving device to take up.
- Claiming, approving and rejecting need a registered, non-revoked device's
  signature. Starting, reading and revealing need only the session token.
- Requests are owner-scoped by row-level security. Another account's request
  is a 404. There is no way to name another account, so devices can only be
  paired within one account.

### Consequences

- A stolen session token can start a request and reveal a value. It cannot
  claim or approve one, and the owner would have to type the attacker's
  code into their own unlocked device and enter their passphrase.
- A stolen token can also start requests to keep ending the owner's own
  (starting a new one ends the old). This is a nuisance, not a breach; rate
  limits arrive with #38.
- A dishonest server can refuse to relay, which prevents pairing. The
  recovery key still works.
- The remaining risk is the person: approving a device that is not theirs
  because someone asked them to type a code. The screens say to approve
  only a device you are holding.
- The person types two codes, one on each device. That is one step more
  than a single comparison, and is the price of protecting both directions
  without a camera.
- Six digits give a one-in-a-million chance per attempt that a relay's blind
  guess goes unnoticed. Each attempt needs the owner to start a pairing, so
  attempts are few.
