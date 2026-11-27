# Spike: can a browser call each AI provider?

Throwaway code for [ADR-0007](../../docs/adr/0007-ai-provider-browser-access.md)
and the [provider compatibility report](../../docs/security/provider-compatibility-report.md).
It is not part of the build, the tests or coverage, and nothing in `src/`
imports it.

`node spikes/ai-browser/probe.mjs [chromium|webkit]` serves `index.html` on
localhost, opens it in that browser and prints what the page could read.
The page sends each provider one empty request with a key that is not a
key. Nothing is generated and nothing is billed. It shows one thing:
whether the browser hands the provider's answer to the page.

| File | What it is |
| --- | --- |
| `results-chromium-2026-11-27.json` | What a page saw in Chromium 159 |
| `results-webkit-2026-11-27.json` | What a page saw in WebKit (Safari 27.2's engine, on Linux) |
| `preflight-2026-11-27.txt` | Each provider's answer to the browser's preflight, by `curl` |

What it does not show: anything that needs a real key. A generated
answer, structured output, a refusal, a spend limit being hit and the
errors a real account returns have not been seen. Firefox and Safari on a
real device were not run.

Never put a key in this folder. To try a real key, type it into a page
that is not saved, or pass it on the command line of a script that is not
committed.
