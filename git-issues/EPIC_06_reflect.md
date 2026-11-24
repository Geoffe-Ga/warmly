<!-- EPIC_06 | title: epic: Reflect: source-linked answers about your own history -->

## Epic Summary

Let a user ask their own question about their own journal and get a conversational answer whose claims link to the exact passages they wrote, inside private sessions they can resume, finish or delete, with AI output removed locally the moment a source entry changes. Covers PRD §12 step 6, §3.3 [RF-001..013], §5.3 [DEP-001..008] and §6.3 [AI-013].

## Scope

**In scope:**
- Reflect landing and session screens
- Encrypted session and message records with the active/finished lifecycle
- Deterministic context selection within a token budget (ADR-0009)
- The ask and follow-up flow with the Reflect prompt policy and rendered citations
- The dependency invalidation engine (ADR-0010)
- Policy guardrails, injection defences and non-therapy boundaries

**Out of scope:**
- Card generation and card invalidation rules (epic 07)
- Canned guided questions, cross-session memory, summaries on finish, vector search (PRD §2.2, §3.3)
- Crisis detection or monitoring of any kind

## Success Criteria

The epic is done when:

- [ ] A user asks a question, confirms the disclosure and receives prose with citations that open the right entries (AC-07, AC-26)
- [ ] Follow-ups use only the current session; a new session starts from journals alone; Finish makes a session read-only (AC-08)
- [ ] A large journal is truncated deterministically and the answer discloses what was left out (AC-09)
- [ ] Editing or deleting a cited entry deletes the dependent session on every device without any AI call (AC-12)
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E06_I01_NUMBER — Skeleton: feat(reflect): wire the Reflect landing and session screens to the fake provider
- [ ] #E06_I02_NUMBER — Core: feat(reflect): persist sessions with resume, Finish Reflection and delete
- [ ] #E06_I03_NUMBER — Core: feat(reflect): select journal context deterministically within the token budget
- [ ] #E06_I04_NUMBER — Core: feat(reflect): answer questions with grounded, cited prose and session-only follow-ups
- [ ] #E06_I05_NUMBER — Core: feat(deps): delete dependent Reflect sessions locally when a source entry changes
- [ ] #E06_I06_NUMBER — Edges: feat(reflect): add policy guardrail tests, injection defences and non-therapy boundaries

## Sequencing Notes

**Blocked by:** epic 05 (gateway, contracts, at least one adapter) and epic 04 (deletes must converge). **Blocks:** epic 07's ownership issue, which extends the invalidation engine built here in I05.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 6, §3.3 [RF-001..013], §5.3 [DEP-001..008], §6.3 [AI-013], §13.5, §13.7. Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `reflect`
