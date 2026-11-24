# Warmly MVP: SPEC summary and decomposition

- **Date:** 2026-11-24
- **Source SPEC:** `docs/plans/relationship_communication_agent_prd.md` (v1.0, 2026-11-23)
- **Output:** 8 epics and 58 child issues in this directory
- **Status:** filed on 2026-11-24 as issues #3 to #68; see `FILED.md` for the key-to-number map.

## 1. The SPEC in one page

Warmly is a private, end-to-end-encrypted, offline-first journaling PWA for one
person reflecting on their own relationship. Accounts are fully independent and
are never linked.

**What the user can do**

1. **Journal:** answer three fixed prompts, optionally record feelings, save
   drafts, edit, delete, browse a timeline and search, all offline.
2. **Reflect:** ask their own question about their own history and get prose
   with citations to the exact passages they wrote.
3. **Prepare for a Conversation:** turn selected entries into one to three
   editable cards per request, learn why the wording may help, write their own
   cards, present them one at a time, and print them.

**What must always be true** (PRD §0, §4 to §6)

- No plaintext leaves the device except to the user's chosen AI provider, after
  an explicit and disclosed action. The backend only ever stores ciphertext.
- AI never runs automatically, is never retried automatically, and never falls
  back to another provider. Its output is untrusted until validated.
- Access is owner-only at the API and in database policy, and device
  authorization is re-checked on every sync operation.
- Sync never uses last-write-wins, and deletion is durable.
- Changing a journal entry removes AI output built from it, locally, without
  calling AI again.
- No partner linking, scores, streaks, notifications, diagnosis or tracking.

**Non-goals for the MVP:** sharing, voice, local models, vector search, dark
theme, export/import, manual accessibility certification, a staging environment.

## 2. Epic map

The PRD §12 fixes an eight-step dependency order and `CLAUDE.md` requires
following it, so the epics mirror those steps one to one. The skill suggests two
to six epics; eight is a deliberate deviation (decision D-02) because merging
steps would produce epics of twelve or more issues.

```
E01 Foundation ─▶ E02 Identity, keys, devices ─▶ E03 Offline journal ─▶ E04 Sync
                                    │                                     │
                                    └────────▶ E05 AI provider gate ◀─────┘
                                                      │
                                                      ▼
                                   E06 Reflect ─▶ E07 Cards (AI half)
E08-I01 (deploy skeleton) can start after E01.    E07 manual cards need only E04.
E08 I02 to I08 close out the MVP.
```

Every epic starts with a skeleton issue that makes its whole surface reachable
with stubs or fakes; each later issue replaces one stub with real behaviour and
leaves the app demoable.

## 3. Design decisions made during decomposition

The PRD leaves nine engineering decisions open (§13) and `CLAUDE.md` leaves the
UI framework open. The request for this decomposition was to make the judgement
calls. Each is recorded here, repeated inside the issues it affects, and written
up as an ADR by the issue that implements it. They choose mechanisms only; none
changes a product decision in the PRD. If a spike disproves one, the issue says
to stop and report rather than weaken an invariant.

| ID | Decision | Why | ADR written by |
| --- | --- | --- | --- |
| D-01 | UI framework: **Preact with TSX** | React's component model with no transitive runtime dependencies, so a smaller supply-chain surface (SEC-001); text is escaped by default | E01-I01 (ADR-0001) |
| D-02 | Eight epics mirroring PRD §12 | The PRD's order is a hard dependency chain; fewer epics would each exceed eight issues | this file |
| D-03 | Crypto on **WebCrypto only**: AES-256-GCM, HKDF-SHA-256. One derived key per record plus a random 96-bit nonce per encryption. AAD binds owner, record ID, type, format version | No WASM or hand-rolled crypto and no `wasm-unsafe-eval` in the CSP. Per-record keys make nonce reuse a non-issue, which answers the PRD's "explicit nonce-management policy" | E02-I02 (ADR-0003) |
| D-04 | Recovery key is a **256-bit random secret** in checksummed base32, wrapped with HKDF + AES-GCM | The PRD allows this instead of a password KDF. It avoids an Argon2 dependency and cannot be weakened by a poor user-chosen phrase | E02-I04 (ADR-0003) |
| D-05 | Trusted unlock: root key wrapped by a non-extractable device key **and** an unlock secret from a passkey (WebAuthn PRF), with a PBKDF2 passphrase fallback | A non-extractable key alone would let anyone holding the unlocked phone open the app, making the inactivity lock cosmetic. The account password never derives a key | E02-I05 (ADR-0004) |
| D-06 | **Every request is signed by the device** (ECDSA P-256, non-extractable) over method, path, body hash, timestamp and nonce | Makes "device authorization is distinct from session authentication" real: a stolen JWT is useless without the device key, and revocation is enforced per request | E02-I06 (ADR-0005) |
| D-07 | Device approval: HPKE (RFC 9180) to the new device's key, confirmed by a 6-digit code both devices derive | A standard, maintained construction with human-verifiable pairing; the server relays ciphertext only | E02-I07 (ADR-0005) |
| D-08 | Data tables live in a schema **not exposed by the Supabase Data API**; FastAPI uses a non-`BYPASSRLS` role with the owner set per transaction | Otherwise a stolen JWT could read ciphertext straight from Supabase and skip the device check. RLS still backs up the API if the API has a bug | E01-I05 (ADR-0002) |
| D-09 | Record IDs are **UUIDv4** | UUIDv7 would tell the server when each record was written | E03-I02 |
| D-10 | Sync protocol: per-owner change sequence as cursor, per-record revision, `op_id` idempotency, compare-and-swap. A stale update keeps both ciphertexts. An update to a deleted record returns `deleted` and the client offers "save as a new entry" | Concrete form of the PRD's rules. Never re-using a deleted ID is the simplest way to make resurrection impossible | E04-I01 (ADR-0006) |
| D-11 | Tombstones are **never compacted** in the MVP, and deletions and revocations are also written to append-only ledgers retained longer than backups | Removes the stale-device and old-backup resurrection problems at a cost of a few bytes per deletion | E04-I06, E08-I05 |
| D-12 | IndexedDB holds ciphertext only. The search index is **in memory**, rebuilt at unlock and dropped at lock | No plaintext index at rest; a personal journal is small enough for this to be fast | E03-I02, E03-I07 |
| D-13 | The dependency index is **derived, not stored**: each AI-derived record carries its source references in its own ciphertext | One source of truth cannot drift between devices; the PRD allows "deterministically reconstructable" | E06-I05 (ADR-0010) |
| D-14 | Reflect invalidation deletes the **whole session** | The PRD's preferred conservative policy | E06-I05 (ADR-0010) |
| D-15 | **Any** saved text change makes a card user-owned; the edited segment loses its annotations at once | The PRD allows this conservative reading; it needs no definition of "substantive" and is easy to test | E07-I08 (ADR-0010) |
| D-16 | AI grounding by **alias and verbatim quote**: the model cites `E1`, `E2` and quotes text; the client verifies the quote is in the source and computes offsets and hashes itself | Models copy long hashes and count character offsets unreliably. This still guarantees every citation maps to a supplied entry, sends fewer tokens, and keeps real record IDs from the provider | E05-I04 (ADR-0008) |
| D-17 | Providers are called with plain `fetch` through **one gateway module**, enforced by lint, CSP `connect-src` and a test egress guard. The gateway needs a single-use consent token | Makes "no automatic AI, no fallback" structural rather than a convention. Subject to the E05-I02 spike | E05-I01, E05-I02 (ADR-0007) |
| D-18 | Reflect context selection: 60% newest, 20% lexical relevance to the question, 20% evenly spaced older entries; deterministic; 15% token margin | Meets "prefer recent and relevant while ensuring older coverage" without embeddings | E06-I03 (ADR-0009) |
| D-19 | One AI request at a time, with a timeout and Cancel | Bounds cost exposure (AI-016) | E05-I07 |
| D-20 | Clients state their sync schema version; outside the window the server returns `upgrade_required` and the client stays usable offline | Non-destructive handling of mixed versions (PRD §8) | E04-I08 |
| D-21 | Feelings list: calm, happy, grateful, hopeful, loved, tired, sad, anxious, frustrated, lonely, overwhelmed | Plain, non-clinical words (JR-003) | E03-I03 |
| D-22 | Post-conversation reflections join Reflect context as a separately labelled kind | Satisfies PC-004 | E08-I02 |
| D-23 | Work only a person can do carries the `needs-human` label | Agents must not create accounts, pay, or handle live keys | six issues, listed below |
| D-24 | `contentHash` covers the three responses, not feelings | Changing a feeling should not delete AI output | E03-I03 |
| D-25 | A Reflect session and its messages are **one** encrypted record | Keeps a conversation atomic under sync and makes whole-session deletion one tombstone | E06-I02 |
| D-26 | Production sign-up is restricted (allow-list or invite) by default | The MVP serves two known people; open registration invites abuse | E08-I01 |

## 4. Questions for the product owner

None of these blocks starting. Each has a default that the issues assume.

1. **Whole-account deletion.** The PRD covers deleting records but not deleting
   an account. It is **not** in this decomposition. Recommended: add it before
   launch, since a privacy product without it is hard to defend.
2. **Hosting and cost.** E08-I01 and E08-I05 need you to pick and pay for
   hosting and possibly a higher Supabase plan or separate backups for the
   30-day window.
3. **Open or restricted sign-up** in production (D-26 assumes restricted).
4. **Release branch.** Assumed to be `main`, deploying straight to production
   once gates pass, as PRD §10 describes.
5. **BYOK risk acceptance.** E05-I02 ends with a decision only you can make:
   whether a provider key held in browser memory is acceptable to you. If not,
   the PRD requires an architecture revision, not a backend proxy.
6. **Supported browsers.** Assumed: the two most recent major versions of iOS
   Safari and of desktop Chrome, Edge, Firefox and Safari.

## 5. Issue index

Keys such as `E02-I03` are stable identifiers used for cross-references. In the
issue bodies they appear as `#E02_I03_NUMBER` and `#EPIC_02_NUMBER` placeholders,
replaced with real GitHub numbers at filing time.

### EPIC 01: Foundation and walking skeleton

- `E01-I01` skeleton: feat(shell): adopt Preact and wire every MVP route to a placeholder screen
- `E01-I02` skeleton: feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract
- `E01-I03` core: feat(ui): add light-theme design tokens and the accessible component kit
- `E01-I04` core: feat(security): add CSP, security headers, log redaction and the network egress guard
- `E01-I05` core: feat(db): add the dev database stack, migration runner and deny-by-default baseline

### EPIC 02: Identity, keys and devices

- `E02-I01` skeleton: feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes
- `E02-I02` core: feat(crypto): implement the key hierarchy and versioned record envelope
- `E02-I03` core: feat(auth): integrate Supabase Auth and verify JWTs in FastAPI (needs-human)
- `E02-I04` core: feat(crypto): create, confirm, use and rotate the personal recovery key
- `E02-I05` core: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock
- `E02-I06` core: feat(devices): register device identities, sign every request and build Manage Devices
- `E02-I07` core: feat(devices): approve a new device from an unlocked one with verified pairing
- `E02-I08` edges: feat(devices): revoke a device and handle rejection on the revoked client

### EPIC 03: Offline journal

- `E03-I01` skeleton: feat(journal): wire compose, timeline, entry and search screens to an in-memory store
- `E03-I02` core: feat(storage): persist records as ciphertext in IndexedDB with migrations and an outbox
- `E03-I03` core: feat(journal): complete an entry with three required answers and an optional feelings check-in
- `E03-I04` core: feat(journal): autosave drafts offline and keep them across close, reopen and lock
- `E03-I05` core: feat(journal): show the chronological timeline and edit saved entries in place
- `E03-I06` core: feat(journal): permanently delete an entry with confirmation and a local tombstone
- `E03-I07` core: feat(journal): search entries locally, case-insensitively and offline
- `E03-I08` edges: feat(journal): handle storage errors, suspend and resume, and the installed offline app

### EPIC 04: Encrypted multi-device sync

- `E04-I01` skeleton: feat(sync): wire the client sync engine and status indicator against the stub API
- `E04-I02` core: feat(sync): persist operations with atomic revisions, compare-and-swap and idempotency
- `E04-I03` core: feat(sync): serve the owner-scoped change feed with a stable cursor
- `E04-I04` core: feat(sync): drain the outbox and apply remote changes reliably on the client
- `E04-I05` core: feat(sync): keep both conflicting versions and let the user resolve them locally
- `E04-I06` core: feat(sync): make deletion durable so stale devices cannot resurrect records
- `E04-I07` edges: test(sync): prove cross-account isolation and ciphertext-only handling, and add rate limits
- `E04-I08` edges: feat(sync): negotiate schema versions and update the app without losing work

### EPIC 05: AI provider layer and the BYOK compatibility gate

- `E05-I01` skeleton: feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog
- `E05-I02` core: docs(ai): run the browser BYOK compatibility and security review and record ADR-0007 (needs-human)
- `E05-I03` core: feat(ai): store provider credentials encrypted and sync them between the user's devices
- `E05-I04` core: feat(ai): define the AI data contracts and the grounding validator
- `E05-I05` core: feat(ai): implement the OpenAI adapter behind the gateway
- `E05-I06` core: feat(ai): implement the Anthropic adapter behind the gateway
- `E05-I07` edges: feat(ai): handle failure, cancellation and cost limits with explicit Retry only

### EPIC 06: Reflect: source-linked answers about your own history

- `E06-I01` skeleton: feat(reflect): wire the Reflect landing and session screens to the fake provider
- `E06-I02` core: feat(reflect): persist sessions with resume, Finish Reflection and delete
- `E06-I03` core: feat(reflect): select journal context deterministically within the token budget
- `E06-I04` core: feat(reflect): answer questions with grounded, cited prose and session-only follow-ups
- `E06-I05` core: feat(deps): delete dependent Reflect sessions locally when a source entry changes
- `E06-I06` edges: feat(reflect): add policy guardrail tests, injection defences and non-therapy boundaries

### EPIC 07: Prepare for a Conversation: collections and cards

- `E07-I01` skeleton: feat(cards): wire collections, card editor, presentation and print screens to in-memory data
- `E07-I02` core: feat(cards): create, rename, reorder and delete collections and manual cards
- `E07-I03` core: feat(cards): present one card at a time with no tracking
- `E07-I04` core: feat(cards): print a collection as clean card text
- `E07-I05` core: feat(cards): generate one to three thematic cards from explicitly selected entries
- `E07-I06` core: feat(cards): add learning mode with segment provenance and technique explanations
- `E07-I07` core: feat(cards): generate alternative wordings for a segment on explicit request
- `E07-I08` edges: feat(cards): make edited cards user-owned and apply card invalidation rules

### EPIC 08: Post-conversation reflection and release hardening

- `E08-I01` skeleton: feat(release): choose hosting and wire the dev and prod deploy pipeline end to end (needs-human)
- `E08-I02` core: feat(journal): add the optional post-conversation reflection
- `E08-I03` core: feat(release): add fail-closed release gates for security and data compatibility
- `E08-I04` core: feat(release): add production smoke checks with automatic rollback or halt (needs-human)
- `E08-I05` core: feat(ops): verify 30-day encrypted backups and script a deletion-aware restore drill (needs-human)
- `E08-I06` edges: test(pwa): harden install, offline, suspend and update behaviour on both supported browsers (needs-human)
- `E08-I07` polish: feat(ui): complete the accessibility sweep and visual polish across every screen
- `E08-I08` polish: docs(release): complete the documentation set, traceability matrix and release checklist

## 6. Acceptance-criteria coverage

Every PRD §11 criterion is advanced by at least one issue. E08-I08 adds an
automated check that each has a passing test.

| Criterion | Issues |
| --- | --- |
| AC-01 | E02-I01, E02-I03, E02-I04, E03-I03, E08-I08 |
| AC-02 | E03-I02, E03-I03, E03-I04, E03-I08, E08-I06 |
| AC-03 | E01-I04, E03-I04, E03-I07, E03-I08, E05-I01, E05-I07, E06-I01, E06-I05, E07-I03, E08-I02 |
| AC-04 | E01-I04, E02-I02, E03-I02, E04-I02, E04-I07, E08-I03, E08-I05, E08-I08 |
| AC-05 | E01-I05, E02-I03, E02-I06, E02-I08, E04-I02, E04-I03, E04-I05, E04-I07, E05-I03, E07-I02, E08-I08 |
| AC-06 | E03-I05, E03-I07, E08-I02 |
| AC-07 | E05-I04, E06-I04, E06-I06 |
| AC-08 | E06-I02, E06-I04 |
| AC-09 | E06-I03 |
| AC-10 | E05-I04, E07-I05 |
| AC-11 | E07-I06, E07-I07 |
| AC-12 | E06-I05, E07-I08 |
| AC-13 | E07-I02, E07-I04 |
| AC-14 | E07-I03, E08-I02 |
| AC-15 | E05-I02, E05-I05, E05-I06, E05-I07, E07-I05, E07-I07 |
| AC-16 | E04-I02, E04-I04, E04-I05, E04-I06 |
| AC-17 | E03-I06, E04-I06, E06-I05, E08-I05 |
| AC-18 | E02-I04, E08-I08 |
| AC-19 | E02-I07 |
| AC-20 | E02-I06, E02-I08, E04-I07, E08-I08 |
| AC-21 | E02-I01, E02-I05, E03-I04 |
| AC-22 | E05-I03 |
| AC-23 | E01-I01, E01-I03, E02-I01, E03-I01, E04-I01, E05-I01, E06-I01, E07-I01, E07-I06, E08-I07 |
| AC-24 | E08-I01, E08-I03, E08-I04, E08-I08 |
| AC-25 | E08-I05, E08-I08 |
| AC-26 | E05-I04, E06-I04, E06-I06, E07-I05, E07-I06, E07-I08 |
| AC-27 | E04-I07, E06-I06, E08-I08 |
| AC-28 | E03-I08, E04-I04, E04-I08, E08-I06 |

## 7. Filing plan

1. Create labels: `epic`, `spec-decomposition`, `tracer-skeleton`, `core`,
   `edges`, `polish`, `needs-human`, and one per domain (`foundation`,
   `identity`, `journal`, `sync`, `ai`, `reflect`, `cards`, `release`).
2. File the eight epics and record their numbers.
3. File children in index order, substituting placeholders, each attached to its
   epic as a sub-issue.
4. Rewrite each epic's child checklist with the real numbers.

**Start with `E01-I01`.** `E08-I01` can begin as soon as epic 01 is merged.
