# Local database snapshots

Dumps of the local IndexedDB database exactly as each schema version wrote
it (PRD §10 REL-004, §13.6). The migration tests rebuild a database from
each dump and open it with the current code, which must upgrade it and still
read every record.

- One directory per schema version: `v1/`, later `v2/`, and so on.
- **Never edit or regenerate an existing directory.** When the schema
  changes, add a migration step in `src/storage/db.ts` and a new directory
  dumped from the new version. Keep the old ones.
- Everything here is synthetic. The root key is the bytes 0 to 31 and
  protects nothing real. No real key or journal text may ever be committed.

`snapshot.json` holds the owner the records are bound to, the database (its
version, each object store's key path and rows, with bytes as
`{ "base64": "..." }`), and what the records must decrypt to.
`tests/frontend/storage/idb-snapshot.ts` reads and writes the format.
