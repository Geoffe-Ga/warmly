# ADR-0002: Backend data access, roles and migrations

- **Status:** Accepted
- **Date:** 2026-11-24
- **PRD references:** §4.2 [SEC-005, SEC-006], §7 (migrations), §8, §10 [REL-006]

## Context

The API stores ciphertext for many independent accounts in one PostgreSQL
database. The PRD requires owner-only access "at API and DB policies", with
service credentials never shipped to the browser, and migrations that are
idempotent and safe for automated rollback.

Three questions need one coherent answer: who may reach the tables, how the
API identifies the owner to the database, and how the schema changes.

## Options

### Option 1: Browser talks to the Supabase Data API with row-level security

- **Pros:** no backend data code; RLS keyed on `auth.uid()` works out of the box.
- **Cons:** a valid session token is then enough to read and write ciphertext.
  The PRD requires device authorization to be re-checked on every sync
  operation, and a revoked device with an unexpired token would bypass it.
  Compare-and-swap, idempotency and conflict retention would have to live in
  SQL functions.

### Option 2: API connects with the service role and filters in application code

- **Pros:** simple; full control in Python.
- **Cons:** the service role bypasses RLS, so a single missing `WHERE owner_id`
  exposes every account. The database provides no second line of defence.

### Option 3: API connects with a restricted role and sets the owner per transaction

- **Pros:** the API enforces device checks and sync semantics, and the database
  independently enforces ownership. A query that forgets its owner filter still
  sees one owner's rows.
- **Cons:** every transaction starts with two extra statements; policies must be
  written for every table.

## Comparison

| Dimension | Data API + RLS | Service role | Restricted role + RLS |
| --- | --- | --- | --- |
| Device check on every operation | No | Yes | Yes |
| Database enforces ownership | Yes | No | Yes |
| A forgotten owner filter leaks data | No | Yes | No |
| Sync logic lives in | SQL functions | Python | Python |
| Service-role key used at runtime | No | Yes | No |

## Decision

Use **option 3**.

1. **Private schema.** Every table lives in `warmly_private`. It is not exposed
   through the Supabase Data API, and the `anon`, `authenticated` and `PUBLIC`
   roles have no privileges on it. The browser uses Supabase for
   authentication only. **The schema must never be added to the project's
   exposed schemas.**
2. **Restricted role.** API transactions run as `warmly_api`, which cannot log
   in, is not a superuser and cannot bypass row-level security.
3. **Owner per transaction.** `Database.as_owner(owner_id)` opens a transaction
   and runs `SET LOCAL ROLE warmly_api` and
   `set_config('warmly.owner_id', <id>, true)`. Both end with the transaction,
   so a pooled connection carries nothing to the next request.
4. **Policy on every table.** Each table enables and forces row-level security
   with one policy: `owner_id = warmly_private.current_owner()` for both `USING`
   and `WITH CHECK`. With no owner set the function returns NULL and the policy
   matches nothing, which is the deny-by-default behaviour.
5. **Driver.** `psycopg` 3 with `psycopg_pool`, asynchronous. Only `warmly.db`
   may import it (enforced by import-linter).
6. **Migrations.** Plain forward-only SQL in `supabase/migrations`, named
   `<14-digit version>_<name>.sql`. `python -m warmly.db.migrate` applies each
   once, in order, in one transaction, and records a checksum. An edited,
   already-applied file is an error.

## Consequences

- **The owner ID passed to `as_owner` must come from the verified session.**
  Until JWT verification lands (#18) nothing calls it outside tests.
- Every new table needs the same four statements as `policy_probe`: enable RLS,
  force RLS, create the owner policy, grant DML to `warmly_api`. The isolation
  test suite (#38) will check this for every table.
- Migrations run with an administrative connection, never as `warmly_api`.
  Production migration is wired by the deploy pipeline (#61).
- Schema changes follow expand, migrate, contract. A destructive step needs a
  verified backup first (#65).
- The production login role should be a member of `warmly_api` with no other
  privileges. `SET LOCAL ROLE` is defence in depth, not a substitute.
- The file naming matches the Supabase CLI, so its tooling can read the same
  directory, but the project's own runner is the source of truth for what has
  been applied.
- Integration tests need a real PostgreSQL (`WARMLY_TEST_DATABASE_URL`). They
  fail, rather than skip, when it is missing.
