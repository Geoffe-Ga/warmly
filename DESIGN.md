---
version: alpha
name: Warmly
description: A private, journal-like, light-only interface for a relationship journaling PWA. The system anchors on a pink-tinted paper canvas with deep warm ink text, a wine-coral action colour and blush supporting surfaces. Depth comes from 2px borders and tonal surfaces rather than shadows, so the page reads like stationery. Type is the device's own system sans at a large 18px body size. Every text and control pairing is held to WCAG 2.2 AA by a unit test, every control is at least 44px tall, and nothing depends on colour or motion alone.

colors:
  coral: "#e35d7a"
  blush: "#fde4e8"
  soft-pink: "#f7a7b5"
  paper: "#fff7f8"
  ink: "#2e2a2b"
  surface: "#ffffff"
  ink-muted: "#5c5356"
  coral-text: "#a8324e"
  coral-strong: "#a8324e"
  on-strong: "#ffffff"
  border-strong: "#a8687a"
  focus: "#a8324e"
  danger: "#a1172c"
  danger-surface: "#fde8ea"
  success: "#1f6b45"
  success-surface: "#e6f4ec"
  warning: "#7a5200"
  warning-surface: "#fdf1d8"

typography:
  heading:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: 0
  small:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  small-strong:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: 0
  recovery-key:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: 0.05em

rounded:
  sm: 0.25rem
  md: 0.75rem

spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem

components:
  app-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.coral-text}"
    typography: "{typography.body}"
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.coral-text}"
    typography: "{typography.body}"
    height: 2.75rem
  nav-link-current:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    height: 2.75rem
  button-primary:
    backgroundColor: "{colors.coral-strong}"
    textColor: "{colors.on-strong}"
    borderColor: "{colors.coral-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1.5rem
    height: 2.75rem
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1.5rem
    height: 2.75rem
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-strong}"
    borderColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1.5rem
    height: 2.75rem
  button-disabled:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-muted}"
    borderColor: "{colors.border-strong}"
    border: 2px dashed
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1.5rem
    height: 2.75rem
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1rem
    height: 2.75rem
  text-input-invalid:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1rem
    height: 2.75rem
  text-area:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0.5rem 1rem
    height: 8rem
  choice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0.25rem 1rem
    height: 2.75rem
  choice-selected:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0.25rem 1rem
    height: 2.75rem
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.soft-pink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 1.5rem
  action-link:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 1rem
    height: 2.75rem
  banner-info:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 1rem
  banner-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.success}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 1rem
  banner-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.warning}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 1rem
  banner-error:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 1rem
  recovery-key:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    border: 2px dashed
    typography: "{typography.recovery-key}"
    rounded: "{rounded.md}"
    padding: 1rem
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 1.5rem
    width: 28rem
---

<!--
The front matter above mirrors the :root block of src/styles.css, which is the
source of truth. tests/frontend/ui/design-md.test.ts fails if a colour, space,
radius or type size here differs from the stylesheet, or if a {token} reference
below names something that is not defined. Change the stylesheet and this file
together. Format: https://github.com/VoltAgent/awesome-design-md
-->

## Overview

Warmly is a private journal for reflecting on one's own relationship, so the interface is built to feel like **good stationery**: a pink-tinted paper page (`{colors.paper}` — #fff7f8), deep warm ink (`{colors.ink}` — #2e2a2b), and a single wine-coral action colour (`{colors.coral-strong}` — #a8324e). It is calm, single-column and **light-only** (PRD UI-001). There is no dark theme, no shadow, no gradient, no illustration and no animation. People write difficult things here; nothing on the page should compete with their words.

The PRD names five brand colours as *references, not guaranteed-accessible text colours*. The brand coral (`{colors.coral}` — #e35d7a) reaches only 3.26:1 on paper, so it never carries text. The system derives darker working variants from it and holds every pairing in use to WCAG 2.2 AA with a unit test (`src/ui/contrast.ts`).

Depth comes from **borders and tonal surfaces**, never elevation. Controls have a 2px border, cards a soft-pink outline, banners a thick coloured leading edge. Every interactive element is at least 44px tall, shows a 3px focus ring, and says in words what colour also signals.

**Key Characteristics:**
- Pink-tinted paper canvas (`{colors.paper}` — #fff7f8) with warm ink text (`{colors.ink}` — #2e2a2b) at 13.43:1.
- One action colour: wine-coral (`{colors.coral-strong}` — #a8324e) for the primary button, links, the page heading and the focus ring.
- Brand coral (`{colors.coral}`) and soft pink (`{colors.soft-pink}`) are decoration only: the app icon, the browser theme colour, the card outline.
- System font stack at a large 18px body (`{typography.body}`); no web fonts are downloaded.
- A single 40rem (640px) reading column at every screen width; no breakpoints.
- 2px borders, two radii (`{rounded.sm}`, `{rounded.md}`), zero shadows.
- 44px minimum touch target on every control; a visible 3px focus ring on every focusable element.
- Status is always stated in words; private content never appears in a banner or on a locked screen (PRD UI-008).

## Colors

### Brand & Accent
- **Coral** (`{colors.coral}` — #e35d7a): The PRD brand reference. Decoration only (app icon heart, browser theme colour). Fails 4.5:1 on paper, so never text or a control.
- **Coral Strong** (`{colors.coral-strong}` — #a8324e): The working action colour. Primary button background and border.
- **Coral Text** (`{colors.coral-text}` — #a8324e): Links and the page heading. Same value as Coral Strong, named separately so text and fills can diverge later. 6.16:1 on paper, 5.40:1 on blush.
- **Soft Pink** (`{colors.soft-pink}` — #f7a7b5): Card outline only. At 1.88:1 on white it is decorative and must never be the only boundary of a control.
- **Focus** (`{colors.focus}` — #a8324e): The focus ring on every focusable element.

### Surface
- **Paper** (`{colors.paper}` — #fff7f8): The page floor. Warm and faintly pink, deliberately not pure white.
- **Surface** (`{colors.surface}` — #ffffff): Cards, inputs, secondary buttons and dialogs. White lifts writing areas off the paper.
- **Blush** (`{colors.blush}` — #fde4e8): Home action tiles and the neutral banner. Also the app icon background.

### Hairlines & Borders
- **Border Strong** (`{colors.border-strong}` — #a8687a): The 2px border on inputs, secondary buttons, action tiles, dialogs and the recovery key. 4.04:1 on paper and 4.26:1 on white, above the 3:1 required for control boundaries.

### Text
- **Ink** (`{colors.ink}` — #2e2a2b): All body text and most headings. 13.43:1 on paper, 11.77:1 on blush.
- **Ink Muted** (`{colors.ink-muted}` — #5c5356): Lead sentences, field hints, disabled button labels. 7.04:1 on paper.
- **On Strong** (`{colors.on-strong}` — #ffffff): Text on the primary (6.50:1) and danger (7.85:1) buttons.

### Semantic
- **Danger** (`{colors.danger}` — #a1172c) on **Danger Surface** (`{colors.danger-surface}` — #fde8ea): Destructive buttons, field errors, invalid input borders, the error banner edge.
- **Success** (`{colors.success}` — #1f6b45) on **Success Surface** (`{colors.success-surface}` — #e6f4ec): The success banner edge and background.
- **Warning** (`{colors.warning}` — #7a5200) on **Warning Surface** (`{colors.warning-surface}` — #fdf1d8): The warning banner edge and background.

Banner body text is always `{colors.ink}`; the semantic colour appears only on the leading edge, where it needs 3:1 rather than 4.5:1.

### Scrim
The dialog backdrop is `{colors.ink}` at 55% opacity, mixed in CSS from the ink token. It is not a separate colour.

## Typography

### Font Family
The system uses the **device's own UI font** (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). This is a privacy and performance decision as much as an aesthetic one: no font request leaves the device, the Content Security Policy needs no font origin, and the app shell works offline from the first paint. The only second face is the platform monospace (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`), reserved for the recovery key.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.heading}` | 2rem (32px) | 700 | 1.25 | 0 | The single `h1` of a screen, in `{colors.coral-text}` |
| `{typography.title}` | 1.375rem (22px) | 700 | 1.25 | 0 | `h2`: card headings, dialog titles |
| `{typography.body}` | 1.125rem (18px) | 400 | 1.6 | 0 | Running text, inputs, navigation links |
| `{typography.label}` | 1.125rem (18px) | 600 | 1.6 | 0 | Buttons, field labels, action tiles |
| `{typography.small}` | 1rem (16px) | 400 | 1.6 | 0 | Field hints |
| `{typography.small-strong}` | 1rem (16px) | 600 | 1.6 | 0 | Field error messages |
| `{typography.recovery-key}` | 1.375rem (22px) | 700 | 1.6 | 0.05em | The recovery key, monospace |

### Principles
- **Nothing is smaller than 16px.** "Small" text is the browser default size; body text is larger than default.
- **All sizes are in rem** so the interface follows the user's browser text-size setting and tolerates high zoom (PRD §3.6).
- **Three weights only:** 400 for reading, 600 for controls and labels, 700 for headings.
- **One `h1` per screen**, and it receives focus after in-app navigation so screen-reader users hear that the screen changed.
- Headings use `overflow-wrap: anywhere` so a long word cannot force horizontal scrolling on a narrow phone.

## Layout

### Spacing System
- **Base unit:** 0.25rem (4px).
- **Tokens:** `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px.
- **Page padding:** `{spacing.xl}` top and bottom, `{spacing.md}` left and right.
- **Stack gap:** `{spacing.md}` between cards, fields and banners in a screen.
- **Card and dialog padding:** `{spacing.lg}`.
- **Label to control:** `{spacing.xs}`.
- **Button row gap:** `{spacing.sm}`; rows wrap rather than shrink.

### Grid & Container
- **One column, always.** Content sits in a centred column of at most 40rem (640px), a comfortable measure for reading and writing.
- There is no multi-column grid, sidebar or card grid. Screens are a vertical stack.
- The header is a wrapping flex row: app name at the start, secondary navigation at the end.

### Whitespace Philosophy
Generous and even. One thing per row, the same gap between every row. A journal page should feel uncluttered, so resist filling the width on a laptop: the column stays narrow and the paper shows on both sides.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | `{colors.paper}`, no border | Page, header, headings, running text |
| Outlined surface | `{colors.surface}` + 2px `{colors.soft-pink}` border | Cards |
| Control | 2px `{colors.border-strong}` border | Inputs, secondary buttons, action tiles |
| Filled control | Solid `{colors.coral-strong}` or `{colors.danger}` | Primary and danger buttons |
| Overlay | `{colors.surface}` panel over a 55% ink scrim | Confirm dialog |

**There are no shadows.** Hierarchy is carried by surface tone (paper, blush, white) and border weight. The only layered element is the confirm dialog, separated from the page by the scrim.

### Decorative Depth
None. No gradients, textures, blurs or imagery. The app icon (a coral heart on a blush rounded square) is the only brand graphic.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.sm}` | 0.25rem (4px) | Banners, the focus ring |
| `{rounded.md}` | 0.75rem (12px) | Buttons, inputs, cards, action tiles, dialogs, the recovery key |

There are no pills and no circles. Borders are 2px everywhere; the banner's leading edge is 0.5rem (8px).

### Photography & Illustrations
None. Warmly shows the user's own words and nothing else. Do not add stock imagery, avatars, mascots or emoji-as-decoration.

## Components

### Top Navigation

**`app-header`** — A wrapping row on `{colors.paper}` with no border or background of its own. The app name ("Warmly", weight 700) links home at the start; the secondary navigation sits at the end.

**`nav-link`** — Underlined text link in `{colors.coral-text}`, at least 44px tall. **`nav-link-current`** — the current page (`aria-current="page"`) switches to `{colors.ink}`, weight 700 and a thicker underline, so the state is not carried by colour alone.

### Buttons

All buttons share one shape: at least 44 × 44px, padding `{spacing.sm}` × `{spacing.lg}`, 2px border, `{rounded.md}`, `{typography.label}`.

**`button-primary`** — The one main action of a screen. `{colors.coral-strong}` fill, `{colors.on-strong}` text.

**`button-secondary`** — The default. `{colors.surface}` fill, `{colors.ink}` text, `{colors.border-strong}` border.

**`button-danger`** — Destructive actions only (delete, revoke). `{colors.danger}` fill, `{colors.on-strong}` text. Always confirmed with `{component.dialog}`.

**`button-disabled`** — `{colors.paper}` fill, `{colors.ink-muted}` text and a **dashed** border. It uses `aria-disabled`, not `disabled`, so it stays focusable and is announced as unavailable. The dashed border signals the state without relying on a faded colour.

### Cards & Containers

**`card`** — A `<section>` on `{colors.surface}` with a 2px `{colors.soft-pink}` outline, `{rounded.md}` corners and `{spacing.lg}` padding. An optional `h2` in `{typography.title}` makes it a labelled group.

**`action-link`** — The large tiles on the home screen. A full-width link on `{colors.blush}` with a `{colors.border-strong}` border, `{typography.label}` text in `{colors.ink}`, and no underline: the whole tile is the target. A tile may carry a second line in `{typography.small}` and `{colors.ink-muted}`, such as the piece of an entry that matched a search.

**`detail-list`** — Short label and value pairs inside a card, such as a device's "Added" date. A two-column `<dl>`: labels in `{colors.ink-muted}`, values in `{colors.ink}`, with `{spacing.xs}` between rows.

### Inputs & Forms

**`text-input`** — Full width, at least 44px tall, `{colors.surface}` fill, 2px `{colors.border-strong}` border, `{rounded.md}`. Every field has a visible label in `{typography.label}` above it; placeholders are never used as labels. An optional hint in `{typography.small}` and `{colors.ink-muted}` sits between label and control.

**`text-input-invalid`** — The border turns `{colors.danger}` and an error message in `{typography.small-strong}` appears below, linked with `aria-describedby`. The message says what to do next.

**`text-area`** — The journal writing surface. Same styling as `{component.text-input}`, at least 8rem tall, vertically resizable.

**`choice`** — One option in a group where any number, or none, may be picked: a native checkbox and its word inside a 44px-tall outlined pill, wrapped in a `fieldset` whose `legend` asks the question. Used for the feelings check-in.

**`choice-selected`** — A ticked option: `{colors.blush}` fill. The tick itself still shows, so the state never depends on colour alone.

**`save-status`** — One line of `{typography.small}` in `{colors.ink-muted}` under a form that saves by itself: "Saving…" while it works, then "Saved on this device". Only the settled message is in the live region, so a screen reader hears it once, not after every pause.

**`offline-notice`** — One line under the header while the device is offline, in `{typography.small}` on `{colors.blush}` with a `{colors.border-strong}` bar: "Offline: your writing is saved on this device." It never shows private text, and it is gone while online.

**`versions`** — Two `{component.card}`s side by side, stacking on a narrow screen, each one whole version of an entry: a muted "Last changed" line, then each question in bold with its answer under it, line breaks kept. Used where the person chooses between two versions. The two are told apart by their headings ("On this device", "On your other device"), never by colour.

**`update-notice`** — One line under the header when a new version of the app has been downloaded, styled like `offline-notice`, with a `{component.button-secondary}` "Update now" beside it: "A new version of Warmly is ready." It never appears on its own schedule and never reloads the page by itself; pressing the button saves unsaved writing first.

**`sync-status`** — In the header while unlocked: one line in `{typography.small}` and `{colors.ink-muted}` ("All changes saved", "3 changes waiting to sync", "Couldn't sync. Your writing is saved on this device.", "Update Warmly to keep syncing. Your writing is saved on this device.", "Needs your attention") beside a `{component.button-secondary}` "Sync now". It is a state and a count, never private text.

### Status Banners

**`banner-info`**, **`banner-success`**, **`banner-warning`**, **`banner-error`** — A tinted block with an 8px coloured leading edge and `{rounded.sm}` corners. Each starts with a bold word label ("Offline:", "Saved:") so the meaning never depends on colour. Errors use `role="alert"`; the others use `role="status"`. Banners carry status wording only, never journal or card text, because they can appear on a locked screen and are read aloud.

### Recovery Key

**`recovery-key`** — The one-time recovery key. A dashed `{colors.border-strong}` box on `{colors.paper}`, set in `{typography.recovery-key}` with wide letter spacing so it is easy to copy by hand. One tap selects the whole key, and long keys wrap rather than scroll.

### Dialog

**`dialog`** — The confirm dialog. A `{colors.surface}` panel up to 28rem wide with a `{colors.border-strong}` border, centred over the ink scrim. The title is the question ("Delete this entry?"), the body says plainly what will happen, and the confirm button names the action ("Delete entry"), never a bare "OK". Focus is kept inside while it is open.

## Do's and Don'ts

### Do
- Use a token for every colour. Hex values live only in the `:root` block of `src/styles.css`; a test rejects them anywhere else.
- Add any new foreground/background pairing to `src/ui/contrast.ts` so the build checks it: 4.5:1 for text, 3:1 for borders and focus rings.
- Use `{colors.coral-text}` or `{colors.coral-strong}` whenever coral must be read or pressed.
- Give every control a 44px minimum height and leave the default focus ring in place.
- Pair every colour signal with words: a label on a banner, a message under an invalid field.
- Keep one `{component.button-primary}` per screen; everything else is `{component.button-secondary}`.
- Build screens from `src/ui/components/`; add a component there (and to the gallery) before styling a one-off.

### Don't
- Don't set text in `{colors.coral}` or `{colors.soft-pink}`. They are decoration.
- Don't add a dark theme or a `prefers-color-scheme` rule. The identity is light-only and a test enforces it.
- Don't add shadows, gradients, blur or decorative imagery.
- Don't load a web font, icon font or any remote asset. The Content Security Policy forbids it and the app must work offline.
- Don't use inline styles. The Content Security Policy has no `unsafe-inline`.
- Don't put journal text, card text or any private content in a banner, a page title or anything visible on a locked screen.
- Don't add scores, streaks, badges, progress meters or notification dots. The product has none by design.
- Don't rely on animation to explain a change; move focus and say it in text instead.

## Responsive Behavior

### Breakpoints
**There are none.** The same single column serves an iPhone-width screen and a laptop. Below 40rem the column fills the width inside `{spacing.md}` gutters; above it, the column is centred and the paper margin grows.

| Width | Behaviour |
|---|---|
| Narrower than 40rem | Column fills the screen; header and button rows wrap onto more lines |
| 40rem and wider | Column fixed at 40rem, centred |

### Touch Targets
- Every button, input, navigation link and action tile is at least 2.75rem (44px) tall; buttons are also at least 44px wide.
- Button rows have an 8px gap, so adjacent targets never touch.
- An action tile's whole surface is the link.

### Collapsing Strategy
- Nothing hides and nothing becomes a hamburger menu. The header and button rows **wrap**.
- Long words and long keys wrap (`overflow-wrap: anywhere`) so the page never scrolls sideways.
- The dialog shrinks to the screen width inside `{spacing.md}` gutters and scrolls internally if it is taller than the screen.
- Because sizes are in rem, raising the browser text size reflows the same layout; no size is locked in pixels.

### Motion
There is no animation or transition. A `prefers-reduced-motion: reduce` rule also disables any that a future change might add.

## Iteration Guide

1. Change `src/styles.css` first, then this file. `tests/frontend/ui/design-md.test.ts` fails until the two agree.
2. Work on one component at a time and refer to it by its key, for example `{component.card}` or `{component.banner-warning}`.
3. A new state of a component (`-invalid`, `-disabled`, `-current`) is a separate entry under `components:`.
4. Refer to tokens by name in prose and CSS; never write a raw hex value outside the token block.
5. Do not design hover states. Controls have a default, a focus-visible and, where relevant, a disabled or invalid state.
6. For emphasis, reach for weight (600, 700) or a blush surface before a new colour.
7. Check every new screen in the component gallery (`/dev/components`, never in a production build) and with the Playwright axe checks in `e2e/`.

## Known Gaps

- **Most screens are not designed yet.** The journal entry, timeline, search, Reflect, conversation card, presentation mode, settings and device management screens are placeholders. Their components will be added here as they are built.
- **No pressed or hover styling** is defined; controls rely on the browser's defaults plus the focus ring.
- **No icon set.** The interface uses text labels only.
- **No loading, empty-state or skeleton patterns** exist yet.
- **No tags, mood selectors or conflict-resolution views** exist yet, although the PRD calls for them.
- Accessibility is verified by automated checks only (contrast unit tests, axe-core in Playwright). A manual screen-reader review has not been done and must not be claimed (PRD §3.6).
- The browser theme colour and app icon use the brand coral directly; they are fixed assets, not tokens consumed by components.
