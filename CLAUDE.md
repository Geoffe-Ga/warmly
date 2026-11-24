# Claude Code Project Context: Warmly

Warmly is a private, end-to-end-encrypted, offline-first **relationship journaling PWA**.
It helps one person reflect on their own relationship history and prepare conversation
cards for calm face-to-face talks. Accounts are fully independent; partners are never linked.

**Source of truth:** [`docs/plans/relationship_communication_agent_prd.md`](docs/plans/relationship_communication_agent_prd.md).
Read the relevant PRD section (IDs such as `JR-`, `RF-`, `CC-`, `SEC-`, `SYNC-`, `DEP-`,
`AI-`, `AC-`) before implementing anything, and cite those IDs in issues, PRs and tests.
Human-facing overview: [README.md](README.md).

**Status:** scaffold only. `warmly/` (Python) is a stub; `src/` is a framework-free Home shell.

---

## Stack and boundaries

| Layer | Tech | Rule |
| --- | --- | --- |
| Frontend | TypeScript PWA (`src/`), Vite + vite-plugin-pwa | Owns UI, client-side crypto (AEAD, key wrapping), IndexedDB, local search, `AIProvider` adapters (OpenAI, Anthropic) |
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
plans/architecture/      import-linter rules for Python layering
warmly/                  FastAPI backend package
src/                     TypeScript PWA (app.ts shell, main.ts bootstrap + SW registration)
public/, index.html      PWA static assets and entry; vite.config.ts = build, manifest, SW, Vitest
tests/                   pytest (test_*.py); tests/frontend/ Vitest unit tests
e2e/                     Playwright E2E + axe accessibility tests
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

## Frontend conventions

- The service worker uses `registerType: "prompt"`: never auto-activate an update while
  a draft may be unsaved. Precache only the public app shell; never add runtime caching
  of API responses or anything containing plaintext.
- `no-console` is an ESLint error, because logs must never contain journal content.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Use
  `tsconfig.node.json` for config and E2E files.

## Open decisions and notes

- **UI framework** is undecided (the shell is framework-free). Record it in an ADR
  before feature work.
- `.claude/docs/*` and `.claude/skills/*` examples are generic (Python, Jest). This
  project uses Vitest; follow the PRD and this file where they conflict.
