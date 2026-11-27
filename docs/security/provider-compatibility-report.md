# AI providers called from the browser: compatibility and security report

- **Checked:** 2026-11-27
- **PRD references:** §4.2 [SEC-008], §6.1 [AI-003, AI-004], §13.1, §13.8, §15
- **Decision:** [ADR-0007](../adr/0007-ai-provider-browser-access.md)
- **Issue:** #41

Warmly sends journal text to an AI provider only from the person's own
device, with the person's own API key, after they have agreed to that one
request. There is no Warmly server in between, and there must never be
one that sees the text (invariant 1). This report asks, for each
provider, whether a web page can do that, and what the person is trusting
when it does.

## What this report rests on

1. **Each provider's own documentation, read on 2026-11-27.** Every
   finding has the page it came from. Nothing here is from memory.
2. **A spike** in `spikes/ai-browser/`. A page sends each provider one
   empty request with a key that is not a key, and records whether the
   browser lets the page read the answer. It was run in Chromium 159 and
   in WebKit (the engine of Safari 27.2), both on Linux.

## What it does not rest on

- **No request was made with a real key.** No answer was generated. So
  structured output, refusals, cut-off answers, spend limits and the
  errors a real account returns are described from the documentation
  only. A person must supply test keys for that (see ADR-0007).
- **Firefox, and Safari on a real iPhone or Mac, were not run.**
- **Some pages could not be opened from where this was written:**
  OpenAI's policy pages and help centre (`openai.com`,
  `help.openai.com`) and Anthropic's privacy centre
  (`privacy.claude.com`). What depends on them is marked **not
  verified**.

## The browser is not an enclave

The key has to be in the page's memory to be used. Anything that can run
code in the page can read it and can read the journal text beside it: a
cross-site scripting bug, a malicious browser extension, a compromised
build of the app, or someone at an unlocked device. Encrypting the key at
rest (issue #42) protects it on disk and in sync. It does not protect it
while the app is unlocked. Warmly reduces the ways in (a strict Content
Security Policy with no inline or third-party script, no `eval`, no
analytics), but it cannot remove them. **Bring-your-own-key is never
described as secure by default.**

Both providers say the same thing in their own words, and both advise
against putting a key in browser code at all:

- OpenAI: "Remember that your API key is a secret. Don't share it with
  others or expose it in any client-side code such as browsers or apps."
  ([API reference overview](https://developers.openai.com/api/reference/overview))
- Anthropic: "Call the Claude API from your own back end, not from code
  that runs in your users' browsers. Anyone who uses a webpage can read
  an API key in that page's code."
  ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication))

Their warning is written for a developer who would ship one key to every
visitor. In Warmly the person who can read the key is the person who owns
it, on their own device. That is a different case, and it is the only one
in which this design is defensible. It is still a use both providers
advise against, and the owner should accept it knowingly.

## Provider: OpenAI

| Question | Finding | Evidence |
| --- | --- | --- |
| Are browser calls documented? | No. The docs say to keep keys out of browser code. They describe one browser pattern, for realtime audio, that uses a short-lived key made by a server. There is none for text. | [API keys](https://developers.openai.com/api/docs/guides/api-keys), [Realtime with WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc) |
| Opt-in required | None. | Spike |
| Does a browser call work? | Yes, today. The preflight is answered with `access-control-allow-origin: *` and allows `authorization` and `content-type`. A page could read the `401` in Chromium and WebKit. **This is not documented anywhere and could be withdrawn without notice.** | `spikes/ai-browser/preflight-2026-11-27.txt`, `results-*.json` |
| What the page cannot read | `Retry-After` and the rate-limit headers are not in `access-control-expose-headers`. Warmly never retries by itself, so it does not need them. | Same |
| Cookies | The API's edge sets cookies on the response. Requests must be sent with `credentials: "omit"`. | Response headers of a request with no key, 2026-11-27 |
| Endpoint | `POST https://api.openai.com/v1/responses`. "While Chat Completions remains supported, Responses is recommended for all new projects." Headers: `Authorization: Bearer …`, `Content-Type: application/json`. | [Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Create a response](https://developers.openai.com/api/reference/resources/responses/methods/create) |
| Stored by default? | **Yes.** `store` "Defaults to true when omitted. If set to true, response data will be stored for at least 30 days". Warmly must send `"store": false` on every request. | [Create a response](https://developers.openai.com/api/reference/resources/responses/methods/create) |
| Key scoping | A key belongs to a project and can be limited by scope. `api.responses.write` is the scope for creating responses. The documented way to make a scoped key is the Admin API; the dashboard steps for a restricted key are not in the pages read. A restricted key on another endpoint gets `401`. | [API keys](https://developers.openai.com/api/docs/guides/api-keys), [Role-based access](https://developers.openai.com/api/docs/guides/rbac) |
| Key expiry and revocation | "We strongly recommend setting an expiration date when you create a project API key". "Revocations of an API key take effect within a few seconds." | [API keys](https://developers.openai.com/api/docs/guides/api-keys) |
| Spend limits | A hard limit exists, for an organization or one project, and is off until set: "Spend alerts do not enforce a cap." "Enforcement is not instantaneous, so recorded spend can slightly exceed the configured amount." When reached, requests get `429` with `project_spend_limit_exceeded` or `organization_spend_limit_exceeded`. | [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits) |
| Training | "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)." | [Your data](https://developers.openai.com/api/docs/guides/your-data) |
| Retention | With `store: false`, the answer is not kept as application state. Abuse-monitoring logs still "may contain certain customer content, such as prompts and responses" and are "retained for up to 30 days, unless longer retention is required by law, or is reasonably necessary to protect our services or any third party from harm." Zero retention needs OpenAI's approval through sales; assume a person with their own key does not have it. | [Your data](https://developers.openai.com/api/docs/guides/your-data) |
| Structured output | `text.format` with `type: "json_schema"`, a `name`, the `schema` and `strict: true` (it defaults to false). Every object needs `additionalProperties: false` and every field must be `required`; an optional field is a union with `null`. `allOf`, `not` and `if`/`then`/`else` are not supported. | [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| What structured output does not promise | "Structured Outputs constrains completed, non-refusal model output to your supplied JSON Schema. Your application still needs to handle refusals, incomplete responses, and API errors, and validate any business rules that the schema does not express." A refusal is a `200` whose content item has `type: "refusal"`. A cut-off answer has `status: "incomplete"`. | Same |
| Default model | `gpt-6.2-sol`: "For most API workflows, start with GPT-6.2 Sol at medium reasoning effort." 1,050,000-token context, 922,000 in, 128,000 out, $2 and $10 per million tokens in and out. Only this name is listed; there is no dated version to pin. | [Model selection](https://developers.openai.com/api/docs/guides/model-selection), [GPT-6.2 Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol) |
| Terms and usage policy | **Not verified.** `openai.com` could not be opened from here. The links Warmly would show are `https://openai.com/policies/` pages; a person must open them before launch. | |

**Decision: accept, with conditions** (ADR-0007). A browser call works and
the data terms are acceptable for an explicit, disclosed request. The
conditions: `store: false` always, `credentials: "omit"`, the person is
told to use a project key limited to creating responses with a hard spend
limit, and the app treats the undocumented CORS behaviour as something
that can stop working.

### What a compromised page could do with an OpenAI key

With an unrestricted key: use any endpoint the key's owner can, on any
model, until the organization's limits stop it. That includes endpoints
that read what the account has stored, which may have nothing to do with
Warmly. With a key limited to
`api.responses.write` in a project of its own with a hard spend limit:
create responses up to that limit, and nothing else. The second is why
the disclosure asks for a restricted key. Warmly cannot check how a key
is scoped; it can only ask.

## Provider: Anthropic

| Question | Finding | Evidence |
| --- | --- | --- |
| Are browser calls documented? | Yes, as something to avoid, with a named way to do it anyway. "A request sent directly from a browser is a cross-origin (CORS) request. The API accepts one only when it includes the `anthropic-dangerous-direct-browser-access: true` header." | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) |
| Opt-in required | The header `anthropic-dangerous-direct-browser-access: true` on every request. | Same; spike |
| Does a browser call work? | Yes, with the header: the page read the `401` in Chromium and WebKit. Without it, `fetch` fails and the page learns nothing. | `spikes/ai-browser/results-*.json` |
| Who cannot use it | "Organizations that have zero data retention (ZDR) cannot call the API directly from a browser, even with that header." They get a `401` whose message begins `CORS requests are not allowed for this Organization`. | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) |
| Endpoint | `POST https://api.anthropic.com/v1/messages`. Headers: `x-api-key`, `anthropic-version` (the latest listed is `2026-10-21`), `content-type: application/json`. Body: `model`, `max_tokens`, `messages`, and `system` for the instructions. | [API overview](https://platform.claude.com/docs/en/api/overview), [Versioning](https://platform.claude.com/docs/en/api/versioning) |
| A change in this API version | "The `temperature`, `top_p`, and `top_k` request parameters are removed. A request that sends any of them returns a 400 error on every model." Warmly must not send them. | [Versioning](https://platform.claude.com/docs/en/api/versioning) |
| Key scoping | "API keys can be scoped to a single workspace. In this case, they can only access resources within that workspace." No way to limit a key to one endpoint was found. | [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces) |
| Spend limits | An organization has a monthly cap, and "you can also set custom spend and rate limits for each workspace." At a limit the person set, "requests return HTTP 400 with error type `invalid_request_error`. The message starts with `You have reached your specified API usage limits`". One caveat: "A spend limit on the default workspace might not count or stop some usage in that workspace." So the key should be in a workspace made for it. What happens when prepaid credit runs out was not found. | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| Training | "Anthropic may not train models on Customer Content from Services." "Retained data is never used for model training without your express permission." | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) §B, [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| Retention | "Conversation content (your prompts and Claude's outputs) is not retained by default; the exception is [Covered Models], which require 30-day retention." The model chosen below is not a Covered Model. And: "if a chat or session is flagged, Anthropic may retain inputs and outputs for up to 2 years." **The exact default period could not be checked against the privacy centre.** | [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| Structured output | Generally available, no beta header. "The request carries the schema in `output_config.format` with `type: "json_schema"`." Objects need `additionalProperties: false`. Not supported: recursive schemas, `oneOf`, `not`, number limits, string length limits, and array limits other than `minItems` of 0 or 1. An unsupported schema gets a `400`. It cannot be combined with the API's own citations feature (Warmly does its own, ADR-0008). | [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| What structured output does not promise | A refusal is a `200` with `stop_reason: "refusal"` and "might not match your schema". A cut-off answer has `stop_reason: "max_tokens"` and may be incomplete. | Same |
| Default model | `claude-opus-5-5`: "If you're unsure which model to use, start with Claude Opus 5.5 for most workloads." 1,000,000-token context, 128,000 out, $4 and $20 per million tokens in and out. "Every Claude model ID is a pinned snapshot". | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Terms and usage policy | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (effective 2025-06-17) and [Usage Policy](https://www.anthropic.com/legal/aup) (effective 2026-11-12). The Commercial Terms say the services "are not for consumer use". | Those pages |

**Decision: accept, with conditions, and with one question only the owner
can answer** (ADR-0007). A browser call works by the provider's own
documented switch, and conversation content is not kept by default. The
conditions: the opt-in header, a key in a workspace of its own with a
spend limit, and no sampling parameters. The question: the Commercial
Terms say the API is not for consumer use. A person who signs up for an
API account and uses their own key in Warmly is Anthropic's customer, not
Warmly's user of Anthropic's service, and accepts those terms
themselves. Whether Warmly may invite people to do that is a reading of
a contract, and this report does not make it.

### What a compromised page could do with an Anthropic key

Use any endpoint and any model the key's workspace allows, until the
workspace's or the organization's spend limit stops it. That includes
endpoints that read what the workspace holds. No narrower key was found. A
workspace made only for Warmly, with a spend limit, holds nothing else
and bounds the cost.

## What both have in common

- **The request is one `fetch`**, with no vendor library (decision D-17
  holds). Each needs one origin in the Content Security Policy's
  `connect-src`: `https://api.openai.com` or `https://api.anthropic.com`.
  They are added with the adapters (issues #44, #45), each with its
  reason, and not before.
- **The app's own checks still apply.** A provider's schema makes the
  answer well-formed. It does not make it true, and it does not check
  that a quote is in an entry. ADR-0008's checks run on every answer
  whatever the provider promises.
- **A refusal or a cut-off answer is a `200`.** An adapter must look at
  the provider's own status before it reads the answer, and hand the
  gateway a failure, not half an answer.
- **Nothing is retried.** A failed request waits for the person (PRD
  AI-014 to AI-017), which is also what both providers ask for billing errors:
  "Retrying billing, spend, or quota errors won't restore API access."

## What one request can cost

Warmly sends at most 60,000 tokens and asks for at most 4,000
(`src/ai/config.ts`). At the list prices above, the most one press of a
button can cost is about:

| Provider and model | In | Out | Most for one request |
| --- | --- | --- | --- |
| OpenAI `gpt-6.2-sol` | 60,000 × $2 / 1M = $0.12 | 4,000 × $10 / 1M = $0.04 | **$0.16** |
| Anthropic `claude-opus-5-5` | 60,000 × $4 / 1M = $0.24 | 4,000 × $20 / 1M = $0.08 | **$0.32** |

Two cautions. The token count is Warmly's estimate, with a margin; the
provider's own count decides the bill. And both default models think
before they answer. OpenAI's limit on output is "including visible
output tokens and reasoning tokens", and Anthropic's models page lists
`claude-opus-5-5` with thinking "Adaptive (always on)". So part of the
4,000 goes on thinking the person never sees. Whether 4,000 is enough
for a full answer, on either provider, is not known until a real request
is made. It is the first thing to measure with a test key.

## What has to be checked with real keys

In order, each with a key that has a small hard spend limit:

1. One Reflect request and one cards request to each provider, with the
   schemas of `src/ai/contracts.ts` written in each provider's subset.
   Does each schema get accepted? Does the answer pass ADR-0008's checks?
2. Is 4,000 output tokens enough, given that thinking counts?
3. A request that is cancelled: does the provider stop, and is anything
   billed?
4. The errors: a wrong key, a restricted key on the right endpoint, a
   spend limit that has been reached, an input that is too long. Each
   must map to one of the reasons in `src/ai/errors.ts`.
5. The same from Safari on an iPhone and from Firefox.
6. For OpenAI: that `store: false` is honoured (the stored-responses list
   in the dashboard stays empty).
