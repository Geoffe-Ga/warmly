<!-- E05-I04 | title: feat(ai): define the AI data contracts and the grounding validator -->

## Role

You are a senior TypeScript engineer working in this repo's `src/ai/` module, experienced with LLM APIs and structured output.

## Goal

Define runtime-validated schemas for every AI request and response and a grounding validator that accepts a response only if every cited source was actually sent in that request and every quoted excerpt really appears in it.

## Context

- **Parent epic:** #EPIC_05_NUMBER (AI provider layer and the BYOK compatibility gate)
- **Predecessor issue(s):** #E05_I01_NUMBER (E05-I01: feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §6.2 [AI-007..012], §4.2 [SEC-010]
- **Acceptance criteria advanced:** AC-07, AC-26, AC-10
- **Files involved:**
  - `docs/adr/0008-ai-grounding-contract.md`: new ADR
  - `src/ai/contracts.ts`: new schemas and types: `SourceRef`, `CardSegment`, `GeneratedCard`, `ReflectionAnswer`
  - `src/ai/manifest.ts`: new per-request source manifest
  - `src/ai/grounding.ts`: new validator
  - `tests/frontend/ai/fixtures/`: adversarial response fixtures
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - D-16: prompts refer to sources by short per-request aliases (`E1`, `E2`, ...) and the response cites an alias plus a **verbatim quote**. The client checks the quote is an exact substring of the text sent under that alias, computes the character range itself, and maps the alias to the real `entryId` and `sourceHash` from the request manifest. Models copy 64-character hashes and count character offsets unreliably; this removes both failure modes, keeps real record IDs out of the provider's hands, and makes fabricated citations impossible to accept.
  - The app-level types stay as PRD §6.2 defines them; aliases exist only on the wire.
  - `evidenceKind` rules: `explicit` and `paraphrase` need at least one verified quote; `inference` and `suggestion` may have none and must be labelled as such in the UI.
  - Validation is all-or-nothing: one unknown alias, failed quote, schema error or out-of-range count (more than three cards) rejects the whole response with a typed error. Nothing partial is shown.
  - Response text is rendered as text. Any Markdown renderer must not emit raw HTML, links to external hosts or images.
  - Use a maintained schema-validation library, pinned exactly, or hand-written guards if the ADR justifies avoiding the dependency.
- **State of the world:** The gateway passes loosely typed objects to the fake provider.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0008, schemas, manifest builder and validator
- [ ] Adversarial fixtures: unknown alias, alias from a different request, quote not in source, quote from the wrong entry, four cards, missing field, extra instruction-like fields, HTML and script payloads
- [ ] Property test: any response whose quotes are true substrings of the manifest validates; any mutated quote fails
- [ ] The fake provider updated to emit contract-valid responses
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Test that should pass after this issue lands**
```ts
it("rejects a citation to an entry that was not sent (AI-012, AC-07)", () => {
  const manifest = buildManifest([entryA]);                 // only E1 exists
  const response = answer({ citations: [{ alias: "E2", quote: "anything" }] });
  expect(() => ground(response, manifest)).toThrow(UngroundedCitationError);
});
it("rejects a quote that is not in the cited entry", () => {
  const response = answer({ citations: [{ alias: "E1", quote: "words never written" }] });
  expect(() => ground(response, buildManifest([entryA]))).toThrow(UngroundedCitationError);
});
```

## Constraints

**Scope fence:** No prompt text for Reflect or cards (epics 06 and 07) and no provider code. Do not relax all-or-nothing validation to salvage partial output. If you find yourself touching files well
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
- [ ] PR body includes `Refs #EPIC_05_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `ai`
