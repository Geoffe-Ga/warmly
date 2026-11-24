/**
 * Vitest setup: provide an in-memory IndexedDB so offline-storage code
 * (PRD SYNC-001) can be unit-tested under jsdom.
 */
import "fake-indexeddb/auto";
