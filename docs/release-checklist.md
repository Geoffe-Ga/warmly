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

## Trusted-device unlock (issue #20, `docs/adr/0004-trusted-device-unlock.md`)

- [ ] **Checked on a real iPhone**, in Safari and as an installed app: set a
      device passphrase, lock, unlock; reload; leave the app in the background
      for more than 30 minutes and confirm it is locked on return. The
      automated tests use the WebKit engine, not Safari on iOS. Tracked in
      #66.

## Device identity and request signing (issue #21, `docs/adr/0005-device-identity-and-pairing.md`)

- [ ] **Checked on a real iPhone**, in Safari and as an installed app: create
      an account, open Manage Devices and confirm the device is listed and
      marked as this device; reload, unlock and confirm it is still the same
      single device. Safari can clear IndexedDB for a site that is not used
      for a while, which would make the device register again as a new one.
      Tracked in #66.
- [ ] **Signed requests work against the deployed API**: the path the API
      sees must be the path the browser signed, so a proxy or CDN in front of
      it must not rewrite paths or query strings. Tracked in #61.
- [ ] **The API servers' clocks are synchronised** (NTP). A request is
      refused when its timestamp is more than 5 minutes from the server's
      clock. Tracked in #61.
- [ ] **No recovery envelope in the production database lacks an enrollment
      key** (`device_enrollment_key IS NULL` returns no rows). An
      account without one can never register a device. Tracked in #61.

## Device pairing (issue #22, `docs/adr/0005-device-identity-and-pairing.md`)

- [ ] **Checked with two real devices**, one of them an iPhone: start on the
      new device, type the code on the other, confirm the new device unlocks
      and appears in Manage Devices. Type the confirmation code on the new device. Repeat with a wrong code and confirm
      both devices say the request was cancelled. Tracked in #66.
- [ ] **Checked with a screen reader** (VoiceOver): the code on the new
      device is read digit by digit, and the approval form's fields and
      errors are announced. Tracked in #66.

## Device revocation (issue #23, `docs/adr/0005-device-identity-and-pairing.md`)

- [ ] **A live token carries a timed `password` entry in `amr`** after
      signing in again, so that revoking a device works against the real
      auth provider. The automated tests sign their own tokens. Tracked in
      #78.
- [ ] **Checked with two real devices**: remove one from the other and
      confirm the removed one is signed out on its next action and shows the
      explanation; remove the device in use and confirm it is signed out at
      once. Tracked in #66.
