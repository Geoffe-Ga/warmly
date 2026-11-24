# Authentication

- **Source:** PRD §2.1 (accounts), §8, §4.2 [SEC-006]; issue #18.
- **Scope:** who a request is from. What a user may decrypt is a separate
  question, answered by keys the server never sees (ADR-0003).

## The short version

1. The browser talks to Supabase Auth directly, using the auth-only client
   package. It registers, verifies the email address, signs in and resets
   passwords there. Warmly's API never receives a password.
2. Supabase Auth gives the browser a short-lived **access token** (a JWT) signed
   with the project's private key.
3. The browser sends that token to the Warmly API as
   `Authorization: Bearer <token>`.
4. The API checks the signature against the project's **public** keys and
   takes the owner from the token's `sub` claim. Nothing else in a request can
   name the owner.

A password proves identity only. It never derives or unlocks a key (PRD
DEV-006), and resetting it does not unlock a journal.

## What the API checks on every request

Every `/v1` route except `/v1/health` and `/v1/ready` requires a token.
`warmly/auth/verifier.py` refuses a token unless all of these hold:

| Check | Why |
| --- | --- |
| Algorithm is `ES256` or `RS256` | Only asymmetric signatures. `HS256` and `none` are never accepted, which rules out key-confusion attacks. |
| The `kid` names a key the provider publishes | The API never guesses which key to try. |
| The signature verifies | The token was issued by the provider and not altered. |
| `iss` equals `WARMLY_AUTH_ISSUER` exactly | A token from another project is worthless. |
| `aud` includes `WARMLY_AUTH_AUDIENCE` | Default `authenticated`. |
| `exp` and `iat` are present; not expired (30 s leeway) | Bounded lifetime. |
| `role` is `authenticated` and `is_anonymous` is not true | Service and anonymous tokens cannot act as a user. |
| `sub` is a UUID | It becomes the owner ID. |
| `user_metadata.email_verified` is `true` | See below. |

A refused request gets `401` with a problem body whose `code` is
`auth.missing_token`, `auth.invalid_token` or `auth.email_not_verified`. The
reason a token failed is not reported in any more detail, and neither the
token nor the reason is logged.

If the signing keys cannot be fetched and the needed key is not cached, the
answer is `503 auth.unavailable`, not `401`: the fault is the server's, and
the client should keep its session and try again.

### Signing keys

Keys come from `<issuer>/.well-known/jwks.json`. They are cached for ten
minutes. A token naming an unknown key triggers one fresh fetch, so key
rotation works without a wait, but fetches are never less than 30 seconds
apart, so a flood of made-up key IDs cannot make the API hammer the provider.
During a provider outage, keys already cached keep working.

### Email verification: where the guarantee really comes from

The requirement is that only a verified address can use the API. Two controls
enforce it, and the first is the one that matters:

1. **The project setting "Confirm email" must be on.** With it on, Supabase
   Auth does not issue a session to an unconfirmed account, so no token exists
   to present.
2. The API also requires `user_metadata.email_verified` to be `true`. This is
   defence in depth: it catches a project where the setting was turned off.
   It is not sufficient alone, because a signed-in user can edit their own
   `user_metadata`.

Whoever operates the Supabase project must keep "Confirm email" on. This is on
the launch checklist.

## What the browser client does and does not do

`src/auth/supabase-auth-client.ts`:

- Uses `@supabase/auth-js` only. The browser never calls the Supabase Data API.
- Never reads a session out of a URL (`detectSessionInUrl` is off). The
  one-time code in an email link is used for exactly one thing: letting the
  person who opened a reset link choose a new password. The code is removed
  from the address bar as soon as it is read.
- Setting a new password requires a reset link accepted on that page. An
  ordinary signed-in session is not enough, and the link's session is ended
  as soon as the password is set.
- Signing out removes the local session before the server is contacted, so it
  works offline.
- Never reveals whether an address has an account: registering an existing
  address and asking for a reset for an unknown one look the same as the
  normal case.
- Never shows or logs the provider's error text.

The session (access and refresh token) is kept by the client library in
`localStorage` under `warmly.auth`. That is a credential for the account, not
for the journal: without a device key or the recovery key it decrypts nothing.
The strict Content Security Policy is the control against script that could
read it. Binding each request to a device key is planned in #21.

## Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `WARMLY_AUTH_ISSUER` | API | `<project URL>/auth/v1`. Required in production, and must be `https` on another machine. |
| `WARMLY_AUTH_AUDIENCE` | API | Defaults to `authenticated`. |
| `VITE_SUPABASE_URL` | Frontend build | The project URL. Also sets the one extra `connect-src` origin in the CSP. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend build | The publishable key. Public by design. Never the secret or service-role key. |

Without the two `VITE_` variables, a production build says accounts are not
available, and every other build uses the in-memory double.

## Tests

No test contacts a real auth provider. Backend tests sign tokens with a key
pair generated in the test run (`tests/auth/tokens.py`). Frontend tests drive
the client through a scripted stand-in for the provider's API.
