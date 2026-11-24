<!-- E08-I05 | title: feat(ops): verify 30-day encrypted backups and script a deletion-aware restore drill -->

## Role

You are a senior platform engineer (GitHub Actions, managed hosting, PostgreSQL operations) working in this repo.

## Goal

Guarantee a verified 30-day encrypted backup window and a scripted restore that goes to an isolated target, replays the deletion and revocation ledgers, and proves that no deleted record or revoked device comes back.

## Context

- **Parent epic:** #EPIC_08_NUMBER (Post-conversation reflection and release hardening)
- **Predecessor issue(s):** #E08_I01_NUMBER (E08-I01: feat(release): choose hosting and wire the dev and prod deploy pipeline end to end); #E04_I06_NUMBER (E04-I06: feat(sync): make deletion durable so stale devices cannot resurrect records). Each must be merged first.
- **SPEC section:** `docs/plans/relationship_communication_agent_prd.md` §9 [OPS-001..010], §10 [REL-008], §13.4
- **Acceptance criteria advanced:** AC-25, AC-17, AC-04
- **Files involved:**
  - `docs/adr/0012-backups-and-retention.md`: new ADR
  - `scripts/ops/backup-verify.py`: new: asserts retention and recency from the provider API
  - `scripts/ops/restore-drill.sh`: new
  - `docs/runbooks/restore.md`: new, with RTO and RPO
  - `.github/workflows/ops.yml`: new scheduled verification and drill
- **Prior decisions** (full register in `git-issues/2026-11-24_SPEC_summary.md`):
  - Do not assume the Supabase plan provides 30 days. ADR-0012 states the actual plan capability with evidence and, if it falls short, specifies an independent encrypted managed backup with rotation (OPS-001).
  - D-11: the deletion ledger and revocation ledger are exported to storage whose retention is **longer** than the backup window and independent of the database backups, so a 30-day-old backup can never outlive the record of a deletion. The ledgers contain IDs and timestamps only.
  - Restore order: restore into a separate isolated project; replay both ledgers; run the isolation suite and a no-resurrection check; only then cut over (OPS-004).
  - The drill runs on synthetic data: create, delete and revoke, take a backup, restore, replay, assert. It never copies production content into development (AC-25).
  - Backups are encrypted at rest by the provider in addition to the content being end-to-end encrypted; a scan of a backup fixture for plaintext canaries is part of the drill.
  - The release pipeline calls `backup-verify` and fails closed if the newest backup is too old or retention is under 30 days (REL-008).
- **State of the world:** Tombstones and both ledgers exist in the database. Nothing verifies or exercises backups.

## Output Format

Deliverable is a single PR containing:

- [ ] ADR-0012 with plan evidence, pricing and the chosen design
- [ ] Verification script wired into the release gate manifest
- [ ] Restore drill script, scheduled monthly, with an alert (failing workflow and issue) on a missed backup or failed drill
- [ ] Restore runbook with stated recovery time and recovery point objectives
- [ ] Tests written first (TDD), named after the behaviour and citing the PRD IDs above
- [ ] Docstrings / TSDoc for every new public symbol
- [ ] No drive-by changes unrelated to the goal

## Examples

**Drill assertion that should pass after this issue lands**
```python
def test_restored_backup_cannot_resurrect_deleted_records(drill):   # OPS-004, AC-17, AC-25
    drill.create("r-1"); drill.backup(); drill.delete("r-1")
    target = drill.restore_to_isolated()
    assert target.is_readable("r-1")          # the old backup still had it
    target.replay_ledgers()
    assert not target.is_readable("r-1")
    assert target.tombstone("r-1").exists
```

## Constraints

**Scope fence:** Never restore over production in a drill. No user-facing export. No plaintext anywhere in backup tooling. If you find yourself touching files well
outside the list above, stop and check with the user.

**Needs a human:** Confirming the Supabase plan and any added backup cost, and granting the provider API credentials. An agent must not create accounts, enter payment details or handle live secrets. Do everything else, then stop and report exactly what the human must do.

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
- [ ] PR body includes `Refs #EPIC_08_NUMBER` and `Closes` this issue's number.
- [ ] CI is green and the Claude reviewer's latest `Verdict:` on HEAD is `LGTM`.

## Labels

`spec-decomposition`, `core`, `release`, `needs-human`
