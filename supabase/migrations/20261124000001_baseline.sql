-- Baseline: the private schema, the API role and the deny-by-default pattern.
--
-- Everything Warmly stores lives in warmly_private. That schema must never be
-- added to the Supabase Data API's exposed schemas: the browser talks to
-- Supabase for authentication only, and to the Warmly API for data, so that
-- every data request also passes the device check (ADR-0002, PRD SEC-006).

CREATE SCHEMA IF NOT EXISTS warmly_private;

-- Nobody gets access by default, including the roles Supabase gives to
-- anonymous and signed-in browser clients.
REVOKE ALL ON SCHEMA warmly_private FROM PUBLIC;

DO $$
DECLARE
    browser_role text;
BEGIN
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA warmly_private FROM %I', browser_role);
            EXECUTE format(
                'REVOKE ALL ON ALL TABLES IN SCHEMA warmly_private FROM %I', browser_role
            );
        END IF;
    END LOOP;
END
$$;

-- The role every API transaction runs as. It cannot log in, cannot bypass
-- row-level security and owns nothing. Roles are shared by the whole cluster,
-- so creation tolerates the role already existing. Two cases are possible:
-- the role was created earlier (duplicate_object), or another database in the
-- same cluster is creating it at this very moment (unique_violation on the
-- role catalogue). Either way the role exists afterwards.
DO $$
BEGIN
    CREATE ROLE warmly_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
EXCEPTION
    WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA warmly_private TO warmly_api;

-- The owner for the current transaction, set by the API from the verified
-- session. NULL when unset, so every owner-scoped policy then matches nothing.
CREATE OR REPLACE FUNCTION warmly_private.current_owner() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$ SELECT nullif(current_setting('warmly.owner_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION warmly_private.current_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warmly_private.current_owner() TO warmly_api;

-- A table that exists only to prove the ownership pattern end to end. Every
-- real table added later copies these four statements: enable RLS, force it
-- (so it applies to the table owner too), add the owner policy, grant DML.
CREATE TABLE IF NOT EXISTS warmly_private.policy_probe (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id uuid NOT NULL,
    note text NOT NULL
);

ALTER TABLE warmly_private.policy_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmly_private.policy_probe FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_probe_owner_only ON warmly_private.policy_probe;
CREATE POLICY policy_probe_owner_only ON warmly_private.policy_probe
    FOR ALL TO warmly_api
    USING (owner_id = warmly_private.current_owner())
    WITH CHECK (owner_id = warmly_private.current_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON warmly_private.policy_probe TO warmly_api;
