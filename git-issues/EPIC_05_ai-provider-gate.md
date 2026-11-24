<!-- EPIC_05 | title: epic: AI provider layer and the BYOK compatibility gate -->

## Epic Summary

Build the only path by which plaintext may leave the device: a single AI gateway that requires an explicit, disclosed user action, validates every response as untrusted, never retries or falls back, and talks to OpenAI or Anthropic with the user's own key. It includes the release-blocking provider compatibility and security review. Covers PRD §12 step 5, §4.2 [SEC-008..010] and §6 [AI-001..018].

## Scope

**In scope:**
- `AIProvider` interface, fake provider, the gateway and the consent dialog
- Provider compatibility and security report with ADR-0007
- Encrypted, synced provider credentials
- Data contracts and the grounding validator (ADR-0008)
- OpenAI and Anthropic adapters
- Failure, cancellation, cost limits and explicit Retry

**Out of scope:**
- The Reflect and card features that call the gateway (epics 06 and 07)
- Any backend involvement in AI traffic; a FastAPI proxy is forbidden
- A user-facing model picker, local models or embeddings (PRD §2.2)

## Success Criteria

The epic is done when:

- [ ] ADR-0007 states, per provider, whether direct browser access is acceptable under the threat model, or reports a release blocker
- [ ] A saved provider key syncs between one user's devices and is never visible to the server or in logs (AC-22)
- [ ] A response citing an entry that was not sent, or quoting text that is not in the entry, is rejected (AC-07, AC-26)
- [ ] A failed call preserves user state and waits for an explicit Retry; nothing calls another provider (AC-15)
- [ ] Lint, CSP and tests all enforce that only the gateway can reach a provider host
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E05_I01_NUMBER — Skeleton: feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog
- [ ] #E05_I02_NUMBER — Core: docs(ai): run the browser BYOK compatibility and security review and record ADR-0007
- [ ] #E05_I03_NUMBER — Core: feat(ai): store provider credentials encrypted and sync them between the user's devices
- [ ] #E05_I04_NUMBER — Core: feat(ai): define the AI data contracts and the grounding validator
- [ ] #E05_I05_NUMBER — Core: feat(ai): implement the OpenAI adapter behind the gateway
- [ ] #E05_I06_NUMBER — Core: feat(ai): implement the Anthropic adapter behind the gateway
- [ ] #E05_I07_NUMBER — Edges: feat(ai): handle failure, cancellation and cost limits with explicit Retry only

## Sequencing Notes

**Blocked by:** epic 02 for everything; I03 also needs epic 04 for sync. **Blocks:** epics 06 and 07. Per PRD §12, no AI feature may ship before the trust boundaries exist; I02 is a hard gate before I05 and I06.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 5, §4.2 [SEC-008..010], §6 [AI-001..018], §13.1, §13.8, §15. Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `ai`
