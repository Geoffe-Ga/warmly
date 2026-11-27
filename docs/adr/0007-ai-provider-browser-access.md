# ADR-0007: Calling an AI provider from the browser with the person's own key

- **Status:** Proposed. It becomes Accepted when the owner has accepted
  the risks listed under "What the owner decides" and the checks that
  need real keys have been run. No real provider is connected until then.
- **Date:** 2026-11-27
- **PRD references:** §0 invariants 1, 2 and 7, §4.2 [SEC-008], §6.1
  [AI-003, AI-004], §13.1, §13.8, §15
- **Decision register:** D-17
- **Issue:** #41

## Context

Warmly's AI features send journal text to a provider the person has
chosen, with a key the person owns, after they have agreed to that one
request (ADR-0008 says how the answer is then checked). The text must
never pass through a Warmly server (invariant 1), so the request has to
leave from the browser. Decision D-17 intended a plain `fetch` to each
provider's REST API, with no vendor library. Nothing was known at first
hand about whether a browser may make such a request, or what the person
would be trusting.

The owner's instruction on 2026-11-26 was: accept both providers if the
evidence supports it. The evidence is in the
[provider compatibility report](../security/provider-compatibility-report.md):
each provider's documentation as read on 2026-11-27, and a spike run in
Chromium and WebKit with no key.

## Decision

**Both providers are accepted for direct calls from the browser, each
with conditions. Neither is connected until the owner accepts the
residual risks below and the real-key checks pass.**

### OpenAI: accept, with conditions

- Endpoint `POST https://api.openai.com/v1/responses`, by `fetch`, with
  `credentials: "omit"`.
- **`"store": false` on every request.** The API stores responses for at
  least 30 days unless told not to.
- Structured output by `text.format` (`type: "json_schema"`,
  `strict: true`).
- Default model `gpt-6.2-sol`, the one its documentation says to start
  with.
- The person is told to make a key for a project of its own, limited to
  creating responses, with a hard spend limit and an expiry date.
- OpenAI does not document that a browser may call this API. It works
  today. The app must treat "the browser refused the request" as an
  ordinary failure that says so, and this decision is reopened if that
  happens.

### Anthropic: accept, with conditions

- Endpoint `POST https://api.anthropic.com/v1/messages`, by `fetch`, with
  `anthropic-version: 2026-10-21` and the provider's own opt-in header
  for browser calls, `anthropic-dangerous-direct-browser-access: true`.
- Structured output by `output_config.format` (`type: "json_schema"`).
- No `temperature`, `top_p` or `top_k`: this API version refuses them.
- Default model `claude-opus-5-5`, the one its documentation says to
  start with.
- The person is told to make a key in a workspace of its own, with a
  spend limit. A limit on the default workspace may not stop all usage.
- A person whose organization has zero data retention cannot use it from
  a browser. The app says so when the provider refuses for that reason.

### For both

- The settings above live in `src/ai/config.ts`, and a test pins them.
  Changing a model, an endpoint or a header is a change to this decision.
- The provider's origin is added to the Content Security Policy's
  `connect-src` with the adapter (issues #44, #45), not before.
- An adapter looks at the provider's own status (a refusal, a cut-off)
  before it reads an answer, and returns a failure, never half an answer.
- A provider's schema is not trusted to make an answer true. ADR-0008's
  checks run on every answer.
- The app never describes bring-your-own-key as secure by default. The
  words the person is shown are in `PROVIDER_DISCLOSURE`
  (`src/ai/config.ts`), and each sentence is something the provider's
  documentation says.

## What the owner decides

These are the risks that remain when everything above is done. Accepting
this ADR is accepting them on behalf of the people who will use the
feature. Each is also said to the person, in the disclosure.

1. **The key can be read by anything that runs in the page.** A scripting
   bug in Warmly, a malicious browser extension, a tampered build or
   someone at an unlocked device can take the key and the journal text
   together. The app narrows the ways in; it cannot close them. A stolen
   key can spend up to the limit the person set, and can do whatever else
   that key is allowed to do.
2. **Both providers advise against putting a key in browser code.**
   Their warning is aimed at a developer shipping one key to everyone,
   which Warmly does not do. It is still their stated advice.
3. **Anthropic's Commercial Terms say its API is not for consumer use.**
   A person who uses their own key in Warmly holds their own account and
   has accepted those terms themselves. Whether Warmly may invite
   individuals to do that is a reading of a contract. **This needs the
   owner's own judgement, and legal advice if in doubt, before the
   Anthropic adapter ships.** It does not affect OpenAI.
4. **OpenAI's browser access is undocumented and can be withdrawn.** If
   it is, the OpenAI option stops working until there is another design.
5. **The provider keeps what is sent, for a time.** OpenAI: up to 30 days
   in abuse-monitoring logs, longer if the law requires. Anthropic: not
   by default on the chosen model, and up to 2 years if its safety
   systems flag the request. Anthropic's exact default period was not
   verified.
6. **Neither provider trains on API data by default**, by their own
   terms. Warmly cannot check that; it reports what they say.
7. **Warmly cannot see how a key is limited.** It asks for a restricted
   key with a spend limit. A person who pastes an unrestricted key is
   exposed to more.
8. **The cost is the person's.** One request can cost up to about $0.16
   (OpenAI) or $0.32 (Anthropic) at today's list prices, and prices and
   models change. Choosing `claude-sonnet-5-5` ($2 and $10 per million
   tokens) would halve Anthropic's figure; the owner may prefer it.
9. **OpenAI lists no dated version of its model.** The model behind
   `gpt-6.2-sol` can change. The checks of ADR-0008 are what protect the
   person then.

What the owner must supply, and no agent may: an API key for each
provider, in a project or workspace of its own, with a small hard spend
limit, given through the environment's secure credential form and never
in chat or in the repository.

## What has not been shown

- Any request with a real key. Structured output, refusals, cut-off
  answers, cancellation, spend limits and real error bodies are known
  from documentation only. The report lists the checks, in order.
- Firefox, and Safari on real Apple devices.
- OpenAI's policy pages and Anthropic's privacy centre could not be
  opened from where this was written. The links in the disclosure to
  OpenAI's policies were not opened; a person must open them.

## Alternatives considered

- **A proxy run by Warmly.** Rejected outright: the server would see
  journal text (invariant 1). It is not an option under any outcome.
- **A proxy the person runs themselves.** It moves the key off the page
  and would satisfy both providers' advice. It also asks a person keeping
  a private journal to run a server. It remains the fallback if a
  provider cannot be used from the browser, and would be a new ADR.
- **Each provider's JavaScript library.** They send the same requests.
  They add code to audit and to load, and the Anthropic one needs
  `dangerouslyAllowBrowser`, which sets the same header. D-17 stands.
- **A short-lived key made by a server**, as OpenAI offers for realtime
  audio. Neither provider offers one for text.
- **A model that runs on the device.** Outside the PRD's scope for this
  version.
- **OpenAI's Chat Completions API.** Still supported; OpenAI recommends
  Responses for new work, and both can store what is sent by default.

## Consequences

- Issues #44 and #45 implement adapters to these settings. Issue #42
  stores the key encrypted. None of them may start calling a provider
  until this ADR is Accepted.
- The first work with real keys is measurement, not building: the list
  at the end of the report.
- The decision is dated. A provider can change its terms, its models or
  its CORS behaviour. The report's date is in the config, and the report
  is read again before each release that changes a provider setting.
