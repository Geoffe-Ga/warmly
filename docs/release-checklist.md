# Release checklist

Things that must be true before real users are onboarded, and that no test in
this repository can prove because they live outside it. Each item says where
it came from and where the work is tracked. Issue #68 completes this list for
the whole product; items are added here as the work that creates them lands.

## Authentication (issue #18, `docs/security/authentication.md`)

- [ ] **"Confirm email" is on in the Supabase project.** This setting is the
      control that stops an unverified address from getting a token. The
      API's own `email_verified` check reads a claim the user can edit, so it
      is not a control. Tracked in #78 (development project) and #61 (deploy
      pipeline).
- [ ] **The project signs tokens with an asymmetric key** (ES256 or RS256).
      The API refuses HS256. Tracked in #78.
- [ ] **The allowed redirect URLs** include `<app origin>/welcome/verify` and
      `<app origin>/sign-in/new-password`, and nothing wider. Tracked in #78.
- [ ] **The live smoke test has passed** against the project: register,
      verify, sign in, call a private API route, reset the password, sign out.
      Until it has, claim names and error codes rest on the client library's
      source, not on observed behaviour. Tracked in #78 and #64.
- [ ] **Every deployed environment**, including staging and previews, sets
      `WARMLY_ENV=production` and `WARMLY_AUTH_ISSUER`. Outside production
      the API defaults to the local development issuer. Tracked in #61.
- [ ] **Only the publishable key** appears in any `VITE_` variable. Tracked
      in #61.
- [ ] **A build made with `--mode e2e` cannot be published.** It contains the
      in-memory test doubles. Tracked in #61.
