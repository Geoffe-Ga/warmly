/**
 * Every kind of record that is built from journal entries, and how each
 * says which (ADR-0010). A new kind of derived record, such as an AI
 * card, takes part in invalidation by adding its rule here; the engine in
 * `deps/` does not change.
 */
import type { DependencyRule } from "./deps/index";
import { REFLECT_SESSION_RULE } from "./reflect/dependencies";

/** The rules the app runs with. */
export const DEPENDENCY_RULES: readonly DependencyRule[] = [
  REFLECT_SESSION_RULE,
];
