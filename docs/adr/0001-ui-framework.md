# ADR-0001: UI framework is Preact with TSX

- **Status:** Accepted
- **Date:** 2026-11-24
- **PRD references:** §3.1 [UX-001], §3.6 [UI-001..008], §4.1 [SEC-001], §4.2 [SEC-007]

## Context

The scaffold rendered Home with hand-written DOM calls and had no router.
`CLAUDE.md` listed the UI framework as an open decision to settle before feature
work. The MVP has about sixteen screens with forms, dialogs, lists and
state-dependent views (locked, offline, conflict), so some component model is
needed.

The decision is constrained by the product's security posture more than by
developer taste:

- **Supply chain (SEC-001).** Every runtime dependency ships to a browser that
  holds decrypted journal text and, later, an AI provider key. Compromised
  dependencies are in the threat model, so fewer packages is a real benefit.
- **XSS (SEC-007).** Journal text, card text and AI output are all rendered.
  The framework must escape text by default.
- **Strict CSP.** No `unsafe-eval` and no inline scripts, which rules out
  anything that compiles templates in the browser.
- **Offline PWA on mobile Safari.** Startup cost matters on a phone.

## Options

### Option 1: Stay framework-free

Keep writing `document.createElement` code and add a hand-rolled router.

- **Pros:** zero runtime dependencies; nothing to learn.
- **Cons:** every screen re-implements rendering and update logic; state-driven
  views are error-prone; no component testing ecosystem.
- **Effort:** low now, high for every later screen.

### Option 2: Preact

A small virtual-DOM library with the React component model and hooks.

- **Pros:** the `preact` package has no runtime dependencies; JSX escapes text
  by default; components are plain functions, tested with Testing Library; the
  skills transfer directly to and from React and React Native.
- **Cons:** a smaller ecosystem than React; some React libraries need the
  `preact/compat` layer, which this project does not plan to use.
- **Effort:** low. No build plugin is required: TypeScript's `jsx: react-jsx`
  with `jsxImportSource: preact` is enough.

### Option 3: React

The most widely used component library.

- **Pros:** largest ecosystem and community.
- **Cons:** needs two runtime packages (`react`, `react-dom`), which pull in a
  further dependency, and ships several times more JavaScript than Preact for
  the same component model. The ecosystem advantage matters little here,
  because the project's policy is to avoid adding UI dependencies at all.
- **Effort:** low.

### Option 4: Svelte or Lit

A compiler-based framework, or web components.

- **Pros:** small output; Lit builds on platform standards.
- **Cons:** a different component model from the React family, so less reuse of
  existing knowledge; Svelte adds a compiler plugin to the build and test
  toolchain; Lit's shadow DOM complicates global design tokens and axe checks.
- **Effort:** medium.

## Comparison

| Dimension | Framework-free | Preact | React | Svelte / Lit |
| --- | --- | --- | --- | --- |
| Runtime packages added | 0 | 1 | 2, plus a transitive one | 1 or more |
| Text escaped by default | Manual | Yes | Yes | Yes |
| Works under strict CSP | Yes | Yes | Yes | Yes |
| Build plugin needed | No | No | No | Svelte: yes |
| Component testing | Hand-rolled | Testing Library | Testing Library | Framework-specific |
| Cost of each new screen | High | Low | Low | Low |

## Decision

Use **Preact with TSX**, pinned to an exact version, without `preact/compat`
and without a build plugin.

It gives the component model the MVP needs for the price of one dependency-free
package, which fits the supply-chain constraint better than React and avoids
the per-screen cost of staying framework-free.

Routing is a small in-repo module (`src/app/router.ts`) driven by a single
route table (`src/app/routes.ts`), not a routing library. The table is plain
data so the Playwright accessibility sweep reads the same list as the app.

## Consequences

- Screens are function components under `src/ui/screens/`; shared pieces live
  under `src/ui/components/`.
- **Never use `dangerouslySetInnerHTML`.** AI output and journal text are
  rendered as text. A lint rule should enforce this when the first rich-text
  need appears.
- Route parameters accept opaque record IDs only (`OPAQUE_ID` in
  `src/app/routes.ts`), so user text cannot be placed in a URL through the
  router.
- There is no hot-module state preservation in development, because no Preact
  build plugin is installed. Revisit only if it slows work noticeably.
- A UI library that requires React is not available without `preact/compat`.
  Adding that layer needs a new ADR.
