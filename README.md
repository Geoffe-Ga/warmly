# Warmly

A private, warm, journal-like **PWA for personal relationship reflection** and for
preparing calm, constructive face-to-face conversations.

People record their own experiences over time, ask questions about their own history,
and turn selected entries into editable **conversation cards** to read aloud or print.
Each account is completely independent: there is no partner linking, sharing or
household data, and no account can see another's writing.

> **Status:** pre-implementation. The repository currently contains the quality
> scaffold only (tooling, CI, agent context). The product specification lives in
> [`docs/plans/relationship_communication_agent_prd.md`](docs/plans/relationship_communication_agent_prd.md),
> which is the source of truth for scope, security invariants and acceptance criteria.

## What it does (MVP)

- **Journal**: three required prompts per entry (*What's going well? / What would you
  like to improve? / Since your last entry, how has your partner helped you feel loved?*),
  an optional emotional check-in, offline drafts, in-place edit and permanent delete.
- **Reflect**: ask your own question about your journal history and get a conversational,
  source-cited answer. Inferences are presented as hypotheses, never verdicts. AI runs
  **only** when you explicitly submit.
- **Prepare for a Conversation**: pick entries yourself; AI groups them into up to three
  thematic cards built from labelled segments (observation, feeling, need, request,
  appreciation, curiosity). A learning mode explains each segment, and every card is
  fully editable. Cards can be collected, presented one at a time, or printed.
- **Optional post-conversation reflection**: a private, lightweight form.

Deliberately **not** included: partner sharing, scores, streaks, notifications,
diagnosis, automated or background AI analysis, voice, or AI model selection.

## Privacy model

- **End-to-end encrypted.** Journal content, cards, reflections, provenance and AI
  credentials are encrypted in the browser before sync. The server stores only
  ciphertext plus the minimum metadata needed to sync.
- **Bring your own key (BYOK).** OpenAI or Anthropic API keys are stored encrypted and
  synced only across the same user's devices. Plaintext goes from the browser straight
  to the chosen provider, never through the backend, and only after explicit,
  disclosed consent for each request.
- **Devices and recovery.** Each account has a personal recovery key; you can enrol a new
  device from an unlocked one, revoke devices, and rely on a 30-minute inactivity lock.
  A password reset alone cannot decrypt data.
- **Offline-first.** IndexedDB holds encrypted records. Sync uses revisions with
  compare-and-swap, keeps manual conflict resolution, and records deletions durably as
  tombstones.

The full threat model, including residual risks, is in §4 of the PRD.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Frontend | TypeScript PWA (Vite + vite-plugin-pwa) | All UI, client-side crypto, IndexedDB storage, local search, AI provider adapters (`AIProvider`: OpenAI / Anthropic) |
| Backend | Python **FastAPI** | Owner-scoped encrypted sync (`/v1/sync/*`), device enrollment/revocation, health. Never sees plaintext. |
| Data / Auth | Supabase Auth + managed PostgreSQL | Identity; ciphertext persistence with deny-by-default row-level ownership |
| Ops | GitHub Actions | Fail-closed CI/CD, autonomous deploy with rollback gates, 30-day encrypted backups |

Implementation order (PRD §12): foundation → identity and crypto → offline journal →
sync → BYOK compatibility gate → Reflect → cards → polish and release hardening.

## Repository layout

```
warmly/
├── docs/plans/            # PRD and implementation plans (source of truth)
├── docs/security/         # Threat model
├── build/                 # Build-time config shared with tests (security headers)
├── plans/architecture/    # import-linter layer rules for the Python backend
├── warmly/                # FastAPI backend: api/ (routers), schemas/ (wire models); routes are stubs
├── openapi/               # Committed API contract, exported from the code
├── src/                   # TypeScript PWA: app/ (routes, shell), ui/, api/ (generated types)
├── tools/contract/        # Isolated toolchain that generates src/api/schema.d.ts
├── public/                # Static PWA assets (icon)
├── index.html             # PWA entry; vite.config.ts holds build, manifest, SW and Vitest config
├── tests/                 # pytest (test_*.py); tests/frontend/ for Vitest unit tests
├── e2e/                   # Playwright E2E + axe-core accessibility tests
├── scripts/               # Quality gates; root scripts run both languages
│   ├── python/            #   Python-only gates (ruff, mypy, bandit, pytest, mutmut…)
│   └── typescript/        #   TypeScript-only gates (eslint, tsc, prettier, vitest, playwright, stryker)
├── .github/workflows/     # CI and AI code review
└── .claude/               # Agent context: docs, skills, subagents
```

## Getting started

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
npm install
npx playwright install chromium webkit   # browsers for E2E (once)
pre-commit install
./scripts/check-all.sh     # Python gates, then TypeScript gates
```

## Quality gates

Each root script under `scripts/` runs the Python variant and then the TypeScript
variant. Call `scripts/python/<gate>.sh` or `scripts/typescript/<gate>.sh` to run just one.

| Command | Purpose |
| --- | --- |
| `./scripts/check-all.sh` | Every gate; must exit 0 before you commit |
| `./scripts/test.sh` / `coverage.sh` | Unit tests with ≥90% coverage (pytest, Vitest) |
| `./scripts/e2e.sh` | Playwright E2E + axe accessibility on desktop Chromium and mobile Safari |
| `./scripts/lint.sh` / `typecheck.sh` / `format.sh` | Static checks and formatting |
| `./scripts/contract.sh` | Regenerate the OpenAPI contract and its TypeScript types (`--check` fails if either is stale) |
| `./scripts/security.sh` / `complexity.sh` | Bandit, pip-audit, radon/xenon |
| `./scripts/mutation.sh` | **Optional**, release-time only (see below) |

**Merge workflow:** local `check-all` passes → CI green → code review LGTM.

**Mutation testing is not a per-PR or per-CI requirement.** It is an advisory check
you can run when cutting a final release. CI runs it automatically when a GitHub
Release is published, or on manual dispatch with `run_mutation` checked. A score below
the 80% target produces a warning and never blocks the release.

Frontend dev server: `npm run dev`. Production build: `npm run build`, then `npm run preview`.

### Running the API locally

```bash
python -m warmly.main          # serves http://127.0.0.1:8000
curl http://127.0.0.1:8000/v1/health
```

Every route except health and readiness is still a stub: it returns fixed data, stores
nothing, and says so with a `Warmly-Stub: true` response header. The contract lives in
`openapi/warmly.v1.json` and is served at `/v1/openapi.json`.

After changing a route or model, run `./scripts/contract.sh` and commit the regenerated
`openapi/warmly.v1.json` and `src/api/schema.d.ts`. Never edit either by hand. Runtime
dependencies are pinned with hashes: edit `requirements.in`, then run
`pip-compile --generate-hashes --strip-extras --output-file requirements.txt requirements.in`.

## Open decisions

- **UI framework:** Preact with TSX; see [ADR-0001](docs/adr/0001-ui-framework.md).
- **PWA icons:** a single SVG icon ships now; PNG/maskable icons are still needed for the
  widest install support.

## License

MIT. Scaffolded with [Start Green Stay Green](https://github.com/Geoffe-Ga/start_green_stay_green).
