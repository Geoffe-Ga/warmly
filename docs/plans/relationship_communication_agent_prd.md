# Private Relationship Journal & Conversation Aid — Agent-Ready PRD

**Status:** Implementation specification (MVP)
**Version:** 1.0 — 2026-11-23
**Audience:** Autonomous implementation and verification agents
**Primary users:** Two adults using **completely independent** accounts. The system does **not** link partners, share household data, or enable in-app collaboration in the MVP.
**Document purpose:** Decompose into implementable work and acceptance tests. This is **not** an epic/issue backlog.

## 0. Normative interpretation and implementation rules

- **MUST / MUST NOT**: non-negotiable MVP behavior; tests are required. **SHOULD**: strong preference with documented reason if changed. **MAY**: discretionary implementation detail.
- Prioritize user safety and data confidentiality over analytical richness, convenience, or feature completeness.
- Never infer or fabricate a user's partner's feelings, motives, diagnosis, attachment style, or internal state. AI is a fallible communication and memory aid, **not** a therapist, relationship judge, medical service, crisis monitor, or source of factual certainty.
- Do not add partner sharing, social features, scorekeeping, streaks, notifications, automated AI analysis, voice recording, or unapproved AI forwarding to the MVP.
- If a hard security acceptance criterion cannot be satisfied by the chosen platform/vendor, **block production deployment** and report a clearly scoped blocker. Do not weaken the criterion or silently introduce a plaintext application-server proxy.
- Resolve lower-level engineering choices using standard, maintained libraries, explicit ADRs, and the security invariants here; do not reopen approved product decisions. Any unavoidable contradiction is an implementation blocker, not permission to guess away a privacy guarantee.
- Implement features in dependency order, but create issues/epics separately in the downstream loop.

## 1. Product, audience, and outcomes

### 1.1 Product statement

An intentionally private, warm, journal-like PWA for personal relationship reflection and preparation for calm, constructive face-to-face conversations. Users record experiences across time, ask questions about their own relationship history, and create teachable, editable conversation flashcards. No partner's account sees another's writing.

### 1.2 Problem

A person's momentary emotional state and memory limitations can make it difficult to maintain a balanced, coherent understanding of a relationship. People can struggle to notice positive change, remember evidence of support, express difficult needs without blame, or articulate a request in a way that invites dialogue. This product preserves the person's own record and presents AI-assisted **hypotheses**, grounded in that record, when explicitly requested.

### 1.3 Success, without relationship scoring

- Users can regularly complete structured journals without AI or network access.
- Users can inspect their own history and get source-linked answers to their own questions.
- Users can turn selected experiences into up to three thematic communication cards and read them aloud from a phone/laptop or print them.
- Users understand, edit, reject, and replace AI suggestions without losing their own authored work.
- Cross-account access is technically prevented; server operators do not receive journal plaintext in normal operations.
- Users retain access across authorized devices, recover from lost devices using a recovery key, and can revoke access.
- No numerical relationship-health score, automated relationship verdict, or engagement streak is introduced.

## 2. Scope

### 2.1 Included in MVP

- Responsive installable PWA, warm pink/coral **light theme only**, phone and laptop support.
- Email/password accounts; email verification and password reset; independent identities.
- Client-side end-to-end encryption of private app content and AI credentials; managed cloud synchronization and personal recovery key.
- Offline text journaling, drafts, manual edit, explicit permanent delete, encrypted sync and manual conflict resolution.
- Three required journaling questions and optional simple emotional check-in.
- Chronological journal timeline, ordinary local text search, saved private Reflect sessions.
- On-demand Reflect: user-authored question, conversational answer with attributable journal citations, follow-ups inside session, manual Finish Reflection, read-only finished sessions, indefinite unfinished sessions.
- On-demand card preparation from **explicitly selected entries**: AI groups into **up to three** themes; app supports fully editable cards, segment-level learning explanations and source provenance, user-requested alternatives, and unlimited manually written cards.
- Private named collections, card ordering, distraction-free one-at-a-time presentation, printable view, private optional short post-conversation reflection.
- OpenAI and Anthropic individual BYOK; app-selected tested default model per provider; secure credential synchronization between user's own authorized devices.
- Manage Devices, individual revocation, trusted-device unlock, manual lock, 30-minute inactivity lock.
- Development and production only; managed hosting; automated deployment/rollback gates; encrypted cloud backup retention **30 days**; automated WCAG checks.

### 2.2 Explicitly excluded or deferred

- Household linking, partner profiles, shared accounts, shared agendas, cross-partner journal analysis, in-app journal/card sharing, partner invitations.
- Voice recording, voice transcription, audio upload.
- Local/on-device AI models; advanced historical indexing, vector search, long-term weighting/recency modeling, all-time pattern inference beyond context limit.
- Communication-style spellchecker after free editing; manual comprehensive accessibility verification and dark theme.
- User self-service export/import; formal agreement tracking, discussed-card state, presentation analytics, cross-session AI memory.
- Push reminders, streaks, gamification, relationship assessments, diagnosis, therapist dashboards, couple scoring.

## 3. User experience and information architecture

### 3.1 Home [UX-001]

After unlock, show precisely three primary actions: **Journal**, **Reflect**, **Prepare for a Conversation**. Secondary navigation: saved collections, account/settings, Manage Devices. No unsolicited summaries, judgments, scores, or AI calls.

### 3.2 Journal [JR-001..010]

- Each new session displays three prompts in order, with text input for each:
  1. **What's going well?**
  2. **What would you like to improve?**
  3. **Since your last journal entry, how has your partner helped you feel loved?**
- Completion requires non-whitespace text in **all three** inputs. Explicit text like "Nothing comes to mind this week" counts. Explain this in UI. **Do not provide a one-tap Skip control.** Never require the user to manufacture positive or negative claims.
- Optional small self-reported emotional check-in (multiple simple feelings permitted; skip available). Do not infer mania/depression/clinical states from text; do not use mood to discredit experiences.
- Save draft at any stage, including offline. A draft is not a completed entry; draft auto-save MUST NOT invoke AI.
- On completion retain entry ID, author ID, authored date/time with timezone, original creation timestamp, latest modification timestamp, responses and optional self-reported feelings. Display created date in timeline.
- User may edit saved entries **in place**, preserving creation date, with no application revision history; pending offline edits persist until synchronized.
- User may delete an entry after explicit confirmation, with **no in-app trash**. Handle offline deletion and propagate tombstone to other devices; retained historical infrastructure backups are a documented limitation.
- A completed entry with an explicit "nothing" response MUST NOT be interpreted as proof that no positive/negative event occurred.
- No automatic AI request on create/edit/delete/open/search.
- Local text search is case-insensitive with reasonable token handling; results open the original entries. Offline timeline/search are usable with unlocked local data.

### 3.3 Reflect [RF-001..013]

- Reflect landing opens local timeline/search and previously saved Reflect sessions, with an explicit **Ask a question** control; never auto-start an AI call.
- User writes their **own** question. Do not replace this flow with canned guided questions in MVP.
- On submit, show provider, data disclosure summary, and scope; AI executes only following explicit user action. Follow-up submissions are independently user-initiated.
- Analyze **as much chronological journal history as fits a safe model-context budget**, after reserving tokens for policies, the current session, user question, output, and token estimation error. If entire history does not fit, select entries deterministically and transparently; prefer recent and relevant material while ensuring older coverage where practical. Never claim complete coverage if truncated.
- Show ordinary conversational prose, not a rigid evidence grid. Substantive assertions link to actual source entry IDs and exact supported excerpts/ranges. Present model inferences as hypotheses, acknowledge uncertainty/contradictions, and be alert to evidence of improvement, persistent issues, and changes in perspective.
- Use only the **current** Reflect session's exchanges for conversation memory. A new session begins from journals, not previous AI responses. Saved old sessions remain readable but are never silently injected into new sessions.
- Multiple sessions can remain open indefinitely. Leaving app/screen does not finish. `Finish Reflection` explicitly transitions `active -> finished` and makes the session read-only. No extra AI summary on finish. User may permanently delete a session.
- Saved sessions are private E2EE records. Cite links open only author's original journal entries.
- If source journal entries are modified or deleted, delete **dependent AI insights** (see dependency semantics) instead of displaying stale citations. Do not send AI requests to regenerate them.
- AI must not label the user's spouse with clinical conditions, judge who is right, minimize harmful behavior, or assume feelings stated by the AI are facts. Include clear non-therapy and non-crisis-service boundaries in onboarding/help; do not implement covert crisis analysis or monitoring.

### 3.4 Prepare for a Conversation [CC-001..016]

- User creates/opens a **private named collection** and explicitly selects **one or more private journal entries** for the generation action. No automatic entry selection and no cross-account retrieval.
- On `Generate`, present clear AI transmission disclosure and use only selected entries. Produce **one to three** coherent thematic cards, no invented filler to reach three. Combine related entries, preserve contradictions, distinct themes, and appreciation/evidence of change.
- Suggested card types may include appreciation, observation/feeling/need/request, and curiosity. A card must avoid asserting assumptions about the partner's intention as facts.
- AI output MUST be structured into segments rather than a plain undifferentiated paragraph. Each segment has category (observation, feeling, need, request, appreciation, curiosity, or other), generated text, provenance references, whether explicitly supported/paraphrased/inferred/suggested, and short communication-technique explanation.
- Learning mode: tappable/keyboard-activatable highlighted segments; opening one shows (a) supporting original user text or an explicit statement that it is inferred/suggested, (b) why that wording may aid communication, and (c) `Generate more options` that issues a **new explicitly requested** AI call. Explain that an I-statement states an experience, not that factual claims are automatically unchallengeable.
- Conversation mode: clean standalone reading text, no teaching annotations. User may fully rewrite any card and any segment, not merely choose AI alternatives. Do not apply an automatic communication-style spellchecker or block edits.
- **First substantive user edit** transitions an AI-generated card to **user-owned**. It remains fully editable and survives changes/deletions to its source journals, but invalidated AI-provenance highlights/citations/explanations are removed. If only non-substantive formatting change, treating it as user-owned is an acceptable conservative policy; define consistently and test.
- Unedited AI cards are deleted automatically when a dependency journal is edited/deleted; dependent Reflect AI responses are deleted according to the integrity policy below.
- Unlimited manual cards; no AI attribution needed, no AI call unless user chooses to request an operation. Cards may be reordered, deleted and edited within collections. Rename/delete collections with confirmation for destructive actions.
- Limit of three applies **per AI generation request only**, not total collection cards.
- **Dedicated presentation view**, one card at a time with large readable text, next/previous. It always opens at card one. Do **not** track cards viewed/discussed, time-on-card, progress, completion, or outcome. No automatic post-conversation flow.
- Print media styles output selected collection's readable card text, without private journal excerpts, teaching details, UI chrome, credentials, or unnecessary metadata. Printing is an explicit action and ordinary system print flow; no server PDF rendering.
- Cards and collections never sync into another user's account, even if partner happens to use the same app.

### 3.5 Optional post-conversation reflection [PC-001..004]

A separate private, intentional, lightweight form may be created after any conversation. Ask: **What went well? What felt difficult or unresolved? What would you like to remember?** It is optional, editable, E2EE, and eligible for personal timeline/search. Do not automatically initiate it on leaving presentation mode; no shared agreements or metrics. For MVP AI Reflect, include this type of entry only if its provenance/category is made clear; avoid falsely treating it as a response to the standard three journal prompts.

### 3.6 Settings, design, and accessibility [UI-001..008]

- Warm, journal-like **light-only** identity: coral approximately `#E35D7A`, blush `#FDE4E8`, soft pink `#F7A7B5`, paper `#FFF7F8`, dark ink `#2E2A2B`. These are design references **not guaranteed accessible text colors**; choose darker variants where WCAG contrast requires.
- Comfortable touch targets, generous spacing, uncluttered writing, readable cards across iPhone-like and laptop widths, high text zoom tolerance, reduced motion where feasible.
- A11y implementation target WCAG 2.2 AA; **automated CI checks required** (axe-core/Playwright), manual screen-reader/formal verification deferred and cannot be claimed completed.
- Clear encryption, AI-provider, offline, sync, key-recovery, deletion, and device-revocation status without revealing private plaintext on locked screens.

## 4. Security and privacy invariants

### 4.1 Threat model [SEC-001]

Protect against: cloud database compromise, backend/operator curiosity, authenticated cross-account read attempts, stolen tokens, stolen locked devices, accidental offline conflicts, revoked devices reconnecting, stale replicated data, compromised dependencies, logs leaking secrets, and malicious/jailbreak text inside journal content. Explicit residual risks: compromised/unlocked client or browser extension, malicious served JavaScript, provider-side processing of submitted text, screen sharing/printing, and offline device copies after remote revocation. No misleading promise of absolute secrecy.

### 4.2 Encryption and ownership [SEC-002..010]

- Generate a random per-account data encryption root key client-side; use vetted AEAD (e.g. AES-256-GCM) and cryptographically secure randomness. Use unique nonces with explicit nonce-management policy; authenticate records and metadata via AAD binding owner, record ID, type and format version. Version formats for migration.
- Derive recovery-key wrapping key using an established memory-hard password-based KDF when using human-enterable recovery codes, or use high-entropy generated secret and HKDF appropriately. Implement authenticated wrapping; never store raw root/recovery keys server-side. Auth login password must not itself grant decryption unless separately/unambiguously designed and tested.
- Encrypt journal bodies, mood selections, reflections, cards, provenance/excerpts, dependency indices, draft bodies, AI credentials, personal profile fields not needed for login, and other sensitive content **before sync**.
- Minimize server-visible metadata: account identity, opaque object ID, content-type category only if required, version/clock metadata, opaque encrypted payload, deletion marker, device identity/revocation. Do not store names, journal text, relationship themes, prompts, citations or searchable plaintext on backend.
- Server authorizes **owner-only** read/write at API and DB policies; test IDOR and client-supplied owner manipulation. Device authorization and session authentication are distinct.
- Search and provenance resolution happen locally after decryption. Do not send plaintext to FastAPI or Supabase; do not log it. Use strong CSP, dependency pinning, XSS prevention, dependency review and security headers. Avoid exposing secrets to service workers, analytics, URL/query strings, browser storage in plaintext, or logs.
- Trust boundaries of BYOK: **browser runtime is not a hardware enclave**. Direct OpenAI/Anthropic browser access may require dangerous SDK opt-ins and expose keys to compromised browser code; **do not call it secure by default**. Before production, run a provider-by-provider compatibility/security spike: documented browser support, CORS behavior, API-key scoping, privacy disclosures, observable client exposure, provider retention terms and risk acceptance. If secure enough for the stated threat model cannot be demonstrated, fail release and request explicit revision to architecture (e.g. desktop bridge/native client/user-managed proxy), never silently insert FastAPI plaintext AI proxy.
- AI requests occur **only** after an explicit user action, include only the selected/allowed plaintext context, and go to the **chosen provider**. No auto retry, no provider fallback, no auto indexing. Each user has an encrypted per-account provider API key synced across own authorized devices. No cross-account usage.
- Treat journal content passed to AI as **untrusted evidence**, not system instructions; defend against prompt injection, malicious markup and fabricated citation IDs; validate against a whitelist of source IDs/segments and schema.

### 4.3 Device enrollment, trusted sessions, revocation [DEV-001..010]

- New device first authenticates its account, then **either** (A) is approved from an existing unlocked authorized device using an authenticated, short-lived challenge and established secure key-transfer protocol with human-verifiable pairing, **or** (B) uses the user's recovery key to unwrap encrypted root material. Never transmit root key as server-readable plaintext.
- Device receives a unique registered ID and cryptographic device identity, visible in **Manage Devices** with user-editable descriptive name, creation time, last successful sync, current-device indicator, and revocation action.
- Revocation requires confirmation and verified account authentication, immediately invalidates that device's server synchronization access, and revokes/rotates access tokens as applicable; revoked device cannot rejoin without explicit authorization. Device-specific authorization MUST be validated server-side on every sync operation, not only in the client UI.
- If a revoked device is offline, it may retain copies of local encrypted records and potentially unlocked data; remote wipe is NOT promised. Specify how revoked device notices/handles rejection upon reconnection.
- Trusted devices may retain unlock capability using browser-available protections; manual lock is always accessible. At **30 minutes of inactivity** app must hide private UI and clear in-memory decrypted secrets to the extent feasible. Lock transitions must not discard unsaved draft data. Define explicit unlocked/locked states and safe persistence; don't promise browser process-memory erasure.
- Password reset must not unlock encrypted records. Recovery key must be presented during onboarding with user confirmation of secure storage; if all trusted unlock methods and the recovery key are lost, data is unrecoverable. Recovery-key rotation must preserve previously encrypted records and restore ability; support lost/stolen-device procedure.
- Account settings MUST NOT reveal another user's device details or partner relationship.

## 5. Offline and encrypted synchronization

### 5.1 Local storage [SYNC-001]

IndexedDB holds encrypted-at-rest persisted records, operation queue, sync receipts, opaque record IDs and metadata needed for conflict detection. Secrets used for decryption must not be stored unprotected in localStorage. Service workers cache public app shell, **not journal plaintext**, and must not proxy plaintext into untrusted caches. Offline writing, timeline/search on locally available unlocked entries, card reading/editing and queued deletion must work.

### 5.2 Protocol [SYNC-002..011]

- FastAPI (Python) provides authenticated owner-scoped sync endpoints backed by managed PostgreSQL. Define `GET /v1/sync/changes?cursor`, `POST /v1/sync/operations` (idempotent batch), `GET /v1/devices`, `POST /v1/devices/{id}/revoke`, device onboarding endpoints, and health/readiness. Details may evolve through OpenAPI versioned contracts.
- Every encrypted record has opaque ID, owner ID, schema version, monotonic revision assigned atomically by backend, hash/ETag, tombstone flag, timestamps, payload. Upload operation includes base revision. Server performs conditional compare-and-swap, never last-write-wins for conflicts.
- If two devices edit the same record from one base revision, retain **both ciphertext variants** as an unresolved conflict until the user reviews them locally; choose one or manually merge to a new current revision, then purge temporary conflicting versions (subject to backup retention). Never overwrite silently.
- Editing and deleting conflict must be explicitly reconciled. A stale offline device must not resurrect deleted content after syncing. Keep server-side tombstones or durable deletion identifiers long enough for all authorized device states and backup restore; define compaction and safe old-device recovery.
- Track dependency invalidation using a **local encrypted dependency index** keyed to journal IDs and AI-generated output IDs. Journal change/delete triggers cascade removal of dependent unedited AI outputs without another AI request. A source edit must not auto-delete a manual or user-owned card.
- Cross-device deletion cascade must be convergent and durable after offline sync. Account ownership checks apply to conflicts and tombstones too.
- Idempotent retries of network synchronization are permitted (**not AI retries**) and must not double-create entries.
- Show status for unsynced changes and conflicts without revealing private text in notifications or logs.
- Test browser suspend, partial network loss, multi-device concurrent update, clock skew, stale base revision, offline delete, a revoked client and database restore.

### 5.3 Source dependency and stale AI output semantics [DEP-001..008]

- A generated card stores immutable (encrypted) provenance IDs and source content hashes plus an `ai_generated`/`user_owned` state.
- A generated Reflect message stores source IDs/hashes and the session/message dependency graph; deleting an affected message must not leave a follow-up pretending its predecessor exists. Conservative policy: delete the **entire dependent Reflect session** if any message depended on a changed/deleted journal entry (unless an explicitly tested minimal message/subtree cascade preserves conversation integrity). Prefer conservative cascade in MVP.
- Editing a journal entry (even though no revision history is kept) invalidates dependent output generated from previous content, as does deleting it. Invalidated unedited AI cards are deleted; user-owned cards survive but lose stale citations, AI teaching annotations and AI-sourced explanation text. User wording remains intact.
- First user edit transitions card to user-owned; manual cards always user-owned. Plaintext source excerpts must not linger in preserved card payload.
- All invalidations happen locally and sync as E2EE delete/tombstone operations; don't depend on server reading dependency graph.
- Keep no user-visible revision history. Transient unresolved conflicts and encrypted backup snapshots are the documented exceptions.

## 6. AI contracts and guardrails

### 6.1 Provider abstraction [AI-001..006]

Implement `AIProvider` interface with `reflect`, `generateCards`, `generateSegmentAlternatives`, `estimateTokens`, `capabilities`, `validateConfig`. Adapters for OpenAI and Anthropic; app selects a tested default model for each provider, no user model selector in MVP. Central client configuration holds model IDs and context budgets with compatibility tests. Network payloads never enter Python backend.

### 6.2 Data contracts [AI-007..012]

Use schema-validated structured output; reject malformed or ungrounded data. Suggested normalized types:

```ts
type SourceRef = { entryId: string; responseKey?: 'good'|'improve'|'loved'; start?: number; end?: number; sourceHash: string };
type CardSegment = {
  id: string;
  category: 'observation'|'feeling'|'need'|'request'|'appreciation'|'curiosity'|'other';
  text: string;
  evidence: SourceRef[];
  evidenceKind: 'explicit'|'paraphrase'|'inference'|'suggestion';
  teachingExplanation: string;
};
type GeneratedCard = { type: 'appreciation'|'need_request'|'curiosity'|'other'; theme: string; segments: CardSegment[]; sourceEntryIds: string[] };
type ReflectionAnswer = { markdown: string; citations: Array<{claimId:string; evidence:SourceRef[]}>; coverage:{includedEntryIds:string[]; omittedEntryCount:number; truncated:boolean} };
```

Exact fields can be refined in code with runtime schemas and tests, but evidence IDs and hashes MUST be validated against entries **actually supplied** in that AI request. Never invent supporting sources or silently cite changed text.

### 6.3 Reflection prompt policy [AI-013]

- Ground interpretations in supplied user writing; contextualize across time and notice positive growth or persistent concerns without a deterministic verdict.
- Do not say a journal entry is proof of an objective interpersonal fact. Avoid diagnosis, relationship ratings, mind-reading, dismissiveness, and pressure to reconcile or stay together.
- Use uncertainty and differentiated citations. For unsupported questions, state insufficient evidence.
- Distinguish self-reported emotion from AI inferred emotion and invitation to confirm.
- Present "broader perspective" without invalidating present needs or rationalizing mistreatment.
- Do not treat the journal as a clinical record or provide medical advice.

### 6.4 Failure, costs, and consent [AI-014..018]

- AI request fails, times out, violates output schema, loses network, lacks credential, or receives rate limit: preserve entire user operation state and previous outputs; display a clear error and explicit **Retry**. **No automatic AI retry and no silent cross-provider fallback**.
- Disclose that selected plaintext is transmitted to the configured third-party provider and may be subject to provider privacy/retention terms; BYOK does not guarantee provider zero retention. Show what category/scope is being sent. Confirm once per request using deliberate submit action and visible disclosure; do not bury it in onboarding alone.
- Limit cost exposure with token budgets, maximum output limits, UI disclosure when large history is included, request cancellation where supported, no automated background jobs.
- Only supported model capabilities/structured output methods may be used. Provider adapter must produce semantically equivalent app-level contracts.

## 7. Data model (logical)

Client plaintext domain (encrypted before sync), using stable UUIDv7 or UUIDv4 opaque record IDs:

- `AccountSettings`: per-user provider choice, encrypted credential refs, design preferences, sync settings.
- `Device`: opaque device ID, public key, approved/revoked state, last sync, display name (encrypt if sensitive).
- `JournalEntry`: `id`, `createdAt`, `entryDate`, `updatedAt`, `status(draft|complete)`, three response strings, optional feelings, content hash.
- `PostConversationReflection`: `id`, `createdAt`, optional three short response fields; never impersonates a standard journal entry.
- `ReflectSession`: `id`, `createdAt`, `updatedAt`, `state(active|finished)`, ordered `ReflectMessage` IDs; `finishedAt` optional.
- `ReflectMessage`: `role`, `text`, `citations`, `coverage`, dependency source IDs/hashes, generated-vs-user authorship.
- `CardCollection`: `id`, `name`, ordered card IDs, timestamps.
- `ConversationCard`: `id`, `collectionId`, `type`, `authorship(ai_generated|user_owned)`, ordered editable segments or plain text, dependency IDs/hashes, optional teaching info, timestamps.
- `Dependency`: parent source ID/hash -> derived result ID; local encrypted mapping (or deterministically reconstructable from encrypted record metadata).
- `SyncEnvelope`: owner, opaque record ID/type, encrypted payload, format version, server revision, conflict state, tombstone.
- `DeviceEnrollment`: authenticated expiring challenge, pairing/approval state, device identity proof; no plaintext root keys in server persistence.
- `RecoveryEnvelope`: encrypted/wrapped account root key and KDF parameters (nonsecret), no original recovery secret.

All server persistence of domain content is ciphertext, with strict owner authorization. Include versioned schema migrations and local IndexedDB migrations; deterministic migrations must be idempotent and backward-compatible when automated rollback depends on them.

## 8. API and operational boundaries

- Frontend talks to FastAPI for sync/device/account metadata and directly to Supabase Auth (or via narrowly scoped auth integration); minimize duplicated authentication surfaces.
- FastAPI authenticates JWTs, re-checks device authorization, applies per-account rate limits, performs atomic version checks, and writes ciphertext without inspecting payload.
- Supabase/PostgreSQL enforces row-level ownership or equivalent deny-by-default policies; service credentials never shipped to browser.
- Separate production and development projects/secrets/storage, **no staging**. Development uses synthetic fixtures and fake AI provider by default; real-provider smoke testing with isolated test keys only.
- Logs exclude sensitive plaintext, prompts, citations, API keys and recovery secrets; use opaque event IDs. No advertising or third-party behavioral analytics.
- PWA updates must account for mixed frontend versions and offline clients; reject incompatible sync schema and provide non-destructive upgrade path. Health checks verify availability, auth, and ciphertext round-trip with synthetic data.

## 9. Backup, retention, deletion [OPS-001..010]

- Managed encrypted cloud backups with **30-day rolling retention**; validate actual provider plan and backup capabilities before production. **Do not assume basic Supabase tiers support 30 days.** If required, provision independent encrypted backups under a managed service with rotation and tested restore. No plaintext journal exports in backend.
- Backups encrypted at rest in addition to journal-content E2EE; recovery requires user-owned root/recovery material.
- Permanent user deletion removes active data after explicit confirmation and synchronizes a durable tombstone. Historical ciphertext in rolling 30-day backups expires according to retention; UI privacy copy MUST accurately explain this distinction.
- Disaster recovery restore to a separate isolated target first, replay durable deletion/revocation ledgers, verify no deleted journal/content resurrects, test account isolation, then cut over. Preserve tombstones beyond 30 days or use independently retained deletion ledger so a 30-day-old backup cannot reintroduce deleted records. Protect deletion ledger without keeping private content.
- Define recovery time and point objectives during implementation; provide a restore runbook, regular automated or scripted restore test using synthetic data, and alerts on missed backups. No destructive rollback of production data.

## 10. CI/CD and autonomous release policy [REL-001..012]

- Merge to release branch triggers required lint/typecheck, pytest, Vitest, Playwright E2E, axe checks, auth isolation, crypto fixture interoperability, recovery, revocation, sync conflict/deletion, offline migration and source-invalidation tests.
- Dependency scanning, secret scanning and SAST are required; high/critical unresolved findings block deployment. Fail closed for absent/inconclusive checks. Agents cannot remove a failing test or weaken security policy simply to get green CI.
- All releases, including security-critical code, may deploy autonomously **only after enhanced automated security and data-compatibility gates pass**. No routine human approval checkpoint.
- Use versioned encrypted fixtures covering at least previous supported app schema and client versions; test key wrapping/rotation and old device reconnect scenarios before crypto-related changes.
- Production smoke checks following release. Auto-rollback code if previous release is data-compatible; if rollback unsafe or migration incompatible, **halt further deployment and require intervention**, retain data, report incident without secrets.
- Prefer expand/migrate/contract schema strategies, database backups verified before destructive migration, feature flags for risky behavior, and separate synthetic production smoke records.
- Dev and prod isolation is mandatory. Agents must not access production journals as test data.
- Release pipeline must verify operational backups and retention configuration, not merely assume the provider supplies them.

## 11. Acceptance criteria and end-to-end test scenarios

Each scenario must be represented in automated tests (unit/integration/E2E as appropriate):

1. **[AC-01]** New user can register, verify email, generate/store and confirm recovery key, unlock, and complete a three-question journal without connecting an AI provider.
2. **[AC-02]** Blank/whitespace answer prevents completion; explicit "nothing to report" text passes; journal draft stays available after offline app close/reopen.
3. **[AC-03]** No AI network call occurs for creating, editing, deleting, searching, opening journal/Reflect landing, or leaving a presentation.
4. **[AC-04]** Journal data remains ciphertext in API requests, backend logs, database rows, and backup fixtures; server cannot decrypt without user keys.
5. **[AC-05]** User A's authenticated client cannot list, decrypt, mutate, or discover User B's journals/cards, provider keys, device IDs or metadata by guessing identifiers or modifying requests.
6. **[AC-06]** Timeline and local search work offline; source entry links open the correct local entry.
7. **[AC-07]** Reflect asks user question, explicitly sends permitted context, returns grounded prose and citations. Injected/fabricated or mismatched source IDs are rejected.
8. **[AC-08]** Reflect can follow up, leave, resume after extended time; new session has no prior AI conversation context; Finish makes old session read-only.
9. **[AC-09]** Large journal truncates deterministically within context budget and discloses omitted coverage; response cannot assert complete history coverage.
10. **[AC-10]** Preparation uses only manually selected entries, groups related entries and returns 1–3 validated thematic cards, no filler or unrelated data.
11. **[AC-11]** Learning view each highlighted segment provides provenance, technique, inference status; manual segment alternatives require distinct explicit request.
12. **[AC-12]** Editing a generated card makes it user-owned; deleting/changing source journal deletes unedited dependent AI cards and dependent Reflect session(s), but preserves user-owned wording and removes invalid AI annotations.
13. **[AC-13]** Manual cards unlimited; private collections are named, reorderable, reusable, printable, and account-scoped.
14. **[AC-14]** Presentation starts at first card every time, displays one card with next/previous, and persists no discussed/visited/progress state.
15. **[AC-15]** A failed OpenAI or Anthropic request preserves the selected entries, drafts and cards; no retry occurs until user explicitly clicks Retry; no automatic fallback provider.
16. **[AC-16]** Two devices editing same entry offline receive both revisions and may choose either/merge; unrelated records synchronize, no silent overwrite.
17. **[AC-17]** Offline deleted record cannot be revived by stale device or restored 30-day-old backup; deletion cascades correctly.
18. **[AC-18]** Recovery key unlocks encrypted data on fresh device after login; password reset without key and without existing trusted device cannot decrypt it.
19. **[AC-19]** Already-unlocked authorized device may securely approve new device with authenticated pairing; unauthorized device cannot spoof enrollment.
20. **[AC-20]** Revoking device prevents further authenticated sync, including stale credentials; offline revocation caveat is disclosed; current-device revocation handled without exposing data.
21. **[AC-21]** Trusted session locks after 30 minutes inactivity and via Lock action; editing draft not lost; sensitive UI hidden when locked.
22. **[AC-22]** Encrypted provider credentials sync only among the same user's authorized devices; users may replace/delete credential; key never appears in logs.
23. **[AC-23]** Automated accessibility checks pass on home, journal, Reflect, collections, teaching, presentation, enrollment and device management; WCAG 2.2 AA target clearly distinct from deferred manual certification.
24. **[AC-24]** Production CI fails closed on security regression; health failure automatically reverts compatible code; incompatible rollback halts and preserves data.
25. **[AC-25]** Backup configuration provides verified 30-day window; synthetic restoration cannot resurrect prior deletions; no production content copied to development.
26. **[AC-26]** All citations map to existing, included author-owned source material; AI inferred emotion is labeled uncertain and user can edit card wording freely.
27. **[AC-27]** No user account can create household links or obtain another person's journal via an AI operation.
28. **[AC-28]** App operates on supported mobile Safari and a modern desktop browser, including PWA install, offline writing, wake/suspend, IndexedDB quota/errors and app update cases.

## 12. Recommended component boundaries and implementation sequence

1. **Foundation:** repo, tooling, local/prod config, typed frontend and FastAPI contract, CI, synthetic fixtures, automated accessibility baseline.
2. **Identity/security primitives:** auth, per-user crypto envelope, personal recovery key, device identity and pairing/revocation, secure storage and hard isolation tests.
3. **Offline journal:** three-question UI, optional mood, IndexedDB drafts, edit/delete/tombstones, timeline and basic local search.
4. **Synchronization:** encrypted record model, atomic revision API, cross-device sync, manual conflicts, deletion invariants and backup restoration tests.
5. **AI BYOK compatibility gate:** real browser API integration research/verification, user disclosure, encrypted credential sync, adapters and mocked integrations; block release if provider/security constraints unresolved.
6. **Reflect:** session lifecycle, context budgeting, source-linked responses, fail-safe AI calls, dependency invalidation.
7. **Cards:** manual collections/cards, AI thematic generation, segment pedagogy, alternatives and editing ownership, presentation and printing.
8. **Post-conversation reflection, polish and release hardening:** optional private post-conversation form, responsive pink design, performance, accessibility CI, restore rehearsal and production automation.

Work can be decomposed into epics/issues by the autonomous loop. Dependencies are intentional: don't ship AI features ahead of the trust boundaries, recovery, and invalidation infrastructure.

## 13. Open engineering decisions and mandatory verification gates

These are **not** invitations for agents to alter product goals. Resolve them through ADRs, test evidence and provider documentation; stop release when a mandatory invariant cannot be met.

1. **Browser BYOK safety:** Verify OpenAI/Anthropic browser connectivity, CORS, exposure, availability and user-facing consent per provider/model; browser JS cannot be a secret enclave. Select an implementation consistent with the threat model or escalate architecture conflict.
2. **Encrypted trusted unlock:** Specify a genuinely secure key wrapping/storage strategy in supported PWA browsers; do not claim perfect secure-enclave behavior in a browser.
3. **Multi-device approval protocol:** Choose a maintained authenticated cryptographic transfer flow and complete challenge/replay/security tests. Must never expose root material to server.
4. **Backup plan and pricing:** Supabase's default backup retention depends on plan; select suitable managed backup solution meeting 30-day bound and deletion-aware restore.
5. **Context selection:** Specify token budget, chronological truncation/relevance heuristic, coverage disclosure, and deterministic prompt inputs. Advanced indexing remains deferred.
6. **Local database migrations:** Handle offline clients with older schema/crypto formats; define supported compatibility window and fail closed.
7. **Dependency deletion policy:** Adopt conservative entire-session cascade on source invalidation unless finer-grained integrity is proved and user expectations remain intact.
8. **AI provider privacy:** Link to current provider terms/disclosures; BYOK means user is separately trusting the provider with submitted plaintext.
9. **Security validation limitations:** Automated security tests are strong gates, not proof of perfect confidentiality; don't misrepresent test coverage.

## 14. Documentation, runbooks and definition of done

A feature is done only when it has: typed contract, test coverage for success and failure, offline/privacy consequences assessed, user-facing errors and accessible states, no secrets/plaintext in logs, and updated docs. Provide architecture diagrams, key lifecycle and threat model, API OpenAPI specification, encrypted record schema, data retention/deletion flow, dependency-invalidating cascade, local development/CI instructions, provider compatibility report, backups/restore drill, incident response and rollback runbook, and a comprehensive machine-executable release checklist.

**Overall MVP done:** every mandatory acceptance criterion passes; live providers are verified against privacy constraints; two independently authorized test accounts cannot access each other's records; user can journal/reflect/prepare/print without unintended sharing; both offline conflict and loss/recovery paths are demonstrated; 30-day encrypted backups and production rollback gates are validated; production deployment is autonomous but fails closed on unsafe conditions.

## 15. Research and implementation references (checked 2026-11-23)

- OpenAI SDK browser use is disabled by default; enabling it exposes credentials to browser context: https://developers.openai.com/api/reference/typescript
- Anthropic browser API requires explicit dangerous direct browser access and can be disallowed for some organizations: https://platform.claude.com/docs/en/manage-claude/authentication
- Supabase backup retention varies by plan; confirm actual service capability and pricing: https://supabase.com/docs/guides/platform/backups

**Product decision precedence:** This document incorporates all confirmed user decisions through device management/revocation, including the latest overrides: app-selected model defaults; light-only pink/coral theme; automated (not manual) accessibility verification for MVP; independent accounts, not linked households. Voice and sophisticated old-history indexing are postponed.
