<!-- EPIC_02 | title: epic: Identity, keys and devices -->

## Epic Summary

Build the trust boundary everything else stands on: independent email/password accounts, a client-generated account root key, a personal recovery key, trusted-device unlock with manual and 30-minute inactivity lock, cryptographic device identity, device-to-device approval and revocation. Covers PRD §12 step 2, §4.2 [SEC-002..006] and §4.3 [DEV-001..010].

## Scope

**In scope:**
- Account state machine and onboarding, sign-in and lock screens
- Key hierarchy, the versioned record envelope and encrypted fixtures
- Supabase Auth integration and backend JWT verification
- Recovery key creation, confirmation, recovery on a fresh device and rotation
- Trusted-device unlock, manual lock and inactivity lock
- Device registration, per-request device proof, Manage Devices, pairing and revocation

**Out of scope:**
- Encrypting journal records at rest and syncing them (epics 03 and 04)
- AI credentials (epic 05)
- Partner linking of any kind (excluded from the MVP)

## Success Criteria

The epic is done when:

- [ ] A new user can register, verify their email, save and confirm a recovery key, and reach an unlocked Home (AC-01, journal part lands in epic 03)
- [ ] A fresh device recovers with the recovery key; a password reset alone decrypts nothing (AC-18)
- [ ] An unlocked device approves a new one with a human-verified code; a spoofed enrollment fails (AC-19)
- [ ] A revoked device is rejected by the server on its next request, even with a valid JWT (AC-20)
- [ ] The app locks after 30 minutes of inactivity and on demand (AC-21)
- [ ] All child issues are closed
- [ ] `./scripts/check-all.sh` and `./scripts/e2e.sh` pass on `main`

## Child Issues

Work them in this order. Each child lists its own predecessors.

- [ ] #E02_I01_NUMBER — Skeleton: feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes
- [ ] #E02_I02_NUMBER — Core: feat(crypto): implement the key hierarchy and versioned record envelope
- [ ] #E02_I03_NUMBER — Core: feat(auth): integrate Supabase Auth and verify JWTs in FastAPI
- [ ] #E02_I04_NUMBER — Core: feat(crypto): create, confirm, use and rotate the personal recovery key
- [ ] #E02_I05_NUMBER — Core: feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock
- [ ] #E02_I06_NUMBER — Core: feat(devices): register device identities, sign every request and build Manage Devices
- [ ] #E02_I07_NUMBER — Core: feat(devices): approve a new device from an unlocked one with verified pairing
- [ ] #E02_I08_NUMBER — Edges: feat(devices): revoke a device and handle rejection on the revoked client

## Sequencing Notes

**Blocked by:** epic 01. **Blocks:** epics 03 to 08. Inside the epic, I02 and I03 are parallel-safe after I01; I06 to I08 are strictly ordered.

## SPEC Reference

`docs/plans/relationship_communication_agent_prd.md` §12 step 2, §4.1, §4.2 [SEC-002..006], §4.3 [DEV-001..010], §7 (Device, DeviceEnrollment, RecoveryEnvelope). Design decisions made during decomposition are
recorded in `git-issues/2026-11-24_SPEC_summary.md`.

## Labels

`epic`, `spec-decomposition`, `identity`
