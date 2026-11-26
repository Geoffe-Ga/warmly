# ADR-0009: Choosing which journal entries a Reflect request sends

- **Status:** Accepted
- **Date:** 2026-11-26
- **PRD references:** §3.3 [RF-004], §6.4 [AI-016], §13.5; AC-09
- **Decision register:** D-18

## Context

Reflect answers a question from the person's own journal. A provider's model
accepts a limited amount of text, and a journal kept for years is larger
than that. PRD RF-004 asks for as much history as fits a safe budget, and,
when not everything fits, a choice that is deterministic and disclosed,
prefers recent and relevant entries, and still represents older ones. AC-09
adds that an answer must not pass for one about the whole journal.

The choice is made on the device. Nothing may be sent to find out what to
send (invariant 2: no automatic AI), and the PRD rules out embeddings,
vector search and summaries of old entries for the MVP (§2.2).

## Options

### Option 1: The newest entries that fit

- **Pros:** trivial to explain and to test.
- **Cons:** a question about something from a year ago is answered from
  last month; older history has no representation, against RF-004.

### Option 2: Rank every entry by overlap with the question

- **Pros:** entries that mention the subject are found wherever they are.
- **Cons:** word overlap is a weak signal; a question worded differently
  from the journal gets an arbitrary selection, and recent context is lost.

### Option 3: A fixed split: newest, then relevant, then an even spread

- **Pros:** each of RF-004's three wishes has a guaranteed share; every
  part is a simple, deterministic rule; no index and nothing stored.
- **Cons:** the shares are a judgement, not a measurement; three rules are
  more to explain than one.

### Option 4: Summarise older entries on the device or with a first AI call

- **Cons:** out of scope (PRD §2.2), and a first AI call would be an AI
  call the person did not ask for.

## Comparison

| | Recent | Relevant | Older coverage | Deterministic | Explainable |
| --- | --- | --- | --- | --- | --- |
| 1 Newest only | Yes | No | No | Yes | Very |
| 2 Overlap only | No | Partly | By chance | Yes | Fairly |
| 3 Fixed split | Yes | Partly | Yes | Yes | Fairly |
| 4 Summaries | Yes | Yes | Yes | No | Poorly |

## Decision

Option 3, in `selectContext` (`src/domain/reflect/context.ts`), a pure
function: no clock, no randomness, no network, no AI.

**The room for entries** (`contextBudget`, `src/ai/budget.ts`). Start from
the request's input limit: the smaller of what the provider's model accepts
and what the app allows. Take away the tokens set aside for the app's
instructions (`POLICY_RESERVE_TOKENS`), the longest answer allowed, and the
size of the same request with no entries in it, which covers the question
and the request's own framing. A session's earlier questions and answers
are not sent with a new question today; if that changes, their size is
taken away here as well. Then leave 15% unused (`ESTIMATE_MARGIN`), because
sizes are estimates made on the device.

**Sizes** come from the provider adapter's `estimateTokens`, reached
through `AiGateway.sizing()`. An entry's size is what it adds to the empty
request, plus one token for rounding. An adapter's estimate must therefore
be local, cheap (it is called once for each entry) and never low.

**The choice.** Only finished entries count. If they all fit, all are sent.
Otherwise the room is spent in three parts:

1. **60% on the newest entries**, working back from the latest and
   stopping at the first that does not fit.
2. **20% on entries that share words with the question**, most shared
   words first. Words are compared with the local search's tokenizer
   (NFKC, lower case, whole words): no stemming, no synonyms.
3. **20% on an evenly spaced sample** of the entries not yet chosen, from
   the very oldest to the newest of them.

Whatever room is left then goes to the newest entries not yet chosen. The
selection is sent oldest first.

**Ties.** The journal has one order: day, then time of creation, then
record ID. Every tie is settled by that order, so the same journal and
question give the same selection in whatever order the records arrive.

**Whole entries only.** An entry is sent whole or not at all. If one entry
alone is larger than the room, nothing is sent and the person is told which
entry it is (`EntryTooLargeError` carries its ID, never its text). Leaving
it out quietly would hide that part of the journal can never be asked
about.

**Saying so.** The request carries how many entries were left out. Before
anything is sent, the disclosure dialog says "N of your M journal entries"
and how they were chosen. The provider is told the entries are only part of
the journal (`ReflectPrompt.partial`). And the answer is shown under a
sentence, written by the app from what it sent and stored with the answer,
that says how many entries it is about. That sentence does not depend on
what the model writes, which is what makes AC-09 hold.

## Consequences

- A long journal can be asked about, at the cost of answers that rest on
  part of it. The person is told each time, before and after.
- The same question asked twice of an unchanged journal sends the same
  entries, so a surprising answer can be reproduced.
- Relevance is by shared words only. A question that uses none of the
  journal's words gets the newest entries and the spread, which is still a
  fair picture. Better relevance (an index, embeddings) is deferred and
  would be a new ADR.
- A single very long entry blocks Reflect until it is shortened. With real
  providers' limits this needs an entry of tens of thousands of words.
  Splitting an entry is not done because a citation must point at words the
  provider was actually given, in an entry it was given whole.
- Real adapters (ADR-0007) must provide an `estimateTokens` that is fast
  and errs high. Selection calls it once for each finished entry each time
  Ask is pressed.
- The shares and the margin are constants (`SHARES`, `ESTIMATE_MARGIN`).
  Changing them changes which entries are sent, so it should be a recorded
  decision, not a tuning tweak.
