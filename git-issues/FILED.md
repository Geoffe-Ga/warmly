# Filed issues

Filed on 2026-11-24 in `Geoffe-Ga/warmly`. Keys match `2026-11-24_SPEC_summary.md`.

| Key | Issue | Title |
| --- | --- | --- |
| EPIC 01 | [#3](https://github.com/Geoffe-Ga/warmly/issues/3) | epic: Foundation and walking skeleton |
| EPIC 02 | [#4](https://github.com/Geoffe-Ga/warmly/issues/4) | epic: Identity, keys and devices |
| EPIC 03 | [#5](https://github.com/Geoffe-Ga/warmly/issues/5) | epic: Offline journal |
| EPIC 04 | [#6](https://github.com/Geoffe-Ga/warmly/issues/6) | epic: Encrypted multi-device sync |
| EPIC 05 | [#7](https://github.com/Geoffe-Ga/warmly/issues/7) | epic: AI provider layer and the BYOK compatibility gate |
| EPIC 06 | [#8](https://github.com/Geoffe-Ga/warmly/issues/8) | epic: Reflect: source-linked answers about your own history |
| EPIC 07 | [#9](https://github.com/Geoffe-Ga/warmly/issues/9) | epic: Prepare for a Conversation: collections and cards |
| EPIC 08 | [#10](https://github.com/Geoffe-Ga/warmly/issues/10) | epic: Post-conversation reflection and release hardening |
| E01-I01 | [#11](https://github.com/Geoffe-Ga/warmly/issues/11) | feat(shell): adopt Preact and wire every MVP route to a placeholder screen |
| E01-I02 | [#12](https://github.com/Geoffe-Ga/warmly/issues/12) | feat(api): wire every /v1 route with typed stubs and a committed OpenAPI contract |
| E01-I03 | [#13](https://github.com/Geoffe-Ga/warmly/issues/13) | feat(ui): add light-theme design tokens and the accessible component kit |
| E01-I04 | [#14](https://github.com/Geoffe-Ga/warmly/issues/14) | feat(security): add CSP, security headers, log redaction and the network egress guard |
| E01-I05 | [#15](https://github.com/Geoffe-Ga/warmly/issues/15) | feat(db): add the dev database stack, migration runner and deny-by-default baseline |
| E02-I01 | [#16](https://github.com/Geoffe-Ga/warmly/issues/16) | feat(identity): wire the account state machine and onboarding, sign-in and lock screens with fakes |
| E02-I02 | [#17](https://github.com/Geoffe-Ga/warmly/issues/17) | feat(crypto): implement the key hierarchy and versioned record envelope |
| E02-I03 | [#18](https://github.com/Geoffe-Ga/warmly/issues/18) | feat(auth): integrate Supabase Auth and verify JWTs in FastAPI |
| E02-I04 | [#19](https://github.com/Geoffe-Ga/warmly/issues/19) | feat(crypto): create, confirm, use and rotate the personal recovery key |
| E02-I05 | [#20](https://github.com/Geoffe-Ga/warmly/issues/20) | feat(security): add trusted-device unlock, manual lock and the 30-minute inactivity lock |
| E02-I06 | [#21](https://github.com/Geoffe-Ga/warmly/issues/21) | feat(devices): register device identities, sign every request and build Manage Devices |
| E02-I07 | [#22](https://github.com/Geoffe-Ga/warmly/issues/22) | feat(devices): approve a new device from an unlocked one with verified pairing |
| E02-I08 | [#23](https://github.com/Geoffe-Ga/warmly/issues/23) | feat(devices): revoke a device and handle rejection on the revoked client |
| E03-I01 | [#24](https://github.com/Geoffe-Ga/warmly/issues/24) | feat(journal): wire compose, timeline, entry and search screens to an in-memory store |
| E03-I02 | [#25](https://github.com/Geoffe-Ga/warmly/issues/25) | feat(storage): persist records as ciphertext in IndexedDB with migrations and an outbox |
| E03-I03 | [#26](https://github.com/Geoffe-Ga/warmly/issues/26) | feat(journal): complete an entry with three required answers and an optional feelings check-in |
| E03-I04 | [#27](https://github.com/Geoffe-Ga/warmly/issues/27) | feat(journal): autosave drafts offline and keep them across close, reopen and lock |
| E03-I05 | [#28](https://github.com/Geoffe-Ga/warmly/issues/28) | feat(journal): show the chronological timeline and edit saved entries in place |
| E03-I06 | [#29](https://github.com/Geoffe-Ga/warmly/issues/29) | feat(journal): permanently delete an entry with confirmation and a local tombstone |
| E03-I07 | [#30](https://github.com/Geoffe-Ga/warmly/issues/30) | feat(journal): search entries locally, case-insensitively and offline |
| E03-I08 | [#31](https://github.com/Geoffe-Ga/warmly/issues/31) | feat(journal): handle storage errors, suspend and resume, and the installed offline app |
| E04-I01 | [#32](https://github.com/Geoffe-Ga/warmly/issues/32) | feat(sync): wire the client sync engine and status indicator against the stub API |
| E04-I02 | [#33](https://github.com/Geoffe-Ga/warmly/issues/33) | feat(sync): persist operations with atomic revisions, compare-and-swap and idempotency |
| E04-I03 | [#34](https://github.com/Geoffe-Ga/warmly/issues/34) | feat(sync): serve the owner-scoped change feed with a stable cursor |
| E04-I04 | [#35](https://github.com/Geoffe-Ga/warmly/issues/35) | feat(sync): drain the outbox and apply remote changes reliably on the client |
| E04-I05 | [#36](https://github.com/Geoffe-Ga/warmly/issues/36) | feat(sync): keep both conflicting versions and let the user resolve them locally |
| E04-I06 | [#37](https://github.com/Geoffe-Ga/warmly/issues/37) | feat(sync): make deletion durable so stale devices cannot resurrect records |
| E04-I07 | [#38](https://github.com/Geoffe-Ga/warmly/issues/38) | test(sync): prove cross-account isolation and ciphertext-only handling, and add rate limits |
| E04-I08 | [#39](https://github.com/Geoffe-Ga/warmly/issues/39) | feat(sync): negotiate schema versions and update the app without losing work |
| E05-I01 | [#40](https://github.com/Geoffe-Ga/warmly/issues/40) | feat(ai): wire the AIProvider interface, fake provider, gateway and consent dialog |
| E05-I02 | [#41](https://github.com/Geoffe-Ga/warmly/issues/41) | docs(ai): run the browser BYOK compatibility and security review and record ADR-0007 |
| E05-I03 | [#42](https://github.com/Geoffe-Ga/warmly/issues/42) | feat(ai): store provider credentials encrypted and sync them between the user's devices |
| E05-I04 | [#43](https://github.com/Geoffe-Ga/warmly/issues/43) | feat(ai): define the AI data contracts and the grounding validator |
| E05-I05 | [#44](https://github.com/Geoffe-Ga/warmly/issues/44) | feat(ai): implement the OpenAI adapter behind the gateway |
| E05-I06 | [#45](https://github.com/Geoffe-Ga/warmly/issues/45) | feat(ai): implement the Anthropic adapter behind the gateway |
| E05-I07 | [#46](https://github.com/Geoffe-Ga/warmly/issues/46) | feat(ai): handle failure, cancellation and cost limits with explicit Retry only |
| E06-I01 | [#47](https://github.com/Geoffe-Ga/warmly/issues/47) | feat(reflect): wire the Reflect landing and session screens to the fake provider |
| E06-I02 | [#48](https://github.com/Geoffe-Ga/warmly/issues/48) | feat(reflect): persist sessions with resume, Finish Reflection and delete |
| E06-I03 | [#49](https://github.com/Geoffe-Ga/warmly/issues/49) | feat(reflect): select journal context deterministically within the token budget |
| E06-I04 | [#50](https://github.com/Geoffe-Ga/warmly/issues/50) | feat(reflect): answer questions with grounded, cited prose and session-only follow-ups |
| E06-I05 | [#51](https://github.com/Geoffe-Ga/warmly/issues/51) | feat(deps): delete dependent Reflect sessions locally when a source entry changes |
| E06-I06 | [#52](https://github.com/Geoffe-Ga/warmly/issues/52) | feat(reflect): add policy guardrail tests, injection defences and non-therapy boundaries |
| E07-I01 | [#53](https://github.com/Geoffe-Ga/warmly/issues/53) | feat(cards): wire collections, card editor, presentation and print screens to in-memory data |
| E07-I02 | [#54](https://github.com/Geoffe-Ga/warmly/issues/54) | feat(cards): create, rename, reorder and delete collections and manual cards |
| E07-I03 | [#55](https://github.com/Geoffe-Ga/warmly/issues/55) | feat(cards): present one card at a time with no tracking |
| E07-I04 | [#56](https://github.com/Geoffe-Ga/warmly/issues/56) | feat(cards): print a collection as clean card text |
| E07-I05 | [#57](https://github.com/Geoffe-Ga/warmly/issues/57) | feat(cards): generate one to three thematic cards from explicitly selected entries |
| E07-I06 | [#58](https://github.com/Geoffe-Ga/warmly/issues/58) | feat(cards): add learning mode with segment provenance and technique explanations |
| E07-I07 | [#59](https://github.com/Geoffe-Ga/warmly/issues/59) | feat(cards): generate alternative wordings for a segment on explicit request |
| E07-I08 | [#60](https://github.com/Geoffe-Ga/warmly/issues/60) | feat(cards): make edited cards user-owned and apply card invalidation rules |
| E08-I01 | [#61](https://github.com/Geoffe-Ga/warmly/issues/61) | feat(release): choose hosting and wire the dev and prod deploy pipeline end to end |
| E08-I02 | [#62](https://github.com/Geoffe-Ga/warmly/issues/62) | feat(journal): add the optional post-conversation reflection |
| E08-I03 | [#63](https://github.com/Geoffe-Ga/warmly/issues/63) | feat(release): add fail-closed release gates for security and data compatibility |
| E08-I04 | [#64](https://github.com/Geoffe-Ga/warmly/issues/64) | feat(release): add production smoke checks with automatic rollback or halt |
| E08-I05 | [#65](https://github.com/Geoffe-Ga/warmly/issues/65) | feat(ops): verify 30-day encrypted backups and script a deletion-aware restore drill |
| E08-I06 | [#66](https://github.com/Geoffe-Ga/warmly/issues/66) | test(pwa): harden install, offline, suspend and update behaviour on both supported browsers |
| E08-I07 | [#67](https://github.com/Geoffe-Ga/warmly/issues/67) | feat(ui): complete the accessibility sweep and visual polish across every screen |
| E08-I08 | [#68](https://github.com/Geoffe-Ga/warmly/issues/68) | docs(release): complete the documentation set, traceability matrix and release checklist |
