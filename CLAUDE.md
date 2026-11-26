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
envelopes and device identities, accepts sync operations (compare-and-swap
on the revision, applied once), and serves each account's change feed. No
route is a stub. `src/` is a Preact shell with real account, recovery-key,
Manage Devices, device-pairing and device-removal flows (real cryptography; in-memory doubles stand in for the
servers outside production) and a journal that can be written, listed, read,
searched, edited in place and deleted for good, with drafts saved as they
are typed, stored encrypted in IndexedDB. The AI seam exists (gateway,
consent dialog, checked answers, a stand-in provider outside production) and no real
provider is connected. A sync engine sends the outbox
and fetches changes on its own, with backoff, one tab at a time (ADR-0006). Collections and manual conversation cards can be made, edited, reordered,
printed, presented and deleted; they are encrypted records that sync like
journal entries. Reflect has its landing and session screens, answered by
the stand-in provider outside production; sessions are encrypted records
that sync, can be finished into a read-only state and can be deleted, and are removed when an entry they were built from changes. Cards can also be drafted by AI from journal entries the person ticks; they are stored with their provenance and removed when one of those entries changes. A note can be written after a conversation, only when the person chooses to; it is a record of its own kind that syncs and can be asked about in Reflect. Other routes render accessible placeholders.

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
docs/runbooks/           How to do risky operational changes safely
config/                  Build-time config shared with tests (security headers, CSP)
public/, index.html      PWA static assets and entry; vite.config.ts = build, manifest, SW, Vitest
tests/                   pytest (test_*.py); tests/frontend/ Vitest unit tests
e2e/                     Playwright E2E + axe: production/ (the real build),
                         app/ (the e2e build, with in-memory service doubles)
                         and pwa/ (that build as an installed app: install,
                         a whole journey offline, a full device)
docs/support/            Supported browsers, budgets and the manual checks
                         a person must do on real devices before launch
scripts/<gate>.sh        Runs the gate for Python, then TypeScript
scripts/python/          Python-only gates
scripts/typescript/      TypeScript-only gates
scripts/release/         The release gate, the policy guard and the scans
release/                 required-checks.yml: what a release must pass
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
- Synced records are written only by `PostgresSyncStore.apply`
  (`warmly/db/sync_store.py`, ADR-0006): one transaction per operation,
  which locks the account's counter row, checks the receipt, then writes
  only if the record is still at the operation's base revision. Never
  decode a payload, compare timestamps or pick a winner. The refusal rules
  live in `refusal_for` (`warmly/schemas/sync.py`). A refused operation
  stores nothing. The API role cannot delete a record, and a trigger keeps
  a tombstone deleted. The store and the in-memory test store must both
  pass `tests/fixtures/sync/scenarios-v1.json`.
- The change feed (`PostgresSyncStore.changes`) depends on that lock: an
  account's changes commit one at a time, in sequence order, so a reader
  never sees a later change before an earlier one. Never give out a
  sequence number any other way (no database sequence, no number taken
  outside the locked transaction). A page is limited by count and by
  payload size; a cursor the account was never given is refused with
  `sync.cursor_unknown`, never answered with an empty page.
- Every route that needs a signed-in caller is rate limited per account
  and per device (`warmly/api/rate_limit.py`): 429 with `Retry-After`,
  counted in PostgreSQL. A new router is included with the `limited`
  dependency in `warmly/api/__init__.py`.
- Every such route also has a row in `tests/security/matrix.py`, which
  attacks it from a second account against a real database. A route in the
  contract with no row fails the suite. After changing a route or an attack,
  run `python -m tests.security.render` to rewrite
  `docs/security/isolation-test-matrix.md`; never edit that file by hand.
  "Not yours" and "does not exist" must get the same answer: add any
  exception to `KNOWN_DIFFERENCES` with its reason.
- Database tests need `WARMLY_TEST_DATABASE_URL` (see README). They fail when it is
  missing; never mark them to skip.
- A commit may be released only if the Release Gate passes
  (`scripts/release/gate.py`, `docs/runbooks/release-gates.md`): every
  check in `release/required-checks.yml` must be there, finished and
  successful. Missing, skipped, cancelled, neutral and still running all
  block. Never make the gate treat anything but `success` as a pass. A
  job the manifest names never has an `if:` on the job itself, and never
  has `continue-on-error` on the job or on any of its steps. (A step may
  have an `if:`, as the steps that upload reports after a failure do.)
  The gate is the one job that runs `if: always()`, so it can report a
  failure. A test holds all of this.
- Never remove a check from that manifest, delete a file under one of its
  `paths`, or weaken a threshold to get green. The Release Policy Guard
  (`scripts/release/policy.py`) fails such a pull request unless a person
  has put the `release-policy-change` label on it. An agent never adds
  that label. Adding checks, paths and thresholds is always allowed.
- A scan that could not run is a failure (exit code 2 from
  `scripts/release/secret-scan.sh` and `sast.sh`; no report from Bandit).
  `.gitleaks.toml` allows only public test vectors: never add a path that
  could hold a real key. New CI jobs pin their actions by commit.

## Frontend conventions

- The service worker uses `registerType: "prompt"`: never auto-activate an update while
  a draft may be unsaved. Precache only the public app shell; never add runtime caching
  of API responses or anything containing plaintext.
- The app is installable: the manifest and its PNG icons are set in
  `vite.config.ts`, and the icons in `public/` are drawn from
  `public/icon.svg`. `e2e/pwa/install.spec.ts` checks them. The precache
  may hold scripts, styles, the page, the manifest and the app's own
  icons, and nothing else.
- What a browser lacks is found by `missingFeatures` (`src/app/support.ts`),
  from what it offers, never from its name. The shell's notice for a
  browser that cannot encrypt or store is fixed text. Never claim a
  browser or a device was checked by hand unless a person did it:
  `docs/support/browsers.md` lists what is automated and what is not.
- Budgets: a first visit downloads at most 150 KB of script and styles
  compressed (`e2e/production/budget.spec.ts`), and opening the journal
  decrypts each entry once (`tests/frontend/perf/scale.test.ts`). Raising
  either needs a reason in the PR. Never add a wall-clock time limit as a
  test: it fails for reasons that are not the code's.
- Every route and every kind of state is in the accessibility sweep
  (`e2e/app/a11y.spec.ts`): a new route, or a new kind of state, fails the
  suite until it is added to the plan there. Never turn an axe rule off.
  `docs/accessibility.md` says what is checked by machine and what no
  person has checked yet: never claim WCAG conformance or screen-reader
  testing that has not been done.
- Colour comes only from the tokens in `src/styles.css`. A component
  never sets a colour (a test scans `src/` for it). A grid that holds text
  uses `minmax(0, 1fr)` so a long word wraps instead of widening the
  page, and a `fieldset` is never a grid (Safari does not re-wrap its
  legend when it narrows).
- Settings shows one status summary (`StatusSummary`, PRD UI-008). Each
  line is a state, a count or fixed words, never anything the person
  wrote, and never more than the app does. `DELETING_STATUS` must say the
  same as `DELETE_WARNING`.
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
- A new device proves it knows the root key by signing its registration
  with the account's enrollment key, an Ed25519 key derived from the root
  key (`src/devices/signing.ts`, ADR-0005). The server is given the public
  half only. Never send or store anything that could make that signature,
  and never accept a registration without the proof. Never edit
  `tests/fixtures/enrollment/v2.json`: a change to the derivation or the
  signed message is a new version beside it.
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
- Storage failures are typed (`src/storage/errors.ts`): full, unavailable,
  blocked, newer. Everything that touches IndexedDB turns browser errors
  into these. A screen says what happened and what to do next with
  `src/ui/storage-messages.ts`, keeps what the person typed on the page,
  and never shows browser error text. Never drop data silently.
- The app asks the browser to keep its data (`services.persistence`) on
  unlock, and Settings reports the browser's answer as it is. Never claim
  data is kept when the browser has not agreed.
- The offline notice in the app shell (`OfflineNotice`, `src/app/App.tsx`)
  is fixed text only. Never put private text, counts or sync details that
  could reveal content in it.
- Sync follows ADR-0006 (`src/sync/`). The engine moves envelopes only and
  never sees a decrypted record. The server never picks a winner: a
  refused change stays on the device and shows as "Needs your attention".
  Never resolve a conflict by overwriting, and never let a deleted record
  come back. The status text is a state and a count, nothing private.
  `tests/fixtures/sync/scenarios-v1.json` is the protocol's scenario table;
  the in-memory server (`src/sync/testing/`, never in a production build)
  and the backend must both pass it. Never edit it: a protocol change is a
  new file. Retrying sync is always allowed; that never applies to AI.
- Sync runs through `SyncScheduler` (`src/sync/scheduler.ts`), reached as
  `services.sync`: never call the engine from a screen or add another
  timer. A page of changes and the new cursor are stored in one
  transaction (`applyPage`). A server version that cannot replace a local
  record is kept, still encrypted, in the `parked` store; never drop it and
  never apply it over unsent changes. A record is sent under the ID of its
  oldest queued change, and `duplicate` settles only that change. The
  engine never reads a clock to order anything.
- A record changed in two places is settled only by the person, through
  `keepMine`, `keepTheirs` or `keepMerged` (`src/sync/conflicts.ts`) on the
  "Changed in two places" screen. Never merge for them, never choose by
  time, and never remove either version before they choose. The server
  holds no second version: a choice is an ordinary operation.
- A deleted record never comes back under its ID. Text written after a
  deletion is offered as a new entry (`saveAsNew`), never re-sent under the
  old ID. Tombstones and the deletion ledger are never removed or
  compacted; the ledger is written by a database trigger, never by
  application code. Only a deletion the server has not accepted may be
  taken back, and only by the person (`keepEdited`).
- Every sync request states `SYNC_VERSION` (`src/sync/compat.ts`); the
  server speaks `SYNC_VERSION_MIN` to `SYNC_VERSION_MAX`
  (`warmly/schemas/sync.py`) and refuses anything else with 426. A refused
  build keeps every record and queued change and asks for an update: never
  discard anything to get past a refusal. Change either number only by
  following `docs/runbooks/sync-versions.md`.
- A new version of the app is applied only when the person presses "Update
  now" (`UpdateNotice`, `src/app/App.tsx`), and only after
  `services.lockHooks.flush()` has saved unsaved writing. The service
  worker's update function is handed to `services.updates` in `src/main.tsx`
  and run only by `services.updates.apply()`, which only `UpdateNotice`
  calls. Never call it any other way.
- Every AI call goes through `AiGateway` (`src/ai/gateway.ts`), reached as
  `services.ai` (D-17). Only the gateway imports a provider, and it needs a
  consent token for the very request being sent. A token is made only by
  the confirm button of `AiDisclosureDialog`, and works once. The dialog
  takes the request alone and asks the gateway what to say about it, and a
  request is sealed (deep-frozen) once it has been described or agreed to:
  never pass the dialog its own description, and never copy a request to
  get around the seal. Never make,
  store or reuse a token anywhere else, never call a provider directly, and
  never add a retry or a second provider. A lint rule and
  `tests/frontend/ai/dependencies.test.ts` enforce the imports.
- A provider's answer is `unknown` until the gateway has checked it
  (ADR-0008): its form (`src/ai/contracts.ts`) and every citation against
  what that request sent (`src/ai/grounding.ts`). A provider is given
  entries under per-request names (`E1`), never an ID or hash, and cites a
  name and an exact quote; the app works out IDs, hashes and ranges itself.
  One failure refuses the whole answer: never repair it, loosen the
  matching, accept part of it or ask again. Answer text is shown as text,
  never as HTML, and never becomes a link or an image. Never edit
  `tests/frontend/ai/fixtures/adversarial-v1.json`: add a new file.
- Screens read collections and cards only through `CardsStore`
  (`src/domain/cards/store.ts`), reached as `services.cards`, and change
  them only through `src/domain/cards/collections.ts` and `cards.ts`. A
  collection and each card are separate records (kinds `card-collection`
  and `conversation-card`, envelope types 2 and 3: never reuse a type
  number; 4 is a Reflect session, 5 is a note written after a
  conversation). A card never holds text copied from a journal entry, only
  references (PRD DEP-004). A collection's name and a card's text never go
  in a URL, the tab title or drag data.
- A collection's cards are shown by `orderCards`: the cards its list names,
  then any other card that belongs to it. Never drop a card because the
  list does not name it: that is what keeps cards written on two devices
  when one version of the list is kept. Deleting a collection deletes
  every card that belongs to it, and both deletions ask first. A card
  whose collection is gone (added on one device while the collection was
  deleted on another) is never hidden: `CardsStore.strays` lists it and
  the collections screen offers to keep or delete it. Never move or
  delete such cards without being asked.
- Cards are drafted by AI only on the "Suggest cards" screen
  (`src/ui/screens/prepare/SelectEntries.tsx`, route `suggest-cards`;
  PRD CC-001 to CC-004). Nothing is ticked to begin with: never tick an
  entry for the person, and never add "select all", "recent" or
  suggested selections. The request is built by `cardsRequest`
  (`src/domain/cards/generate.ts`) from exactly the ticked entries: never
  add one, and never drop one to make the request fit (the person is
  asked to tick fewer). One to three cards come back; fewer than three is
  a success and nothing tops them up. Accepted cards are made by
  `cardsFrom` and stored by `saveGenerated` as `ai_generated`, each with
  `sources`: every entry that was sent, quoted or not, with its hash
  then. Cards that have arrived are never dropped: they stay on the page
  until stored, are stored before a lock, and are kept even if their
  collection was deleted meanwhile. The words a real provider is given
  are `cardsTexts` (`src/ai/prompts/cards.ts`); never change
  `CARDS_POLICY` without `tests/frontend/cards/prompt.test.ts`.
- A card AI drafted is shown in two modes on its own screen (PRD CC-005,
  CC-006). Conversation mode comes first, every time, and is the card's
  words and nothing else. Learning mode makes each part a button
  (`SegmentHighlight`) that names its kind in words, never by colour
  alone, and opens `SegmentDetail`. What a part rests on is worked out
  when it is shown, by `provenanceOf` (`src/domain/cards/provenance.ts`),
  from the entry as it is now and only if its content hash still matches:
  otherwise no words are shown. An inference or a suggestion is always
  labelled as that. Never store an excerpt in a card, and never show one
  from an entry that has changed. Switching mode and opening a part call
  no AI; the mode lives in component state only. Never check, score or
  correct the person's wording.
- Other wordings for a part are asked for only by the "Generate more
  options" button in `SegmentDetail` (PRD CC-005). Opening the panel
  never asks. Each press is a request of its own, built by
  `alternativesRequest` (`src/domain/cards/alternatives.ts`) from the
  part's words and the card's own source entries that still match their
  hashes, and no others. What comes back cites nothing (ADR-0008) and is
  shown as suggestions. It lives in component state only: never store a
  suggestion that was not picked. A picked wording replaces that part
  through `chooseAlternative`, which is a change like any other: the
  part loses its AI notes and the card becomes the person's own. The words a real provider is
  given are `alternativesTexts` (`src/ai/prompts/alternatives.ts`).
- A card AI drafted becomes the person's own (`user_owned`) the first
  time any change to it is saved (decision D-15): through `rewriteParts`
  (`src/domain/cards/ownership.ts`), `editCard` or `chooseAlternative`.
  Saving with nothing changed, and moving a card, are not changes. The
  step is one-way: never set a card back to `ai_generated`. A part whose
  words change loses its quotes, kind of evidence and explanation at
  once; build the result with `owned`, which also drops every reference
  to the journal once no part has AI notes left (PRD DEP-004). Any card
  can be rewritten part by part or as one text. Never check, soften,
  score or refuse the person's wording.
- `CARD_RULE` (`src/domain/cards/dependencies.ts`) says what happens to
  a card when an entry sent for it is changed or deleted. An unedited AI
  card is deleted. A `user_owned` card is never deleted: if it still
  carries AI notes they are all taken out (`withoutAiNotes`) and its
  words are kept; if it carries none it depends on nothing. A dependent's
  `action` is `delete` or `strip`; only deletions are counted in the
  notice and in the warning before an entry is edited.
- A manual card is `user_owned` with no AI fields; making, changing,
  moving or deleting one never calls AI or the network (PRD CC-010). Never
  correct, score or block what the person writes on a card. Reordering
  must always work from the keyboard (Move up, Move down) and say where
  the card went; dragging is an extra.
- A collection or card changed in two places is settled by the person on
  the "Changed in two places" screen through `src/sync/card-conflicts.ts`,
  under the same rules as an entry: never merge or choose for them, and
  never bring back one that was deleted (`keepAsNew` writes a new record).
- Presentation always opens at the first card and its position lives in
  component state only: never store it, put it in the address or report
  it, and never record which cards were shown or for how long (PRD
  CC-012). The print view shows card text only, and printing happens only
  when the person presses Print.
- A screen that asks AI for something uses one `AiRequestController`
  (`src/ai/request-controller.ts`) and renders `AiRequestStatus` for it
  (PRD AI-014 to AI-017). The controller keeps the request through failure
  and cancel, sends only from `confirm` with a consent token, and after a
  failure does nothing until the person presses Try again, which reopens
  the dialog. Its one timer stops a request that takes too long; never add
  a timer, retry, backoff or second provider. Failures are named by
  `classifyAiError` and put into words by `describeAiError`
  (`src/ai/errors.ts`): never show a provider's own error text. A request
  must fit the budget (`src/ai/budget.ts`, limits in `src/ai/config.ts`),
  and the gateway runs one request at a time. Cancel and the time limit
  end the wait at once (`untilAborted`, `src/ai/abort.ts`) in both the
  controller and the gateway, whether or not the provider stops; a
  provider adapter must still pass the signal on, and whatever a stopped
  call returns later is dropped unread. Call `reset()` when the screen
  closes or the app locks.
- Reflect (`src/ui/screens/reflect/`, `src/domain/reflect/`): opening
  the landing page or a saved reflection never calls AI (PRD RF-001). The
  only way to an answer is the person's own question (no suggested or
  canned questions, RF-002), the Ask button and the disclosure dialog. A
  request is built by `reflectRequest` from fresh copies of finished
  entries, never from stored records themselves and never from a draft. An
  answer is shown with `CitedAnswer`, which shows answer text as text and
  reads cited words from the entry as it is now, and only if its content
  hash still matches. An answer records every entry that was sent for
  it, with its hash then (`ReflectionAnswer.sources`), cited or not.
- Which entries a Reflect request sends is decided only by `selectContext`
  (`src/domain/reflect/context.ts`, ADR-0009), on the device, from sizes
  given by `services.ai.sizing()`: never call AI or the network to choose,
  never use a clock or randomness, and never send part of an entry. An
  entry too long to send at all is left out and the dialog says so; only
  when no entry fits is the request refused. When
  entries are left out, the request says how many, the dialog says "N of
  your M", and `CitedAnswer` says so above the answer from what the app
  sent, whatever the model wrote. Changing `SHARES` or `ESTIMATE_MARGIN`
  needs a new decision.
- A follow-up question sends the earlier turns of its own session and of
  no other (`historyOf`, `askRequest` in `src/domain/reflect/ask.ts`; PRD
  RF-006): prose only, never an answer's citations, IDs or hashes. The
  words a real provider is given are `reflectTexts`
  (`src/ai/prompts/reflect.ts`): fixed instructions that hold nothing the
  person wrote, and one JSON document for everything they did write, so
  journal text cannot pass for instructions. Never put journal text in the
  instructions, and never change `REFLECT_POLICY` without its test.
- Following a citation marks the cited words in the entry. Where they are
  travels in memory through `services.passage` (`CitedPassage`), once:
  never in the address, storage or history. The entry screen marks them
  only if the entry's content hash still matches (`passageIn`).
- What was built from a journal entry is removed when that entry is
  edited or deleted (invariant 6; ADR-0010, `src/domain/deps/`). A record
  is stale when an entry it was built from is known to be deleted
  (`RecordStore.deleted`) or is here, settled, and has a different content
  hash. An entry that is not here yet, is waiting in "Changed in two
  places", or cannot be read says nothing: never treat "not here" as
  deleted. A Reflect session depends on every entry sent for any of its
  answers, cited or not, and is deleted whole, as an ordinary deletion
  that syncs. `Invalidator` (`services.invalidation`) runs on unlock and
  after every record change and stops in `dropSecrets`. It never calls AI
  and nothing is regenerated; `src/domain/deps` imports nothing from
  `src/ai`. A new kind of derived record adds a rule to
  `src/domain/dependency-rules.ts`. The person is told before (the edit
  screen and delete confirmation, `dependentsWarning`) and after (the
  shell's notice, `removedText`): a count and fixed words only.
- What Warmly is not is said in fixed words on the help page
  (`src/ui/screens/help/boundaries.tsx`, route `help`, access `open`),
  on sign-up and on Reflect: not therapy, not a medical or crisis service,
  not a judge, a fallible aid (PRD RF-012). Never add crisis detection,
  sentiment scoring or any reading of journal text for the app's own
  purposes (RF-013); a test scans the source for it. Every answer ends
  with `ANSWER_IS_A_READING`. `open` access is only for screens of fixed
  words that show nothing private. The rules a provider is given are
  pinned clause by clause in `tests/frontend/reflect/policy.test.ts`, and
  `tests/frontend/reflect/fixtures/injection-v1.json` holds journal text
  that tries to act as instructions: never edit it, add a new version.
  These tests prove the app's own controls, not how a model behaves.
- A Reflect session and all its questions and answers are one private
  record (kind `reflect-session`, envelope type 4), changed only through
  `ReflectSessions` (`src/domain/reflect/sessions.ts`), reached as
  `services.reflect`. It is `active` until the person presses Finish
  Reflection: never finish one for any other reason (leaving, locking,
  time), never make a finished one active again, and never call AI or
  write a summary on finishing (PRD RF-007). An answer that has arrived is
  never dropped: if it cannot be stored it stays on screen with a way to
  save it, and if its session was finished elsewhere it is saved as a new
  one. A session changed in two places is settled by the person like a
  card (`src/sync/card-conflicts.ts`).
- What is written after a conversation is its own record (kind
  `post-conversation`, envelope type 5; `src/domain/post-conversation/`,
  PRD PC-001 to PC-004, D-22), changed only through `createAfter`,
  `editAfter` and `deleteAfter`. It is never a journal entry, is never
  turned into one and is never called one on screen. All three answers
  are optional; only an empty form is refused. A note has no draft: what
  is typed and not yet saved is saved as the note when the app locks
  (the form's lock hook), and the page says so. A first save that is on
  its way is waited for, never repeated. If the note was changed
  elsewhere meanwhile, the typed words are kept as a new note on lock,
  never written over the other version and never dropped. Nothing ever asks for one:
  no prompt, dialog, badge or reminder when presentation closes or at any
  other time (PC-002), and nothing links it to the cards that were used.
  When sent to Reflect it goes under kind `post_conversation` with its own
  answer names (`went_well`, `difficult`, `remember`), is counted apart
  from journal entries in the disclosure dialog, and is a source like an
  entry: what was built from it is removed when it changes or is deleted
  (`SOURCE_KINDS`, `src/domain/deps/invalidate.ts`).
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
