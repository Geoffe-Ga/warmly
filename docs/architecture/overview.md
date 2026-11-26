# Architecture overview

Five pictures of how Warmly is put together, each with a pointer to the
decision record that holds the detail. The pictures are summaries. Where
one disagrees with a decision record or with the code, the picture is
wrong: fix it.

The diagrams are written in Mermaid, which GitHub draws.

## 1. The system and its trust boundaries

What runs where, and what crosses each line.

```mermaid
flowchart LR
  subgraph device["The person's device (trusted while unlocked)"]
    ui["App shell and screens<br/>(Preact, src/)"]
    crypto["Encryption and keys<br/>(WebCrypto)"]
    idb[("IndexedDB<br/>envelopes only")]
    sw["Service worker<br/>app shell only"]
  end

  subgraph warmly["Warmly's servers (not trusted with content)"]
    api["FastAPI<br/>warmly/"]
    db[("PostgreSQL<br/>ciphertext, owner-only rows")]
  end

  auth["Supabase Auth<br/>accounts and sessions"]
  ai["The person's chosen AI provider"]

  ui --> crypto --> idb
  ui -- "signed requests,<br/>ciphertext only" --> api --> db
  ui -- "email, password" --> auth
  auth -. "signing keys,<br/>to verify tokens" .-> api
  ui -- "readable text, only when the person<br/>asks and agrees each time" --> ai
```

- **Nothing readable reaches Warmly's servers.** Records leave the device
  only as envelopes. The server sees who owns a record, its ID, its type
  number, its revisions, its size and when it changed.
- **Readable text leaves the device in one case only:** to the AI
  provider the person chose, after they asked for something and agreed to
  the disclosure for that request. There is no AI proxy on Warmly's side.
- **Two things identify a request:** the session token (who the account
  is) and a signature by a key that never leaves the device (which device
  is speaking). See [ADR-0005](../adr/0005-device-identity-and-pairing.md).
- The service worker caches the app's own files, never an API response.

Threats and what answers them:
[threat model](../security/threat-model.md).

## 2. Keys, from creation to loss

```mermaid
flowchart TD
  root["Account root key<br/>256 random bits, made on the device"]
  rec["One key per record<br/>(HKDF from the root key)"]
  envelope["Record envelope<br/>AES-256-GCM"]
  recovery["Recovery key<br/>shown once to the person"]
  wrapped["Recovery envelope<br/>the root key, wrapped; kept by the server"]
  devkey["Device key (cannot be exported)<br/>plus the device passphrase"]
  local["Wrapped root key in IndexedDB<br/>on a trusted device"]
  enroll["Enrollment key pair<br/>(Ed25519, derived from the root key)"]
  pub["Its public half; kept by the server"]

  root --> rec --> envelope
  recovery --> wrapped
  root --> wrapped
  root --> local
  devkey --> local
  root --> enroll --> pub
```

- **Made** on the device at sign-up. Saved only after the person confirms
  they have the recovery key.
- **Used** while the app is unlocked. Locking drops the root key and every
  decrypted record from memory.
- **Reached again** three ways: the device passphrase on a trusted device
  ([ADR-0004](../adr/0004-trusted-device-unlock.md)); the recovery key on
  a new one; or pairing with a device that is already unlocked, which
  sends the root key encrypted to the new device after a code is typed
  ([ADR-0005](../adr/0005-device-identity-and-pairing.md)).
- **Lost** if the recovery key and every trusted device are lost. A
  password reset does not bring the journal back: the account password
  never derives or unlocks a key.
- The envelope format and the derivations:
  [ADR-0003](../adr/0003-key-hierarchy-and-envelope.md).

## 3. A record on the device

```mermaid
flowchart LR
  screen["A screen"] --> store["RecordStore<br/>(decrypted copies in memory)"]
  store -- "one transaction" --> rows[("records: envelope,<br/>ID, type, revisions")]
  store -- "the same transaction" --> outbox[("outbox:<br/>one operation per change")]
  parked[("parked: the server's version<br/>of a record changed in two places")]
```

- IndexedDB holds envelopes, never content, a content hash, a search
  index or a decrypted cache.
- A save writes the record and its outbox operation together, or neither.
- Search is built in memory from decrypted records and is gone on lock.
- Detail: [ADR-0014](../adr/0014-local-encrypted-store.md).

## 4. Sync

```mermaid
sequenceDiagram
  participant A as Device A
  participant S as Server
  participant B as Device B

  A->>S: operation (record, base revision 3)
  S-->>A: applied, now revision 4
  B->>S: operation (same record, base revision 3)
  S-->>B: refused: the record has moved on
  B->>S: changes since my cursor
  S-->>B: the record at revision 4
  Note over B: Both versions are kept.<br/>The person chooses on<br/>"Changed in two places".
  B->>S: operation (their choice, base revision 4)
  S-->>B: applied, now revision 5
```

- The server compares revisions. It never reads a record, compares times
  or picks a winner.
- A refused change stays on the device and is shown as needing attention.
- A deleted record leaves a tombstone that is never removed, so an old
  device or an old backup cannot bring it back.
- Detail and the full table of cases:
  [ADR-0006](../adr/0006-sync-protocol.md).

## 5. What goes when a journal entry changes

```mermaid
flowchart TD
  entry["A journal entry or a note<br/>is edited or deleted"]
  check["On this device: which records<br/>were built from it?<br/>(by ID and content hash)"]
  session["A Reflect session that was sent it:<br/>deleted whole"]
  aicard["An AI card nobody has changed:<br/>deleted"]
  owned["A card the person has made their own:<br/>kept, its AI notes taken out"]
  manual["A card the person wrote:<br/>untouched"]

  entry --> check
  check --> session
  check --> aicard
  check --> owned
  check --> manual
```

- This happens on the device. No AI is called and nothing is made again.
- The deletions are ordinary deletions, so they sync like any other.
- The person is told before (a count on the edit screen and in the delete
  confirmation) and after (a notice with a count).
- Detail: [ADR-0010](../adr/0010-dependency-invalidation.md).

## 6. Deleting, and how long things last

```mermaid
flowchart LR
  ask["The person confirms a deletion"] --> here["Gone from this device at once"]
  here --> others["Gone from other devices<br/>the next time they sync"]
  here --> tomb["A tombstone is kept for good,<br/>on the device and the server"]
  others --> backups["Encrypted copies in backups<br/>go as the backups expire"]
```

- There is no trash and no undo.
- The 30-day limit on backups is the product's stated intent. **It has not
  been checked against a real backup service**: that work needs hosting
  and is tracked in issue 65.
