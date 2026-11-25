# ADR-0008: The AI answer contract and the grounding check

- **Status:** Accepted
- **Date:** 2026-11-25
- **PRD references:** §6.2 [AI-007 to AI-012], §4.2 [SEC-010]; AC-07, AC-10, AC-26
- **Decision register:** D-16

## Context

An AI provider's answer is untrusted (invariant 7). The app shows it next to
the person's own writing and says "this comes from what you wrote on that
day". That statement has to be true every time. A model can cite an entry
that was never sent, attach real-looking words to the wrong entry, or be
steered by text inside a journal entry into returning something else
altogether.

The PRD's types tie evidence to an entry ID, a content hash and a character
range. Models copy 64-character hashes unreliably and count character
positions badly, so asking a model for those values produces answers that
are wrong for mechanical reasons, and gives a fabricated citation a way to
look valid.

## Options

### Option 1: The model returns entry IDs, hashes and character ranges

- **Pros:** the wire format is the PRD's types as written.
- **Cons:** frequent mechanical failures; a range can be valid and still
  point at words that do not say what is claimed; real record IDs and hashes
  are sent to a third party for no benefit.

### Option 2: The model cites a per-request name and a verbatim quote; the app works out the rest

- **Pros:** the app can check a quote exactly; IDs, hashes and ranges are
  computed here and cannot be wrong or invented; the provider never sees a
  record ID or a hash; fewer tokens.
- **Cons:** a quote that differs by one character is refused, so some
  honest answers are lost and the person has to ask again.

### Option 3: Option 2 with tolerant matching (ignore case, spacing, punctuation)

- **Pros:** fewer refused answers.
- **Cons:** each tolerance is a way for words the person did not write to be
  shown as theirs. There is no principled place to stop.

## Comparison

| Dimension | Option 1 | Option 2 | Option 3 |
| --- | --- | --- | --- |
| A fabricated citation can be accepted | Yes | No | In edge cases |
| Record IDs and hashes leave the device | Yes | No | No |
| Honest answers refused | Often | Sometimes | Rarely |
| What "cited" means is exact | No | Yes | No |

## Decision

**Option 2.**

**On the wire** (`src/ai/contracts.ts`). A request names its entries `E1`,
`E2`, ... for that request only (`src/ai/manifest.ts`). A provider is given
those names and the text, and nothing else about an entry. Evidence in an
answer is `{ alias, key, quote }`: the name, which of the entry's three
answers, and words copied from it.

**The check** (`src/ai/grounding.ts`). For each piece of evidence the app
looks the name up in the manifest of that request, requires the quote to be
an exact substring of the text sent under that name and answer, and builds
the `SourceRef` (entry ID, answer, start, end, content hash) itself. There
is no tidying of case, spacing or punctuation.

**All or nothing.** One unknown name, one quote that is not there, one
missing or extra field, or one count over its limit refuses the whole
answer with a typed error (`MalformedResponseError` or
`UngroundedCitationError`). Nothing is repaired and nothing partial is
shown. The gateway does not ask again (invariant 2): the person may, which
means agreeing again.

**Evidence kinds.** A part of a card marked `explicit` or `paraphrase` must
quote the journal. One marked `inference` or `suggestion` need not, and the
screens that show it must label it as the AI's own. A card must quote at
least one entry: a card that quotes nothing was not made from the journal.
A card's `sourceEntryIds` are the entries it quotes.

**Reflect claims.** A cited claim is marked in the answer text as `[c1]`.
Every mark must have a citation and every citation a mark.

**Strict form.** An object must have exactly the fields asked for. A field
the app did not ask for (a "system" note, a score, a "verified" flag, the
provider's own entry IDs) makes the answer invalid, so there is nothing
extra for later code to trust by accident.

**Text stays text.** Every string in an answer is characters. Nothing here
treats it as HTML. Whatever shows it must show it as text: if a Markdown
renderer is added, it must not emit raw HTML, images or links to other
hosts. An image or link built from model output is a way to send journal
text to another server.

**No schema library.** The guards are hand-written: four small helpers and
one function per shape, about 150 lines. The alternatives (zod, valibot)
are good, but they would be a runtime dependency in the path every AI
answer takes, for shapes this small, and the cross-check against the
manifest has to be written by hand either way. If the contracts grow past
what is comfortable to read in one file, revisit this.

**The gateway applies all of it.** `AiGateway` builds the manifest, gives
the provider the aliased prompt, and returns only a checked answer. No
caller can get an unchecked one.

## Consequences

- A citation shown in the app always points at an entry that was sent in
  that request, at words that are in it, with the hash it had when sent.
  Later code compares that hash with the entry's current one to notice that
  the text has changed since (#51, #60).
- The check proves the person wrote the quoted words in that entry. It does
  not prove the quote supports the claim next to it. The person can open
  the entry and judge; the prompts (#50, #52) ask for honest citations but
  cannot be relied on for it.
- A one-character quote passes. Minimum lengths were considered and left
  out: short true quotes ("no") exist, and the limit would not make a quote
  relevant.
- Some honest answers are refused because a model changed a quote mark or a
  space. The person sees a clear error and can ask again. If this is common
  with a real provider, the fix belongs in the prompt, not in looser
  matching.
- Character ranges are in UTF-16 code units of the text as sent. A quote can
  begin or end inside an emoji or between a letter and its accent; the
  range is still exact.
- Adapters (#44, #45) must ask the provider for this wire format and may
  not send anything from an entry except through the prompt they are given.
- Other wordings for a card (`SegmentAlternatives`) cite nothing and are
  shown as suggestions. If #59 needs them grounded, that is a new shape.
- Changing the wire format later affects only prompts and parsers: nothing
  on the wire is stored.
