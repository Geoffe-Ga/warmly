# ADR-0004: Trusted-device unlock and the inactivity lock

- **Status:** Accepted
- **Date:** 2026-11-25
- **PRD references:** §4.3 [DEV-005, DEV-006], §13.2, §5.1 [SYNC-001]; AC-21
- **Decision register:** D-05

## Context

After ADR-0003 the account root key lives only in memory. A reload, or the
30-minute lock, would force the user to type their 56-character recovery key
again. A device the user trusts needs a quicker way to unlock that does not
make the lock meaningless.

Two things must both be true:

- A copy of what the browser stores on disk must not be enough to open the
  journal.
- Holding the unlocked phone or laptop must not be enough either. Otherwise
  the lock screen is decoration.

## Options

### Option 1: A non-extractable WebCrypto key in IndexedDB, nothing else

- **Pros:** no secret for the user to remember; one tap to unlock.
- **Cons:** anyone holding the device can unlock, because the browser will
  use the key for whoever asks. The inactivity lock would protect nothing.

### Option 2: A device passphrase only (PBKDF2), stored blob readable by script

- **Pros:** needs a secret the user knows.
- **Cons:** the stored blob can be copied off the device and attacked offline
  at leisure.

### Option 3: Both layers: device key and an unlock secret

- **Pros:** a copied blob is useless without the browser's key store, and the
  device is useless without the secret.
- **Cons:** the user sets one more secret per device.

## Decision

Use **option 3**.

```
stored = AES-256-GCM( device key , AES-256-GCM( unlock key , root key ) )
```

- **Device key.** AES-256-GCM, generated on the device, **non-extractable**,
  kept in IndexedDB as a key object. Script can use it but cannot read it.
- **Unlock key.** Derived from a **device passphrase** with
  PBKDF2-HMAC-SHA-256, a random 16-byte salt and 600,000 iterations (the OWASP
  Password Storage Cheat Sheet figure when this was written). The iteration
  count is stored with each record, so it can be raised without stranding
  devices. A stored count below 100,000 or above 10,000,000 marks the record
  as damaged. The passphrase is normalised to NFKC, is at least 12 characters,
  and is never stored. Argon2 is not available in WebCrypto, so the iteration
  count and the passphrase length are the levers.
- **Guessing on the screen is limited.** Five wrong passphrases in a row
  remove the device record. The device then needs the recovery key and can be
  trusted again afterwards. Nothing is lost. The count is kept in the record,
  so a reload does not reset it. Each attempt is counted in one transaction
  *before* it is tried, so simultaneous attempts each count and an abandoned
  attempt still counts. The limit is a control against guessing on the lock
  screen only: someone who can restore an earlier copy of the browser profile
  resets the count along with everything else.
- **Associated data** on both layers: `"warmly/device-key/" | version |
  len(owner) | owner`, so a record cannot be moved to another account.
- **Record, format version 1** (one per account, in IndexedDB): version,
  device key, salt, iterations, two 12-byte nonces, wrapped bytes.
- **Where it is stored.** IndexedDB only. Nothing that can decrypt is ever in
  `localStorage` or `sessionStorage` (SYNC-001).
- **The account password is not involved.** It never derives or unlocks a key.
- **Enrolment.** A device can be trusted only at the moment the journal has
  just been opened with the recovery key (onboarding or recovery), because
  that is the only time the root key's bytes exist outside a non-exportable
  handle. They are held in memory until the user sets a passphrase or
  declines, and are wiped on either, and on lock.
- **Failure behaviour.** A wrong passphrase leaves the device locked and says
  so. A record that cannot be used (missing part, newer format, altered
  bytes) is removed and the user is pointed to the recovery key. A damaged
  inner layer cannot be told from a wrong passphrase; the attempt limit ends
  that case too.
- **Signing out keeps the device trusted.** The wrapped record stays in
  IndexedDB, protected by the passphrase and bound to the account, so signing
  back in does not need the recovery key. Removing a device's trust
  explicitly belongs with device management (#23).

### Passkeys (WebAuthn PRF): deferred

D-05 prefers a passkey with the PRF extension as the unlock secret where the
browser supports it, with the passphrase as the fallback. This ADR ships the
passphrase path only. The passkey path cannot be verified without real
authenticators: behaviour differs by platform and OS version, and the test
browsers offer no virtual authenticator for WebKit. Shipping it untested
would risk locking people out of the quick path on exactly the devices it is
for. It is tracked in #80, which needs testing on real hardware. The store
already separates "produce the unlock key" from "unwrap", so a passkey slots
in as a second source of that key.

## Support matrix

| Browser | Device key in IndexedDB | PBKDF2 unlock | How verified |
| --- | --- | --- | --- |
| Chromium (desktop) | Yes | Yes | Playwright E2E, every run |
| WebKit (iPhone 15 profile) | Yes | Yes | Playwright E2E, every run |
| Safari on a real iPhone, and the installed PWA | Expected | Expected | **Not verified here.** Release checklist item |
| Passkey with PRF, any platform | n/a | n/a | Deferred to #80 |

Playwright's WebKit is the same engine as Safari but is not Safari on iOS.
Storage eviction for installed web apps and private browsing can differ, so a
real-device check is on the release checklist.

## The lock

- **Manual lock** and the **inactivity lock** do the same thing: let
  registered flush hooks finish (bounded at 5 seconds), drop the root key and
  anything pending from memory, change the session to locked, and show the
  locked screen. Private screens are removed from the page, not hidden.
- **Flush hooks** exist so that work which needs the keys, such as encrypting
  the draft being edited, is saved before they go. A hook that fails or hangs
  never prevents the lock.
- **Inactivity** is 30 minutes since the last pointer press, key, wheel, touch
  or input event, measured on the wall clock. Moving the pointer without
  pressing does not count, so a device left on a desk with a drifting mouse
  still locks; scrolling by wheel, touch or keyboard does count. A clock that
  moves backwards is treated as idle, because elapsed time can no longer be
  trusted. It is re-checked when the page
  becomes visible, so a tab or phone that slept past the limit locks on
  resume.
- **Sign out** does not wait for hooks. It must always succeed at once.
- **The flush window.** While hooks run, for at most 5 seconds, the private
  screen is still shown. That is the price of not losing unsaved work; with
  no hooks registered, locking is immediate.

## What "cleared from memory" means

Locking drops every reference this code holds to key material and overwrites
the byte arrays it controls. That is the extent of what a web page can do. It
does not guarantee that the browser, the operating system or hardware has
erased its own copies, and nothing here is a secure enclave.

## What this does not protect against

- **Script running in the app's own origin** (for example through an XSS
  bug) can *use* the device key even though it cannot read it. It could strip
  the outer layer and then try passphrases offline against the inner layer,
  without the on-screen attempt limit. Against that attacker the passphrase
  is the only barrier, and PBKDF2 at 600,000 iterations slows a guess but
  does not make a weak passphrase safe. The controls against this are the
  strict Content Security Policy and the absence of third-party script.
- **Someone with both the browser profile and the passphrase** can open the
  journal on that device. That is what a passphrase is.

## Consequences

- A user who forgets the device passphrase uses the recovery key and can then
  set a new passphrase. Nothing is lost.
- Clearing site data removes the device record. The recovery key still works.
- An attacker needs both the device's browser profile and the passphrase.
  With both, they can open the journal on that device; that is what a
  passphrase is.
- A weak passphrase is the weak point. PBKDF2 slows guessing but does not
  stop it. This is stated in the threat model.
- No new dependency and no change to the Content Security Policy.
