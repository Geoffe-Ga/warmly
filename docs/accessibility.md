# Accessibility

What Warmly aims for, what is checked by machine, and what has not been
checked at all (PRD UI-001 to UI-008; AC-23).

## The target

WCAG 2.2 at level AA, as an implementation target. The app has one
theme, a light one.

**This is not a claim of conformance.** No person has tested Warmly with
a screen reader, with voice control, with a switch, or at high
magnification on a real device, and nobody has audited or certified it.
Until that is done, the honest statement is: automated checks pass
against a WCAG 2.2 AA target.

## What is checked on every pull request

All of this runs in two browser engines: Chromium, and WebKit with an
iPhone profile.

### The sweep (`e2e/app/a11y.spec.ts`)

The sweep's list of screens comes from the app's own route table
(`src/app/routes.ts`). Its list of states is: empty, with content,
loading, error, a dialog open, locked, changed in two places, and
offline. **A route with no entry in the sweep, or a kind of state that no
entry shows, fails the suite**, so a new screen cannot be added without
being swept.

Each screen in each state is checked four ways:

| Check | How |
| --- | --- |
| WCAG 2.2 AA rules a machine can test | axe-core, with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` rule sets. No rule is turned off. This includes colour contrast, names and roles, form labels and target size |
| Reflow | Nothing scrolls sideways at 320 CSS pixels wide |
| Text size | Nothing scrolls sideways with text at 200%, measured with letters spaced far apart so the answer does not depend on the machine's fonts |
| Focus | Whatever takes keyboard focus first shows a focus ring at least 2 pixels wide |

A separate test checks that nothing animates or transitions for a person
who has asked their device for less motion.

### Other automated checks

- `e2e/app/gallery.spec.ts`: every control in the component kit is at
  least 44 by 44 CSS pixels; a dialog traps focus, closes on Escape and
  gives focus back.
- Feature specs (`e2e/app/*.spec.ts`, `e2e/pwa/*.spec.ts`) run axe on the
  screens they visit, and several are driven by keyboard alone: reordering
  cards, presenting, learning mode, settling a change made in two places.
- `tests/frontend/ui/contrast.test.ts`: the colour tokens meet their
  contrast ratios, the stylesheet uses only tokens for colour, no
  component sets a colour of its own, and there is no dark scheme.
- Unit tests check that moving to a new screen moves focus to its heading,
  and that status changes are announced through live regions.

### Problems the sweep found, and their fixes

The sweep was written before these were known. It found them on the
phone-sized browser:

- The "Changed in two places" screen scrolled sideways at double text
  size, because its two-column layout insisted on a column wider than the
  screen.
- A group of checkboxes with a long question scrolled sideways after the
  screen got narrower, as when a phone is turned. Safari's engine does not
  lay a group's caption out again when the group is a grid.
- In a card's learning mode, the list of parts would not shrink below its
  longest word at very large text.

## What a machine cannot check, and nobody has yet

Automated rules find a minority of accessibility problems. These need a
person:

- **Screen readers.** VoiceOver on iOS and macOS, NVDA or JAWS on
  Windows, TalkBack on Android. Whether headings, landmarks, live
  announcements and the order of reading make sense when heard, not just
  whether they exist.
- **Voice control and switch access.** Whether every control can be named
  and reached.
- **Real zoom and magnification** on a phone, and text size set in the
  device's own settings.
- **Reading level and clarity** of the words themselves.
- **Cognitive load** of the longer screens, such as "Changed in two
  places".
- **Printing** with a screen reader's or a browser's print settings.

Do these before telling anyone the app is accessible, and record who
tested, with what, and what they found.

## Status indicators

Settings has one summary of everything that protects a person's writing
(PRD UI-008): encryption, the connection, sync, the AI provider, the
recovery key, devices and deleting. Every line is a state, a count or
fixed words; none holds anything the person wrote. The summary is on a
private screen, so it is not shown while the app is locked. The lines
that appear on every screen (offline, sync, an update waiting, something
removed) are fixed text and counts only.

## Reporting a problem

Open an issue with the screen, the browser and device, the assistive
technology and its version, and what happened. Do not include anything
from a real journal.
