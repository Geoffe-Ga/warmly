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
| Cloud database compromise | Client-side encryption; server holds ciphertext | Planned: #17, #25 |
| Backend or operator curiosity | Same, plus logs that cannot contain request content | Logging: **in place** (this issue) |
| Cross-account access | Owner-only API checks and database policies | Planned: #15, #18, #38 |
| Stolen session token | Every request also signed by a device key | Planned: #21 |
| Stolen locked device | Root key wrapped at rest; inactivity lock | Planned: #20 |
| Offline edit conflicts | Compare-and-swap; both versions kept | Planned: #33, #36 |
| Revoked device reconnecting | Device check on every request | Planned: #23 |
| Stale data resurrecting deletions | Permanent tombstones and a deletion ledger | Planned: #37, #65 |
| Compromised dependency | Few runtime dependencies, exact pins, hashed Python requirements, dependency audit in CI, strict CSP | **In place** |
| Cross-site scripting | Framework escapes text; CSP forbids inline and evaluated code | **In place** (this issue) |
| Logs leaking secrets | Closed log schema; no bodies, headers, paths or query strings | **In place** (this issue) |
| Data sent to unexpected hosts | CSP `connect-src` allowlist; test egress guards | **In place** (this issue) |
| Oversized or abusive requests | Request body cap | **In place**; rate limits planned: #38 |
| Prompt injection in journal text | Evidence framing; citation grounding | Planned: #43, #52 |

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
at all. A build with a `VITE_API_ORIGIN` or `VITE_AUTH_ORIGIN` that is not an
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
  their sizes and when they change.
- **Backups.** Deleted ciphertext remains in rolling backups until they expire.

## What the automated tests do and do not show

The tests show that the application's own controls behave as described: the
headers are sent, the browser enforces the policy, logs stay within their
schema, and oversized requests are refused. They do not prove the absence of
vulnerabilities, they do not exercise a real production host, and they say
nothing about the security of dependencies beyond known advisories.
