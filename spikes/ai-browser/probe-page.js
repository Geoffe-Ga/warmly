/**
 * Runs in the page. Each case is one cross-origin POST with an empty body
 * and a key that is not a key. A provider that allows browser calls answers
 * 401 and the page can read it. One that does not makes `fetch` throw,
 * because the browser refuses to hand the answer to the page.
 */
const NOT_A_KEY = "not-a-real-key";

const CASES = [
  {
    name: "openai-responses",
    url: "https://api.openai.com/v1/responses",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${NOT_A_KEY}`,
    },
  },
  {
    name: "anthropic-messages-without-browser-header",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2026-10-21",
      "x-api-key": NOT_A_KEY,
    },
  },
  {
    name: "anthropic-messages-with-browser-header",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2026-10-21",
      "x-api-key": NOT_A_KEY,
      "anthropic-dangerous-direct-browser-access": "true",
    },
  },
];

async function run(one) {
  try {
    const response = await fetch(one.url, {
      method: "POST",
      headers: one.headers,
      body: "{}",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const body = await response.text();
    return {
      name: one.name,
      readable: true,
      status: response.status,
      body: body.slice(0, 300),
    };
  } catch (error) {
    return { name: one.name, readable: false, error: String(error) };
  }
}

const results = [];
for (const one of CASES) {
  results.push(await run(one));
}
document.getElementById("results").textContent = JSON.stringify(
  results,
  null,
  2,
);
window.spikeResults = results;
