<!-- E04-I08 | title: feat(sync): negotiate schema versions and update the app without losing work -->

## Role

You are a senior full-stack engineer (TypeScript PWA and Python FastAPI on PostgreSQL) who has built offline-first sync.

## Goal

Make old and new clients coexist safely: the server rejects incompatible sync schema versions with a typed error, the client keeps working offline and prompts for an update, and the update never activates over unsaved work.

## Context

- **Parent epic:** #EPIC_04_NUMBER (Encrypted multi-device sync)
- **Predecessor issue(s):** #E04_I07_NUMBER (E04-I07: test(sync): prove cross-account isolation and ciphertext-only handling, and add rate limits). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §8 (mixed versions), §7 (migrations), §13.6, §10 [REL-004]
- **Acceptance criteria advanced:** AC-28
- **Files involved:**
  - `warmly/api/`, `warmly/config.py`: supported schema-version window and the typed rejection
  - `src/sync/compat.ts`: new client handling of `upgrade_required`
  - `src/main.ts`: service-worker update prompt flow
  - `tests/fixtures/`: previous-version envelope and IndexedDB fixtures
  - `docs/adr/0006-sync-protocol.md`: add the compatibility window
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-20: every request states the client's sync schema version. Outside the supported window the server returns 426 with code `sync.upgrade_required` and applies nothing.
  - On `upgrade_required` the client stops syncing, keeps all local data and the outbox, stays fully usable offline and asks the user to update. It never discards queued operations.
  - A newer client must still read every older committed envelope and IndexedDB fixture version (fail closed on unknown newer versions).
  - The service worker stays `registerType: 'prompt'`. The update prompt is deferred while a draft has unsaved changes; accepting it flushes drafts first.
- **State of the world:** There is one schema version and no negotiation. The update prompt exists but ignores draft state.

## Output Format

Deliverable is a single PR containing:

- [ ] Server window check and client handling, with tests for too-old and too-new clients
- [ ] Fixture-compatibility test that loads every committed prior version
- [ ] E2E: a new service worker waits while a draft is dirty, then updates after save without data loss
- [ ] Runbook note: how to raise the minimum supported version safely
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response**
```
POST /v1/sync/operations
X-Warmly-Schema: 0

426 Upgrade Required
{ "code": "sync.upgrade_required", "min_supported": 1, "max_supported": 1 }
```

## Constraints

**Scope fence:** Do not introduce a second schema version just to test this; use fixtures and a test-only version override. If you find yourself touching files well
outside the list above, stop and check with the user.

**Product invariants (CLAUDE.md, PRD §0 and §4–§6):** no plaintext leaves
the client except to the user's chosen AI provider after an explicit, disclosed
user action; no automatic AI calls, AI retries or provider fallback; owner-only
access with device authorization re-checked on every sync operation; no partner
linking, scores, streaks or tracking; sync never uses last-write-wins. If an
invariant cannot be met, stop and report a scoped blocker. Do not weaken it, and
do not delete or skip a failing test to get green.

**Anti-bypass (verbatim, non-negotiable):**

> No `noqa`, `# type: ignore`, `pylint: disable`, `eslint-disable`, or
> equivalent linter/type-checker silencers. Fix the root cause. The only
> exception is the documented 4-line escape hatch (third-party library
> bug / language-version compatibility / benchmarked performance
> necessity / generated code) — and it must include the reason, a
> reference URL, an alternative considered, and a review date. See the
> `max-quality-no-shortcuts` skill.

**Tracer-code invariant:** The system must remain demoable after this PR
merges. If your change breaks an unrelated screen, endpoint or test, you
have gone outside scope: revert and re-plan.

## Definition of Done (stay-green)

- [ ] `./scripts/check-all.sh` exits 0 (lint, format, types, security,
  complexity ≤10, unit tests with coverage ≥90% and branch ≥85%).
- [ ] `./scripts/e2e.sh` passes on desktop Chromium and mobile Safari, including axe checks for every screen this PR touches.
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_04_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `edges`, `sync`
