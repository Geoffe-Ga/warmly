# Raising the minimum sync version safely

The server speaks a range of sync protocol versions, `SYNC_VERSION_MIN` to
`SYNC_VERSION_MAX` in `warmly/schemas/sync.py`. Each app build speaks one,
`SYNC_VERSION` in `src/sync/compat.ts`, and says so on every sync request.
A build outside the range is refused with `426 sync.upgrade_required`. It
keeps everything it has, keeps working offline and asks the person to
update (ADR-0006, "Old and new versions together").

People update when they choose to. The app never reloads itself under
unsaved writing, and a device can stay offline for months. So the order of
steps matters more than the speed.

## Adding a new version (N+1)

1. **Server first.** Ship a server that speaks both: leave the minimum where
   it is and raise the maximum to N+1. Every route must still accept version
   N exactly as before. Add a new scenario file beside
   `tests/fixtures/sync/scenarios-v1.json`; never edit the old one.
2. **Wait** until that server is running everywhere. A new app build that
   reaches an old server gets `426`, sees that the server's maximum is below
   its own version, and simply retries later, so a short overlap is safe.
3. **Then the app.** Ship the build that speaks N+1. Old builds keep
   working, because the server still speaks N.

## Dropping an old version (raising the minimum)

Do this only when there is a reason, such as a flaw in version N.

1. **Check who still speaks N.** The request log has no account or device
   in it (by design), so count requests by version at the hosting edge, or
   add a count of `Warmly-Sync-Version` values to the metrics. Do not log
   the header beside anything that identifies a person.
2. **Decide what "few enough" means** before looking, and write it down in
   the release notes. Devices that have been offline will come back later
   than the counts suggest.
3. **Raise `SYNC_VERSION_MIN`** in a release of its own, with nothing else
   in it, so it can be put back by reverting one commit.
4. **What people on the old build see:** "Update Warmly to keep syncing.
   Your writing is saved on this device." Nothing is deleted and nothing
   queued is dropped. When they update, everything they wrote in the
   meantime is sent.
5. **Never raise the minimum above the version of the app that is currently
   being served.** That would lock out everyone, including people who have
   just updated. `tests/api/test_sync_versions.py` and
   `tests/frontend/sync/compat.test.ts` check each side; there is no test
   that reads both numbers, so check them by eye in review.

## Putting it back

Lower `SYNC_VERSION_MIN` again and redeploy. Refused devices retry on their
next sync trigger (unlock, coming back online, a new change, or "Sync
now") and carry on from where they stopped.

## What this does not cover

- **The record format** (`schema_version` on each record, ADR-0003 and
  ADR-0014). A newer build reads every older format; an older build leaves
  a newer record alone and counts it as unreadable. That is a separate
  number from the sync version.
- **The local database** (`DB_VERSION`, ADR-0014). A newer build upgrades
  it; an older build refuses to open a newer one and says so.
