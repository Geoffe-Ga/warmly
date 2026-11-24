/**
 * Vitest setup.
 *
 * 1. Provide an in-memory IndexedDB so offline-storage code (PRD SYNC-001)
 *    can be unit-tested under jsdom.
 * 2. Forbid network access (PRD AC-03). A test that needs a response replaces
 *    `fetch` with its own double.
 */
import "fake-indexeddb/auto";

import { installNetworkGuard } from "./network-guard";

installNetworkGuard(globalThis);
