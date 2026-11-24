<!-- E01-I02 | title: feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract -->

## Role

You are a senior Python engineer working in this repo's `warmly/` FastAPI package.

## Goal

Replace the `print` stub with a FastAPI application whose `/v1` surface is complete in shape, returns schema-valid stub data, and is exported to a committed OpenAPI file from which the frontend's TypeScript types are generated.

## Context

- **Parent epic:** #EPIC_01_NUMBER (Foundation and walking skeleton)
- **Predecessor issue(s):** none. This is the first issue of the decomposition.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §5.2 [SYNC-002], §8
- **Acceptance criteria advanced:** none directly; supports later criteria
- **Files involved:**
  - `warmly/main.py`: current `print` stub; becomes the ASGI entry point
  - `warmly/api/`: new routers: health, sync, devices, enrollment, recovery
  - `warmly/schemas/`: new Pydantic request and response models
  - `openapi/warmly.v1.json`: new committed contract, exported by a script
  - `src/api/schema.d.ts`: new generated types; never edited by hand
  - `scripts/python/`, `scripts/typescript/`: add a contract-drift check to `check-all.sh`
  - `plans/architecture/.importlinter`: extend layering to the new packages
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Routes: `GET /v1/health`, `GET /v1/ready`, `GET /v1/sync/changes?cursor=`, `POST /v1/sync/operations`, `GET /v1/devices`, `POST /v1/devices`, `PATCH /v1/devices/{id}`, `POST /v1/devices/{id}/revoke`, `POST /v1/enrollments`, `GET /v1/enrollments/{id}`, `POST /v1/enrollments/{id}/approve`, `GET|PUT /v1/recovery-envelope`.
  - Payload fields are opaque base64 strings. The server never parses, inspects or logs them (SEC-005).
  - Errors use RFC 9457 problem details with a stable machine-readable `code`.
  - Pin every new dependency with hashes in `requirements.txt`; check the live PyPI version first.
- **State of the world:** `warmly/main.py` prints a greeting. `requirements.txt` is empty. No ASGI app exists.

## Output Format

Deliverable is a single PR containing:

- [ ] FastAPI app factory, routers and Pydantic models for the routes above, all returning fixed stub data
- [ ] Smoke test per route asserting status code and response-model validity
- [ ] Export script plus a check that fails when `openapi/warmly.v1.json` or `src/api/schema.d.ts` is stale
- [ ] `README.md` section: how to run the API locally
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Request/response (stub)**
```
GET /v1/sync/changes?cursor=0
200 OK
{ "changes": [], "next_cursor": "0", "has_more": false }

POST /v1/sync/operations
{ "operations": [ { "op_id": "…uuid…", "record_id": "…uuid…", "type": 1,
    "base_revision": 0, "schema_version": 1, "tombstone": false,
    "payload": "b64…" } ] }
200 OK
{ "results": [ { "op_id": "…uuid…", "status": "applied", "revision": 1 } ] }
```

## Constraints

**Scope fence:** No database, no JWT verification and no device checks yet. Stubs must not pretend to persist; those land in E01-I05, E02 and E04. If you find yourself touching files well
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
- [ ] `pre-commit run --all-files` is clean: no skipped hooks, no bypassed checks.
- [ ] Public API changes are reflected in docstrings and user-facing docs.
- [ ] PR body includes `Refs #EPIC_01_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `tracer-skeleton`, `foundation`
