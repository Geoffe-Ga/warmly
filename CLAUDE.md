# Claude Code Project Context: Warmly

Warmly is a private, end-to-end-encrypted, offline-first **relationship journaling PWA**.
It helps one person reflect on their own relationship history and prepare conversation
cards for calm face-to-face talks. Accounts are fully independent; partners are never linked.

**Source of truth:** [`docs/plans/relationship_communication_agent_prd.md`](docs/plans/relationship_communication_agent_prd.md).
Read the relevant PRD section (IDs such as `JR-`, `RF-`, `CC-`, `SEC-`, `SYNC-`, `DEP-`,
`AI-`, `AC-`) before implementing anything, and cite those IDs in issues, PRs and tests.
Human-facing overview: [README.md](README.md).

**Status:** walking skeleton in progress. `warmly/` (Python) verifies access
tokens and device signatures on every `/v1` route but health, stores recovery
envelopes and device identities, and serves the remaining routes as typed
stubs. `src/` is a Preact shell with real account, recovery-key,
Manage Devices, device-pairing and device-removal flows (real cryptography; in-memory doubles stand in for the
servers outside production) and a journal that can be written, listed, read,
searched, edited in place and deleted for good, with drafts saved as they
are typed, stored encrypted in IndexedDB with an outbox that nothing sends
yet; other routes render accessible placeholders.

---

## Stack and boundaries

| Layer | Tech | Rule |
| --- | --- | --- |
| Frontend | TypeScript PWA (`src/`), Preact, Vite + vite-plugin-pwa | Owns UI, client-side crypto (AEAD, key wrapping), IndexedDB, local search, `AIProvider` adapters (OpenAI, Anthropic) |
| Backend | Python FastAPI (`warmly/`) | Owner-scoped ciphertext sync (`GET /v1/sync/changes`, `POST /v1/sync/operations`), devices, health. **Never receives plaintext.** |
| Auth/DB | Supabase Auth + PostgreSQL | Deny-by-default row-level ownership; service credentials never ship to the browser |
| Tests | pytest; Vitest + jsdom + fake-indexeddb (`tests/frontend/`); Playwright + axe-core (`e2e/`, desktop Chromium + mobile Safari) | Unit coverage ≥90%; E2E runs against the production build |

## Non-negotiable invariants (PRD §0, §4–§6)

Never trade these away to make a test pass or to simplify a design. If one cannot be met,
**stop and report a scoped blocker** instead of guessing.

1. **No plaintext leaves the client** except to the user's chosen AI provider, after an
   explicit, disclosed user action. Plaintext must never reach FastAPI, Supabase, logs,
   URLs, analytics or the service-worker cache. Never add a backend AI proxy.
2. **No automatic AI.** Do not call AI on create, edit, delete, open, search, draft
   autosave or finish. Never retry AI automatically and never fall back to another provider.
3. **Owner-only access** at the API and database-policy level, with device authorization
   re-checked on every sync operation. Test IDOR and owner-ID tampering.
4. **No partner linking, sharing, scores, streaks, notifications, diagnosis or
   presentation tracking.**
5. **Sync never uses last-write-wins.** Use compare-and-swap on the base revision, keep
   both conflicting ciphertexts until the user resolves them locally, and make tombstones
   durable so stale devices and old backups cannot resurrect deleted data.
6. **Dependency invalidation is local.** Editing or deleting a journal entry deletes the
   unedited AI cards and dependent Reflect sessions built from it. User-owned cards keep
   their wording but lose stale AI annotations. Never call AI to regenerate.
7. **AI output is untrusted.** Validate it against a schema and check that every citation
   ID and hash matches an entry actually sent in that request. Treat journal text as
   evidence, not instructions.
8. **The AI never diagnoses the partner, judges who is right, or states guesses about the
   partner's feelings as fact.**

Follow the PRD §12 sequence. Do not build AI features before crypto, recovery,
revocation and invalidation infrastructure exist.

---

## Repository layout

```
docs/plans/              PRD and plans (source of truth)
DESIGN.md                Design system for people and design agents; mirrors src/styles.css
git-issues/              Source files for the filed MVP backlog; start at the
                         *_SPEC_summary.md decision register and FILED.md
plans/architecture/      import-linter rules for Python layering
warmly/                  FastAPI backend: api/ (routers), schemas/ (wire models),
                         middleware/, db/ (pool, owner-scoped transactions, migrations)
supabase/migrations/     Forward-only SQL migrations (ADR-0002); never edit one that
                         has been applied
openapi/                 Committed API contract; src/api/schema.d.ts is generated from it
                         (regenerate both with ./scripts/contract.sh, never by hand)
src/                     TypeScript PWA: app/ (route table, router, shell), ui/ (screens,
                         components), domain/ (record types and rules), storage/
                         (RecordStore, IndexedDB schema, outbox), main.tsx
                         (bootstrap + SW registration)
docs/adr/                Architecture Decision Records
docs/security/           Threat model and security notes
config/                  Build-time config shared with tests (security headers, CSP)
public/, index.html      PWA static assets and entry; vite.config.ts = build, manifest, SW, Vitest
tests/                   pytest (test_*.py); tests/frontend/ Vitest unit tests
e2e/                     Playwright E2E + axe: production/ (the real build) and
                         app/ (the e2e build, with in-memory service doubles)
scripts/<gate>.sh        Runs the gate for Python, then TypeScript
scripts/python/          Python-only gates
scripts/typescript/      TypeScript-only gates
.claude/docs/            Detailed principles, standards, workflow, testing, tools
.claude/skills/, .claude/agents/   Skills and subagents
```

## Commands

Always use the scripts rather than invoking the tools directly.

```bash
./scripts/check-all.sh            # Gate 1: every check, both languages; must exit 0
./scripts/test.sh                 # unit tests + coverage (≥90%)
./scripts/e2e.sh                  # Playwright + axe (first run: scripts/typescript/e2e.sh --install)
./scripts/lint.sh | typecheck.sh | format.sh | security.sh | complexity.sh
./scripts/contract.sh             # regenerate the API contract and TS types (--check to verify)
./scripts/python/<gate>.sh        # one language only
./scripts/typescript/<gate>.sh
./scripts/mutation.sh             # optional, release-time only
```

## Workflow (3 gates)

1. `./scripts/check-all.sh` passes locally.
2. CI is green.
3. Code review says LGTM.

Use TDD and Conventional Commits, branch off `main`, and never bypass hooks or lower
thresholds. **Mutation testing is not a merge gate.** It is an optional, advisory check at
final-release time: CI runs it when a GitHub Release is published or on manual dispatch
with `run_mutation`, and a score below 80% warns instead of failing.

Quality targets: coverage ≥90% (branch ≥85%), cyclomatic complexity ≤10, docstring
coverage ≥95%, zero lint and type errors, and zero high or critical security findings.

## Detailed docs

- [Principles](.claude/docs/principles.md): read first
- [Quality standards](.claude/docs/quality-standards.md)
- [Workflow](.claude/docs/workflow.md)
- [Testing](.claude/docs/testing.md)
- [Tools](.claude/docs/tools.md)
- [Troubleshooting](.claude/docs/troubleshooting.md)

## Backend conventions

- All data access goes through `Database.as_owner(owner_id)` (ADR-0002). The owner ID
  comes from the verified session, never from a request field.
- Every table lives in `warmly_private`, enables and forces row-level security, and
  has the owner-only policy. Copy the four statements from the baseline migration.
- The API takes the owner only from the verified token, through
  `warmly.auth.dependency.CurrentOwner`
  ([docs/security/authentication.md](docs/security/authentication.md)). Never
  read an owner or account ID from a path, query, header or body. Tests sign
  tokens with `tests/auth/tokens.py`; no test contacts a real auth provider.
- Every authenticated route also requires a device signature
  (`warmly.auth.device.require_device` or `CurrentCaller`; ADR-0005). The
  only exceptions are listed in the ADR, and a test fails if a new route is
  neither signed nor listed. Never accept an unsigned request "for now".
- Database tests need `WARMLY_TEST_DATABASE_URL` (see README). They fail when it is
  missing; never mark them to skip.

## Frontend conventions

- The service worker uses `registerType: "prompt"`: never auto-activate an update while
  a draft may be unsaved. Precache only the public app shell; never add runtime caching
  of API responses or anything containing plaintext.
- `no-console` is an ESLint error, because logs must never contain journal content.
- The Content Security Policy lives in `config/security-headers.ts`. Never add
  `unsafe-inline`, `unsafe-eval` or a wildcard; a new `connect-src` origin needs a
  reason in the PR.
- Access is decided in one place, `src/app/access.ts`, from the session state
  (`signed_out`, `signed_in_locked`, `unlocked`). Every route declares its `access`
  in `src/app/routes.ts`; anything that can show private content is `private`. A
  screen never checks the session itself.
- All record encryption goes through `src/crypto/envelope.ts` (ADR-0003). Use
  WebCrypto only; add no crypto dependency. Never edit a directory under
  `tests/fixtures/crypto/`: a format change adds a new version beside it.
- The root key leaves a device only through pairing (`src/devices/pairing.ts`,
  ADR-0005): encrypted to the new device with `src/crypto/hpke.ts`, after
  the person has typed the pairing code. Never add another way to export it,
  and never let the approving device show or skip the code. The new device
  keeps a received key only after the confirmation code has been typed:
  never adopt a transferred key without it.
- The browser talks to Supabase Auth only, through `@supabase/auth-js`. Never
  add the full Supabase client or call the Data API from the browser.
- New keys and a replacement recovery key are saved only after the user has
  confirmed the recovery key (`KeyVault.confirmRecoveryKey`). Never upload a
  recovery envelope before that, and never log, store or put a recovery key
  in a URL.
- Lock through `lockNow` (`src/app/SessionControls.tsx`), never by changing
  the session directly: it lets registered flush hooks save work that needs
  the keys before they are dropped (ADR-0004). Code that holds unsaved
  private content registers a hook with `services.lockHooks`.
- Nothing that can decrypt goes in `localStorage` or `sessionStorage`. A
  trusted device keeps its wrapped key in IndexedDB through
  `src/crypto/device-key-store.ts` only.
- Every request to the Warmly API goes through `src/api/client.ts`, which
  signs it with this device's key (ADR-0005). Never call `fetch` for the API
  anywhere else. Never edit `tests/fixtures/signing/v1.json`: a change to the
  signed message adds a new version beside it.
- A device learns it was revoked from `device.revoked` on any request. The
  API client reports it through `services.revocation` and the app shell
  ends the session (`endRevokedDevice`). Never handle it in a screen, and
  never delete local records when it happens: only the keys go.
- Private records are read and written only through `RecordStore`
  (`src/storage/record-store.ts`), reached as `services.records`. A screen
  never keeps its own copy beyond what it is showing, and never puts record
  text in a path, a query string or `localStorage`. The store's `lock()` is
  called by `dropSecrets`, so nothing decrypted outlives the keys.
- IndexedDB holds records only as envelopes, through `EncryptedRecordStore`
  (ADR-0014). Never store record content, a content hash, a search index or
  a decrypted cache. Every change writes the record and its outbox operation
  in one transaction. A schema change is a new step in `MIGRATIONS`
  (`src/storage/db.ts`) and a new dump under `tests/fixtures/idb/`; never
  edit a released step or an existing dump. Never write over a tombstone.
  A `put` based on an out-of-date copy is refused (`StaleRecordError`):
  never catch it and write again without reading the newer record. Offer
  the person the newer version (`RecordStore.reload`) instead.
- An entry is complete only when `canComplete` says so
  (`src/domain/journal/validation.ts`): some non-space text in all three
  answers, with no minimum length and no Skip control. Feelings come only
  from what the person ticks (`feelings.ts`); never infer one from text.
- A draft is a journal entry with `status: "draft"`
  (`src/domain/journal/drafts.ts`). The compose form saves through
  `useDraft`, which registers its flush with `services.lockHooks` and also
  flushes when the page is hidden or closed. Only the person finishing the
  entry makes it complete. Autosave never calls AI or the network.
- A completed entry is changed only through `editEntry`
  (`src/domain/journal/edit.ts`): it keeps the ID, creation time and day,
  applies the completion rule, and keeps no copy of the old text. When the
  content hash changes it announces `journal.changed` on `services.events`
  (`src/domain/events.ts`) after the entry is stored. Events carry IDs and
  hashes only, never text, and stay in memory on this device. An event is
  announced at most once and can be missed, and a listener that fails never
  makes the stored change look failed (`emit` does not reject). So anything
  that depends on an entry also stores its content hash and checks it again
  on unlock.
- An entry or draft is deleted only through `deleteEntry`
  (`src/domain/journal/delete.ts`), after the person confirms. There is no
  trash and no undo. A completed entry's deletion announces
  `journal.deleted`. The confirmation text (`DELETE_WARNING`) must stay
  accurate about other devices and backups (PRD OPS-003).
- Search is local and in memory (`src/domain/search/`, D-12). The index is
  built from decrypted records by the screen that shows it, built again
  when they change, and gone when the app locks. Never store an index, and
  never put a query in a URL, in storage or in a log. Matching is plain:
  NFKC and lower case, whole words, the last word a prefix, every word
  required; no stemming, fuzzy matching or AI.
- `contentHash` (`src/domain/journal/content-hash.ts`) covers the three
  answers only, never feelings (D-24). Changing its canonical form means a
  new `CONTENT_HASH_VERSION` and a new file beside
  `tests/fixtures/journal/content-hash-v1.json`; never edit that file. The
  hash is private: it stays inside the encrypted record and never becomes
  sync metadata.
- External services (auth, key vault, device directory) are interfaces reached through
  `useServices()`. In-memory doubles live in `src/testing/` and are selected behind
  `import.meta.env.MODE !== "production"`, so they are absent from the real bundle.
- Two builds are tested in the browser: `e2e/production/` runs against the real
  production build (headers, CSP, nothing fake shipped) and `e2e/app/` against the
  same build made with `--mode e2e`, which includes the doubles. Feature flows go in
  `e2e/app/`.
- E2E specs import `test` and `expect` from `e2e/fixtures/test.ts`, never from
  `@playwright/test`: the fixture fails any test that contacts another host or
  violates the CSP. Unit tests cannot use the network at all.
- Backend logs use the closed field set in `warmly/logs.py`. Never log a body,
  header, query string, concrete path or exception text.
- Design tokens live in the `:root` block of `src/styles.css`. [DESIGN.md](DESIGN.md)
  describes them and every component; a unit test fails when the two differ, so
  change both together. Read it before building or restyling a screen.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Use
  `tsconfig.node.json` for config and E2E files.

## Open decisions and notes

- **UI framework** is Preact with TSX
  ([ADR-0001](docs/adr/0001-ui-framework.md)). Add no UI or routing library without
  a new ADR. Decisions are recorded in [`docs/adr/`](docs/adr/README.md).
- `.claude/docs/*` and `.claude/skills/*` examples are generic (Python, Jest). This
  project uses Vitest; follow the PRD and this file where they conflict.
