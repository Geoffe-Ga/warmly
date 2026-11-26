# Supported browsers

Warmly is a web app that can be installed. This page says where it is
expected to work, how that is checked, and what a person must still check
by hand before launch (PRD UI-003, §8; AC-28).

## What is supported

The two most recent major versions of:

- Safari on iOS and iPadOS
- Safari on macOS
- Chrome on desktop and Android
- Edge on desktop
- Firefox on desktop

Use a normal window. A private window may turn off the storage Warmly
needs, and in some browsers it has no service worker, so the app cannot
open offline there.

## What the app needs, and what it says when that is missing

The app looks at what the browser offers, never at its name or version
(`src/app/support.ts`).

| Needed | Used for | If it is missing |
| --- | --- | --- |
| WebCrypto (`crypto.subtle`, random values, UUIDs) | Encrypting everything before it is stored or sent | A notice on every screen says Warmly may not work here and names the supported browsers |
| IndexedDB | Keeping encrypted records on the device | The same notice |
| A service worker | Opening the app with no connection | No notice. Everything else works; the app needs a connection to open |

The notice is fixed text and shows nothing private.

## How it is checked automatically

Every pull request runs the browser tests on two engines: Chromium, as a
modern desktop browser, and WebKit with an iPhone 15 profile, as the
stand-in for Safari on iOS.

| Suite | What it proves |
| --- | --- |
| `e2e/pwa/install.spec.ts` | The manifest names the app, starts at `/`, opens standalone and has 192 and 512 pixel PNG icons and a maskable one; the page has a 180 pixel PNG for the iOS Home Screen; a service worker takes control and every file it cached is served with the network off |
| `e2e/pwa/offline-journey.spec.ts` | With the network off: write an entry, leave and resume a draft, edit, search, delete, write and change cards, reorder them, present and print. Nothing throws, nothing tries the network, and everything is sent when the connection returns |
| `e2e/pwa/storage-full.spec.ts` | When the device has no room, what was typed stays on the page, the message says what happened and what to do, and saving works again once there is room |
| `e2e/app/offline.spec.ts` | The cache holds the app shell only; a tab suspended for more than 30 minutes comes back locked with its draft intact; Settings reports honestly whether the browser will keep the data |
| `e2e/app/update.spec.ts` | A new version waits while a draft is being written and is applied only when the person asks |
| `e2e/production/budget.spec.ts` | A first visit downloads at most 150 KB of script and styles, compressed |
| `tests/frontend/perf/scale.test.ts` | Opening a journal of 2,000 entries decrypts each entry once and never again while unlocked; ordering and searching touch neither storage nor keys |

### What these checks are not

- **WebKit in a test is not an iPhone.** It is the same engine without
  iOS around it. It cannot add the app to a Home Screen, it is never
  evicted by the system, and it has no passkeys.
- **Firefox and Edge are not run automatically.** Edge shares Chromium's
  engine. Firefox is covered only by the manual list below.
- **A full device is simulated.** The test makes each write fail the way
  a browser reports a full device. It does not fill a disk.
- **Speed is not timed in CI.** A stopwatch on a shared build machine
  passes and fails for reasons that have nothing to do with the code. CI
  checks the amount of work instead. The time itself is on the manual
  list.

## Budgets

| Budget | Limit | Enforced by |
| --- | --- | --- |
| First visit download (script and styles, gzip) | 150 KB | `e2e/production/budget.spec.ts`, on every pull request |
| Decryptions to open a journal of 2,000 entries | 2,000 (one each) | `tests/frontend/perf/scale.test.ts`, on every pull request |
| Unlock to the list of entries, 2,000 entries | 2 seconds on a mid-range phone | By hand, before launch (below) |

Raising a budget is a decision. Say why in the pull request.

## Manual checks before launch

These need a person with real devices. An automated agent cannot do them
and does not claim to have. Record the device, the OS and browser
versions, the date and the result for each.

On an iPhone with a supported version of iOS, in Safari:

1. Open the app, sign up, and choose Share, then Add to Home Screen. The
   icon is the Warmly heart on a pink square, not a screenshot of the page.
2. Open it from the Home Screen. It opens without Safari's address bar.
3. Write an entry. Turn on Airplane Mode. Close the app from the app
   switcher and open it again from the Home Screen. It opens to the locked
   screen, unlocks, and shows the entry.
4. Still offline, write a second entry and a card. Turn Airplane Mode off.
   The status line reaches "All changes saved".
5. Leave the app in the background for more than 30 minutes with a draft
   open. On return it is locked, and the draft is there after unlocking.
6. In Settings, read what the app says about whether the browser will
   keep this device's data. Check it matches what iOS reports for the site.
7. Leave the app unused for at least a week, or clear website data for
   another site to put the device under storage pressure, then open it.
   If the data is gone, the app says so plainly and signing in on this
   device brings the records back from sync after the recovery key is
   entered. Nothing is shown as saved that is not.
8. If passkey or device-passphrase unlock is offered, unlock with it
   after a restart of the phone.
9. With 2,000 synthetic entries (use a test account), time unlock to the
   list of entries. It should be about two seconds or less.

On desktop, in the current Firefox and the current Safari:

10. Sign up, write an entry, lock, unlock, search, make a collection with
    two cards, present them, and open the print view.
11. In Firefox, open the app in a private window. Read what it says.

Report anything that fails as a blocking issue with the device details.
