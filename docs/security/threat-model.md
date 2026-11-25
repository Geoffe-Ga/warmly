# Threat model

- **Status:** first version, written with the security baseline (issue #14).
- **Source:** PRD §4.1 [SEC-001] and §4.2 [SEC-002..010].
- **Rule for editing:** describe controls that exist and are tested. A planned
  control is listed as planned, with the issue that will add it.

## What Warmly protects

A person's private writing about their relationship: journal entries, feelings,
Reflect sessions, conversation cards, and the AI provider key they supply.

The design goal is that the service operator cannot read any of it. Content is
encrypted on the user's device and the backend stores ciphertext only.

## Trust boundaries

| Zone | Trusted with plaintext? | Notes |
| --- | --- | --- |
| The user's unlocked browser | Yes | The only place plaintext exists. |
| Warmly API (FastAPI) | No | Stores and relays opaque ciphertext. |
| Supabase Auth and PostgreSQL | No | Identity and ciphertext rows. |
| Static host and CDN | No, but it serves the code | See "malicious served JavaScript". |
| The user's chosen AI provider | Yes, for what the user sends | Only after an explicit, disclosed action. |
| Logs, URLs, caches, analytics | No | Must never contain plaintext. |

## Threats and controls

| Threat (PRD SEC-001) | Control | Status |
| --- | --- | --- |
| Cloud database compromise | Client-side encryption; server holds ciphertext | Envelope **in place** (ADR-0003). The client sends envelopes only, and the sync protocol carries no content or content hash (ADR-0006); the server stores the payload text as sent and never decodes it, and returns it only to a signed request from one of the owner's devices |
| Someone reading the browser's storage on a locked or stolen device | Records are stored only as envelopes; the database holds IDs, type numbers and revisions but no content, hash or index; decrypted records live in memory only while unlocked. Drafts are records like any other. The database name shows the account ID, and until sync exists the browser may evict the data (ADR-0014) | **In place** |
| Backend or operator curiosity | Same, plus logs that cannot contain request content | Logging: **in place** (this issue) |
| Cross-account access | Owner taken only from a verified token ([authentication](authentication.md)); owner-only database policies (ADR-0002); every signed-in route attacked by a second account in seven ways against a real database ([isolation test matrix](isolation-test-matrix.md)) | **In place**. A new route with no row in the matrix fails the suite. What the suite does not prove is listed in the matrix |
| Stolen session token | The auth library keeps the session in `localStorage`; strict CSP limits what script could read it; the token decrypts nothing by itself. Every request behind the token is also signed by a device key that cannot be copied off the device, and a new device can register only by proving it holds the root key (ADR-0005) | **In place** |
| Lost devices, or a forgotten password | Personal recovery key wraps the root key; the server holds only the wrapped copy; a password reset changes no keys (ADR-0003) | **In place** |
| Stolen locked device | Root key stored wrapped twice, by a non-extractable device key and by a device passphrase (ADR-0004); 30-minute inactivity lock. A weak device passphrase is the weak point: PBKDF2 slows guessing but does not stop it | **In place**; passkey unlock planned: #80 |
| Server or token holder intercepting a new device's pairing | Commit-then-reveal exchange, a six-digit code the person types into the approving device, one guess per request, HPKE transfer bound to the transcript, re-authentication on the approving device (ADR-0005) | **In place** |
| Server planting a key of its own on a new device | The approving device sends a random confirmation code inside the encrypted transfer and shows it; the new device keeps the key only when the person types that code (ADR-0005) | **In place** |
| Offline edit conflicts | Compare-and-swap on the record's revision; the server never picks a winner; a refused device keeps its own version and shows "Needs your attention" (ADR-0006) | Client **in place**; server: #33; resolving both versions: #36 |
| Revoked device reconnecting | The device is looked up, and refused if revoked, on every signed request; a revocation is permanent and written to an append-only ledger; revoking needs a device signature and a freshly entered password (ADR-0005) | **In place** |
| Replayed or altered request | The signature covers the method, path, body hash, a timestamp and a nonce; stale timestamps and reused nonces are refused (ADR-0005) | **In place** |
| Stale data resurrecting deletions | Permanent tombstones and a deletion ledger | Planned: #37, #65 |
| Compromised dependency | Few runtime dependencies, exact pins, hashed Python requirements, dependency audit in CI, strict CSP | **In place** |
| Cross-site scripting | Framework escapes text; CSP forbids inline and evaluated code | **In place** (this issue) |
| Logs leaking secrets | Closed log schema; no bodies, headers, paths or query strings | **In place** (this issue) |
| Journal text sent to an AI provider without the person's say-so | One gateway (`src/ai/gateway.ts`) is the only code that can call a provider, and it needs a consent token for the very request being sent. A token is made only by the confirm button of the disclosure dialog, works once, and is tied to a request that is frozen once shown, so what is agreed to is what is sent. No retry, no second provider, no timer. An answer is used only after it has been checked against what was sent (ADR-0008) | **In place** in the client; enforced by a lint rule and a source-reading test. No real provider is connected yet (#41) |
| Data sent to unexpected hosts | CSP `connect-src` allowlist; test egress guards | **In place** (this issue) |
| Oversized or abusive requests | Request body cap; per-account and per-device request limits, counted in the database so they hold across instances (`warmly/api/rate_limit.py`) | **In place** for signed-in requests. Requests with no valid token are refused before they are counted and must be limited at the hosting edge (#61). If the counter cannot be written the request fails (500) rather than going uncounted: this is deliberate. Windows are fixed, so a burst across a boundary can reach about twice the limit |
| Prompt injection in journal text | Evidence framing; citation grounding | Planned: #43, #52 |

## Known windows

- **Same-origin script and the device passphrase.** Script running in the
  app's origin can use the non-extractable device key and then guess the
  device passphrase offline, bypassing the five-attempt limit on the lock
  screen (ADR-0004). The CSP is the control; a long passphrase is the
  backstop.

- **Reading the recovery envelope needs only the session.** A new device
  must read it before it can hold the root key, so that one request cannot
  be device-signed. What it returns is useless without the 256-bit recovery
  key. Replacing the envelope does need a registered device's signature
  (ADR-0005).
- **The server holds the device-enrollment verifier.** Someone who can read
  the database and also holds a valid session token could register a device
  of their own. They would hold no decryption key (ADR-0005). Replacing the
  verifier with a public key is tracked in #84.
- **The first recovery envelope is created without a device signature.** No
  device can exist before it. A session token stolen between sign-up and
  the user confirming their recovery key could create the envelope and its
  verifier first, and then register a device. The real user's own attempt
  would be refused at once, and the account holds nothing yet (ADR-0005).
- **Approving a device you do not hold.** Pairing checks that two devices
  are talking to each other. It cannot check that the new device is yours.
  Someone who persuades you to type their code into your unlocked device,
  and to enter your passphrase, gets your journal. The screens warn about
  this (ADR-0005).
- **Same-origin script can ask the browser to sign.** The device key cannot
  be copied, but script running in the app's origin can use it while it runs
  there. The CSP is the control.
- **Replacing the recovery key does not rotate the root key.** An old
  recovery key together with an old copy of the envelope still opens the
  root key (ADR-0003).

- **A signed-out or revoked session's access token** stays valid until it
  expires, because the API verifies tokens without calling the auth provider.
  The token decrypts nothing by itself, and since ADR-0005 it is not enough
  to call a signed route. A revoked device is cut off at its next request
  (ADR-0005).

## Controls added by the security baseline

### Content Security Policy and headers (frontend)

One definition, `config/security-headers.ts`, feeds the preview server, the
`<meta>` tag embedded at build time, and the tests. The policy starts from
`default-src 'none'`. Scripts and styles load from the app's own origin, with
no inline code and no `eval`. `connect-src` is an explicit allowlist of exact
`https` origins; wildcards are rejected. AI provider hosts are absent until
the AI gateway adds them.

The policy is delivered twice on purpose. The header is authoritative and is
the only place `frame-ancestors` works. The `<meta>` tag travels inside
`index.html`, so the page keeps a policy even on a host that sends no headers
at all. A build with a `VITE_API_ORIGIN` or `VITE_SUPABASE_URL` that is not an
exact `https` origin fails, so a typo cannot quietly widen the policy.

The production host must send the same headers. Until the deploy pipeline
exists (#61), only the preview server is verified.

### API response headers and limits (backend)

Every API response, including errors, carries a deny-all CSP, `nosniff`,
`no-store` and related headers. Request bodies over 8 MiB are refused with a
413 before parsing, whether or not `Content-Length` is honest.

### Logs that cannot hold content

`warmly/logs.py` defines a closed set of request-log fields: event name, an
opaque event ID, method, route template, status and duration. There is no
body, header, query string, concrete path, client address or account
identifier, and exception text is never logged. The event ID is returned in
the `Warmly-Event-Id` header so a user can report a problem without revealing
anything. Uvicorn's access log is disabled because it records full paths.

### Egress guards in tests

- **Unit tests:** `fetch`, `XMLHttpRequest`, `WebSocket` and `sendBeacon`
  throw. A test that needs a response supplies its own double.
- **Browser tests:** every spec uses `e2e/fixtures/test.ts`, which aborts and
  fails on any request to a host other than the app under test, and fails on
  any CSP violation. ESLint forbids importing Playwright's `test` directly.

These guards are how the "no automatic AI call" requirement (AC-03) is
enforced: a test does not need to look for a provider, because no unexpected
host can be reached.

## Residual risks we do not solve

State these plainly to users; never promise absolute secrecy.

- **A compromised or unlocked device, or a malicious browser extension,** can
  read everything the user can.
- **Malicious served JavaScript.** Whoever controls the static host or the
  build can ship code that exfiltrates plaintext. CSP narrows where it could
  send data but cannot prevent this.
- **AI provider processing.** Text the user chooses to send is handled under
  the provider's terms. Bring-your-own-key does not guarantee zero retention,
  and a key held in browser memory is not in a secure enclave.
- **Screen sharing, printing and shoulder surfing.**
- **Offline copies after revocation.** A revoked device keeps what it already
  has; remote wipe is not promised.
- **Metadata.** The server can see account identity, how many records exist,
  their sizes and when they change. Records are not padded, so ciphertext
  length reveals plaintext length.
- **Backups.** Deleted ciphertext remains in rolling backups until they expire.

## What the automated tests do and do not show

The tests show that the application's own controls behave as described: the
headers are sent, the browser enforces the policy, logs stay within their
schema, and oversized requests are refused. They do not prove the absence of
vulnerabilities, they do not exercise a real production host, and they say
nothing about the security of dependencies beyond known advisories.
