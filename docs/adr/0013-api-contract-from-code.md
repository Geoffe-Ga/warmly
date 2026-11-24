# ADR-0013: The API contract is generated from code, with an isolated type generator

- **Status:** Accepted
- **Date:** 2026-11-24
- **PRD references:** §5.2 [SYNC-002], §8, §14 (OpenAPI specification)

ADR numbers 0002 to 0012 are reserved for decisions already assigned to backlog
issues (see `git-issues/2026-11-24_SPEC_summary.md`), so this one takes 0013.

## Context

The PWA and the FastAPI backend must agree on request and response shapes, and
the PRD requires a versioned OpenAPI specification. Two things can drift: the
specification from the backend code, and the frontend's types from the
specification.

## Options

### Option 1: Hand-written OpenAPI file, hand-written TypeScript types

- **Pros:** no tooling.
- **Cons:** three sources of truth; drift is found at runtime.

### Option 2: Hand-written OpenAPI file as the source; generate both sides

- **Pros:** one source; language-neutral.
- **Cons:** needs a Python server generator as well; the generated server code
  fights FastAPI's own model-driven validation.

### Option 3: Pydantic models as the source; export OpenAPI; generate TypeScript

- **Pros:** one source, and it is the code that actually validates requests;
  FastAPI exports OpenAPI natively; only one generator is needed.
- **Cons:** the exported file depends on library versions, so they must be
  pinned and the export must be deterministic.

## Comparison

| Dimension | Hand-written both | Spec first | Code first |
| --- | --- | --- | --- |
| Sources of truth | 3 | 1 | 1 |
| Generators to maintain | 0 | 2 | 1 |
| Drift detected | At runtime | In CI | In CI |
| Validation matches the contract | By discipline | By generation | By construction |

## Decision

Use **option 3**. `warmly/contract.py` renders the application's OpenAPI schema
with sorted keys to `openapi/warmly.v1.json`. `scripts/typescript/contract.sh`
generates `src/api/schema.d.ts` from that file. Both outputs are committed, and
`./scripts/contract.sh --check` (in `check-all.sh` and CI) fails when either is
stale. A pytest test makes the same comparison for the OpenAPI file on every
supported Python version.

The TypeScript generator, `openapi-typescript`, requires TypeScript 5 while the
app uses TypeScript 6. It therefore lives in `tools/contract/` with its own
`package.json` and lockfile. This keeps a development-only tool and its
dependency tree out of the app's `node_modules` and avoids overriding a peer
dependency.

## Consequences

- Never edit `openapi/warmly.v1.json` or `src/api/schema.d.ts` by hand. Change
  the models, then run `./scripts/contract.sh`.
- Anything that reaches the contract must be identical on every supported
  Python version. Standard-library status phrases are not (422 was renamed in
  Python 3.13), so response descriptions are written explicitly.
- Runtime dependencies are pinned with hashes, because a FastAPI or Pydantic
  upgrade can change the exported schema. Expect a contract diff in the same
  pull request as such an upgrade.
- `openapi/` is excluded from Prettier; the renderer owns its formatting.
- When `openapi-typescript` supports TypeScript 6, fold `tools/contract/` back
  into the root package.
