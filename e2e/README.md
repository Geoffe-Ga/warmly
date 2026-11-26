# Browser tests

Playwright with axe-core, on desktop Chromium and mobile Safari (WebKit).
Run them with `./scripts/e2e.sh`.

## Two builds, three folders

Both builds are served through `vite preview`, so the service worker, the
manifest, the Content Security Policy and the security headers behave as they
do when the app is installed.

| Folder | Build | Put here |
| --- | --- | --- |
| `production/` | `npm run build`: exactly what ships | Anything that must be true of the real artefact: headers and CSP, what a signed-out visitor sees, and that no test double or development tool is in the bundle |
| `app/` | `npm run build:e2e`: the same build with `--mode e2e` | Feature flows. This build swaps in the in-memory doubles from `src/testing/` for services a test cannot depend on (the auth server, the key vault, later the AI provider) and includes the component gallery |

| `pwa/` | The same `e2e` build | The app looked at whole, as something installed: what makes it installable, one journey through every offline feature with the network off, and a device with no room left. See `docs/support/browsers.md` for what these do and do not prove |

Why two: feature flows need doubles, but a double must never ship. The
production specs check the real bundle for that; the app specs exercise the
features. A new feature test belongs in `app/` unless it is about the real
artefact.

## Rules

- Import `test` and `expect` from `fixtures/test.ts`, never from
  `@playwright/test`. The fixture fails any test that contacts another host or
  violates the Content Security Policy. ESLint enforces this.
- Keys live in memory, so a page reload locks the app. To reach another screen
  while unlocked, navigate in the app (see `app/account.ts`), not with
  `page.goto`.
- The stand-in sync server in the `e2e` build lives in the page, so a reload
  empties it. A test that reloads and then expects "All changes saved" must
  make its records after the reload.
- Run axe on every screen and state a test puts on show.
- A new route, or a new kind of state, must be added to the plan in
  `app/a11y.spec.ts`. The suite fails until it is.
- Never retry or skip a failing test to get green. Find the cause.
