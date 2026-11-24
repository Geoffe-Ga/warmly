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
| Frontend | TypeScript PWA | All UI, client-side crypto, IndexedDB storage, local search, AI provider adapters (`AIProvider`: OpenAI / Anthropic) |
| Backend | Python **FastAPI** | Owner-scoped encrypted sync (`/v1/sync/*`), device enrollment/revocation, health. Never sees plaintext. |
| Data / Auth | Supabase Auth + managed PostgreSQL | Identity; ciphertext persistence with deny-by-default row-level ownership |
| Ops | GitHub Actions | Fail-closed CI/CD, autonomous deploy with rollback gates, 30-day encrypted backups |

Implementation order (PRD §12): foundation → identity and crypto → offline journal →
sync → BYOK compatibility gate → Reflect → cards → polish and release hardening.

## Repository layout

```
warmly/
├── docs/plans/            # PRD and implementation plans (source of truth)
├── plans/architecture/    # import-linter layer rules for the Python backend
├── warmly/                # Python package: FastAPI backend (currently a stub)
├── src/                   # TypeScript frontend (currently a stub)
├── tests/                 # pytest (test_*.py) and TS tests (*.test.ts)
├── scripts/               # Quality gates; root scripts run both languages
│   ├── python/            #   Python-only gates (ruff, mypy, bandit, pytest, mutmut…)
│   └── typescript/        #   TypeScript-only gates (eslint, tsc, prettier, jest, stryker)
├── .github/workflows/     # CI and AI code review
└── .claude/               # Agent context: docs, skills, subagents
```

## Getting started

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
npm install
pre-commit install
./scripts/check-all.sh     # Python gates, then TypeScript gates
```

## Quality gates

Each root script under `scripts/` runs the Python variant and then the TypeScript
variant. Call `scripts/python/<gate>.sh` or `scripts/typescript/<gate>.sh` to run just one.

| Command | Purpose |
| --- | --- |
| `./scripts/check-all.sh` | Every gate; must exit 0 before you commit |
| `./scripts/test.sh` / `coverage.sh` | Tests with ≥90% coverage |
| `./scripts/lint.sh` / `typecheck.sh` / `format.sh` | Static checks and formatting |
| `./scripts/security.sh` / `complexity.sh` | Bandit, pip-audit, radon/xenon |
| `./scripts/mutation.sh` | **Optional**, release-time only (see below) |

**Merge workflow:** local `check-all` passes → CI green → code review LGTM.

**Mutation testing is not a per-PR or per-CI requirement.** It is an advisory check
you can run when cutting a final release. CI runs it automatically when a GitHub
Release is published, or on manual dispatch with `run_mutation` checked. A score below
the 80% target produces a warning and never blocks the release.

## Known scaffold gaps (to resolve in the Foundation phase)

- CI (`.github/workflows/ci.yml`) currently covers only Python; TypeScript lint,
  typecheck and test jobs still need to be added.
- The PRD calls for **Vitest + Playwright + axe-core**; the scaffold ships Jest.
- The TypeScript config targets Node/CommonJS; the PWA needs a browser bundler setup.

## License

MIT. Scaffolded with [Start Green Stay Green](https://github.com/Geoffe-Ga/start_green_stay_green).
