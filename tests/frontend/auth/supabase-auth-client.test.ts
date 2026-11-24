import { AuthApiError, AuthRetryableFetchError } from "@supabase/auth-js";
import { beforeEach, describe, expect, it } from "vitest";

import { AuthError } from "../../../src/auth/auth-client";
import {
  NEW_PASSWORD_PATH,
  SESSION_STORAGE_KEY,
  SupabaseAuthClient,
  VERIFY_RETURN_PATH,
  browserLocation,
  createSupabaseAuthClient,
  forgetStoredSession,
  readSupabaseAuthConfig,
  type AuthApi,
  type PageLocation,
} from "../../../src/auth/supabase-auth-client";

const EMAIL = "sam@example.com";
// Assembled from words so no credential-shaped literal sits in the repository.
const PHRASE = ["correct", "horse", "battery"].join(" ");
const NEW_PHRASE = ["staple", "window", "orange"].join(" ");
const ORIGIN = "https://warmly.example";

function apiError(code: string, status = 400): AuthApiError {
  return new AuthApiError(`provider detail for ${EMAIL}`, status, code);
}

const OFFLINE = new AuthRetryableFetchError("Failed to fetch", 0);

/** A scripted stand-in for the provider. Records every call it receives. */
class StubApi implements AuthApi {
  readonly calls: [method: string, ...args: unknown[]][] = [];
  session: object | null = null;
  errors: Partial<Record<keyof AuthApi, unknown>> = {};

  #answer(method: keyof AuthApi, args: unknown[]): { error: unknown } {
    this.calls.push([method, ...args]);
    return { error: this.errors[method] ?? null };
  }

  getSession() {
    return Promise.resolve({
      ...this.#answer("getSession", []),
      data: { session: this.session },
    });
  }

  signUp(credentials: object) {
    return Promise.resolve(this.#answer("signUp", [credentials]));
  }

  signInWithPassword(credentials: object) {
    return Promise.resolve(this.#answer("signInWithPassword", [credentials]));
  }

  signOut(options: object) {
    return Promise.resolve(this.#answer("signOut", [options]));
  }

  resetPasswordForEmail(email: string, options: object) {
    return Promise.resolve(
      this.#answer("resetPasswordForEmail", [email, options]),
    );
  }

  exchangeCodeForSession(code: string) {
    return Promise.resolve(this.#answer("exchangeCodeForSession", [code]));
  }

  updateUser(attributes: object) {
    return Promise.resolve(this.#answer("updateUser", [attributes]));
  }

  called(method: keyof AuthApi): unknown[][] {
    return this.calls.filter(([name]) => name === method);
  }
}

class StubPage implements PageLocation {
  readonly origin = ORIGIN;
  code: string | null = null;
  cleared = 0;

  readCode(): string | null {
    return this.code;
  }

  clearCode(): void {
    this.code = null;
    this.cleared += 1;
  }
}

let api: StubApi;
let page: StubPage;
let forgotten: number;
let client: SupabaseAuthClient;

beforeEach(() => {
  localStorage.clear();
  api = new StubApi();
  page = new StubPage();
  forgotten = 0;
  client = new SupabaseAuthClient(api, page, () => {
    forgotten += 1;
  });
});

async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("session", () => {
  it("is signed in when the provider holds a session", async () => {
    expect(await client.isSignedIn()).toBe(false);

    api.session = { access_token: "opaque" };

    expect(await client.isSignedIn()).toBe(true);
  });

  it("reports a failure to read the session instead of guessing", async () => {
    api.errors.getSession = OFFLINE;

    expect(await failure(client.isSignedIn())).toMatchObject({
      code: "offline",
    });
  });
});

describe("registration (PRD §2.1)", () => {
  it("signs up and sends the verification link back to the verify screen", async () => {
    await client.register(EMAIL, PHRASE);

    expect(api.called("signUp")).toEqual([
      [
        "signUp",
        {
          email: EMAIL,
          password: PHRASE,
          options: { emailRedirectTo: ORIGIN + VERIFY_RETURN_PATH },
        },
      ],
    ]);
  });

  it("does not reveal that an address is already registered", async () => {
    api.errors.signUp = apiError("user_already_exists", 422);

    await expect(client.register(EMAIL, PHRASE)).resolves.toBeUndefined();
  });

  it.each([
    ["weak_password", "weak_password"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
  ])("explains a %s failure", async (providerCode, code) => {
    api.errors.signUp = apiError(providerCode);

    const error = await failure(client.register(EMAIL, PHRASE));

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code });
  });

  it("reports being offline", async () => {
    api.errors.signUp = OFFLINE;

    expect(await failure(client.register(EMAIL, PHRASE))).toMatchObject({
      code: "offline",
    });
  });

  it("never passes on the provider's own wording", async () => {
    api.errors.signUp = apiError("something_new");

    const error = await failure(client.register(EMAIL, PHRASE));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AuthError);
    expect(String(error)).not.toContain(EMAIL);
    expect(String(error)).not.toContain("provider detail");
  });

  it.each([null, "text", { code: 7 }, { message: "no code" }])(
    "treats a malformed provider error %j as unexpected",
    async (malformed) => {
      api.errors.signUp = malformed ?? { nothing: true };

      const error = await failure(client.register(EMAIL, PHRASE));

      expect(error).not.toBeInstanceOf(AuthError);
    },
  );
});

describe("email verification", () => {
  it("signs in with the credentials typed at registration", async () => {
    await client.register(EMAIL, PHRASE);

    expect(await client.completeVerification()).toBe(true);
    expect(api.called("signInWithPassword")).toEqual([
      ["signInWithPassword", { email: EMAIL, password: PHRASE }],
    ]);
  });

  it("forgets the typed credentials once they have been used", async () => {
    await client.register(EMAIL, PHRASE);
    await client.completeVerification();

    await client.completeVerification();

    expect(api.called("signInWithPassword")).toHaveLength(1);
  });

  it("says 'not yet' while the link is unopened, and can be asked again", async () => {
    await client.register(EMAIL, PHRASE);
    api.errors.signInWithPassword = apiError("email_not_confirmed");

    expect(await client.completeVerification()).toBe(false);

    api.errors.signInWithPassword = null;
    expect(await client.completeVerification()).toBe(true);
  });

  it("gives the same answer when the address already had an account", async () => {
    api.errors.signUp = apiError("user_already_exists", 422);
    await client.register(EMAIL, PHRASE);
    api.errors.signInWithPassword = apiError("invalid_credentials");

    expect(await client.completeVerification()).toBe(false);
  });

  it("falls back to the stored session after a reload", async () => {
    expect(await client.completeVerification()).toBe(false);

    api.session = { access_token: "opaque" };

    expect(await client.completeVerification()).toBe(true);
    expect(api.called("signInWithPassword")).toEqual([]);
  });

  it("reports being offline instead of 'not verified'", async () => {
    await client.register(EMAIL, PHRASE);
    api.errors.signInWithPassword = OFFLINE;

    expect(await failure(client.completeVerification())).toMatchObject({
      code: "offline",
    });
  });
});

describe("sign in and out", () => {
  it("signs in with an email and password", async () => {
    await client.signIn(EMAIL, PHRASE);

    expect(api.called("signInWithPassword")).toEqual([
      ["signInWithPassword", { email: EMAIL, password: PHRASE }],
    ]);
  });

  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["email_not_confirmed", "email_not_verified"],
    ["over_request_rate_limit", "rate_limited"],
  ])("explains a %s failure", async (providerCode, code) => {
    api.errors.signInWithPassword = apiError(providerCode);

    expect(await failure(client.signIn(EMAIL, PHRASE))).toMatchObject({ code });
  });

  it("signs out of this device only, so it works without the server", async () => {
    await client.signOut();

    expect(api.called("signOut")).toEqual([["signOut", { scope: "local" }]]);
  });

  it("does not fail when the server could not be told", async () => {
    api.errors.signOut = OFFLINE;

    await expect(client.signOut()).resolves.toBeUndefined();
  });

  it("removes the stored session itself, whatever the library reports", async () => {
    api.errors.signOut = OFFLINE;

    await client.signOut();

    expect(forgotten).toBe(1);
  });

  it("removes the stored session even if the library throws", async () => {
    api.signOut = () => Promise.reject(new Error("library bug"));

    await expect(client.signOut()).rejects.toThrow("library bug");

    expect(forgotten).toBe(1);
  });

  it("forgets credentials typed at registration when signing out", async () => {
    await client.register(EMAIL, PHRASE);

    await client.signOut();
    await client.completeVerification();

    expect(api.called("signInWithPassword")).toEqual([]);
  });
});

/** Build the client as a page opened from an email link would. */
function openedFromLink(code: string): void {
  page.code = code;
  client = new SupabaseAuthClient(api, page, () => {
    forgotten += 1;
  });
}

describe("password reset (DEV-006)", () => {
  it("takes the code out of the address as soon as the page loads", () => {
    openedFromLink("one-time-code");

    expect(page.cleared).toBe(1);
    expect(page.code).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("leaves an ordinary address alone", () => {
    expect(page.cleared).toBe(0);
  });

  it("forgets an unused code on sign out", async () => {
    openedFromLink("one-time-code");
    await client.signOut();

    expect(
      await failure(client.completePasswordReset(NEW_PHRASE)),
    ).toMatchObject({ code: "reset_link_invalid" });
    expect(api.called("exchangeCodeForSession")).toEqual([]);
  });

  it("asks for a link that returns to the new-password screen", async () => {
    await client.requestPasswordReset(EMAIL);

    expect(api.called("resetPasswordForEmail")).toEqual([
      [
        "resetPasswordForEmail",
        EMAIL,
        { redirectTo: ORIGIN + NEW_PASSWORD_PATH },
      ],
    ]);
  });

  it("reports rate limiting on reset requests", async () => {
    api.errors.resetPasswordForEmail = apiError("over_email_send_rate_limit");

    expect(await failure(client.requestPasswordReset(EMAIL))).toMatchObject({
      code: "rate_limited",
    });
  });

  it("trades the link's code for a session, sets the password, then signs out", async () => {
    openedFromLink("one-time-code");

    await client.completePasswordReset(NEW_PHRASE);

    expect(api.calls.map(([method]) => method)).toEqual([
      "exchangeCodeForSession",
      "updateUser",
      "signOut",
    ]);
    expect(api.called("exchangeCodeForSession")[0]?.[1]).toBe("one-time-code");
    expect(api.called("updateUser")[0]?.[1]).toEqual({ password: NEW_PHRASE });
    expect(page.cleared).toBe(1);
  });

  it("refuses when the page was not opened from a link", async () => {
    api.session = { access_token: "an ordinary session" };

    expect(
      await failure(client.completePasswordReset(NEW_PHRASE)),
    ).toMatchObject({ code: "reset_link_invalid" });
    expect(api.called("updateUser")).toEqual([]);
  });

  it("refuses a used or expired link and removes it from the address", async () => {
    openedFromLink("stale-code");
    api.errors.exchangeCodeForSession = apiError("flow_state_not_found", 404);

    expect(
      await failure(client.completePasswordReset(NEW_PHRASE)),
    ).toMatchObject({ code: "reset_link_invalid" });
    expect(page.cleared).toBe(1);
    expect(api.called("updateUser")).toEqual([]);
  });

  it("lets the user pick a stronger password without a new link", async () => {
    openedFromLink("one-time-code");
    api.errors.updateUser = apiError("weak_password", 422);
    expect(await failure(client.completePasswordReset("short"))).toMatchObject({
      code: "weak_password",
    });
    expect(api.called("signOut")).toEqual([]);

    api.errors.updateUser = null;
    await client.completePasswordReset(NEW_PHRASE);

    expect(api.called("exchangeCodeForSession")).toHaveLength(1);
    expect(api.called("updateUser")).toHaveLength(2);
    expect(api.called("signOut")).toHaveLength(1);
  });

  it("a link works for one password change only", async () => {
    openedFromLink("one-time-code");
    await client.completePasswordReset(NEW_PHRASE);

    expect(await failure(client.completePasswordReset(PHRASE))).toMatchObject({
      code: "reset_link_invalid",
    });
    expect(api.called("updateUser")).toHaveLength(1);
  });

  it("ends the link's session even when the change fails", async () => {
    openedFromLink("one-time-code");
    api.errors.updateUser = apiError("same_password", 422);

    const error = await failure(client.completePasswordReset(NEW_PHRASE));

    expect(error).not.toBeInstanceOf(AuthError);
    expect(api.called("signOut")).toHaveLength(1);
  });

  it("reports the failed change even if ending the link's session also fails", async () => {
    openedFromLink("one-time-code");
    api.errors.updateUser = apiError("over_request_rate_limit", 429);
    api.errors.signOut = OFFLINE;

    expect(
      await failure(client.completePasswordReset(NEW_PHRASE)),
    ).toMatchObject({ code: "rate_limited" });
    expect(forgotten).toBe(1);
  });

  it("reports being offline while trading the code", async () => {
    openedFromLink("one-time-code");
    api.errors.exchangeCodeForSession = OFFLINE;

    expect(
      await failure(client.completePasswordReset(NEW_PHRASE)),
    ).toMatchObject({ code: "offline" });
  });
});

describe("the browser address", () => {
  it("reads the one-time code and removes only it", () => {
    window.history.replaceState(
      { kept: true },
      "",
      "/sign-in/new-password?code=abc&x=1",
    );
    const location = browserLocation();

    expect(location.origin).toBe(window.location.origin);
    expect(location.readCode()).toBe("abc");

    location.clearCode();

    expect(location.readCode()).toBeNull();
    expect(window.location.pathname + window.location.search).toBe(
      "/sign-in/new-password?x=1",
    );
    expect(window.history.state).toEqual({ kept: true });
  });

  it("has no code on an ordinary address", () => {
    window.history.replaceState(null, "", "/sign-in");

    expect(browserLocation().readCode()).toBeNull();
  });
});

describe("the real library, with a stand-in for the server", () => {
  const CONFIG = {
    url: "https://project.example",
    publishableKey: ["sb", "publishable", "synthetic"].join("_"),
  };

  function storeSession(): void {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        access_token: "synthetic.access.token",
        refresh_token: "synthetic-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: inAnHour,
        user: {
          id: "0a1b2c3d-0000-4000-8000-00000000000a",
          aud: "authenticated",
        },
      }),
    );
    localStorage.setItem(`${SESSION_STORAGE_KEY}-code-verifier`, "synthetic");
    localStorage.setItem("unrelated", "kept");
  }

  it("restores a stored session without the network", async () => {
    storeSession();
    const real = createSupabaseAuthClient(CONFIG, {
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    expect(await real.isSignedIn()).toBe(true);
  });

  it.each([
    [
      "the server cannot be reached",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
    [
      "the server answers with an error",
      () => Promise.resolve(new Response("{}", { status: 500 })),
    ],
    [
      "the server confirms",
      () => Promise.resolve(new Response(null, { status: 204 })),
    ],
  ])("sign out leaves nothing stored when %s", async (_name, respond) => {
    storeSession();
    const real = createSupabaseAuthClient(CONFIG, { fetch: respond });
    expect(await real.isSignedIn()).toBe(true);

    await real.signOut();

    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(
      localStorage.getItem(`${SESSION_STORAGE_KEY}-code-verifier`),
    ).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
    expect(await real.isSignedIn()).toBe(false);
  });
});

describe("forgetting a stored session", () => {
  it("removes the session key and its companions only", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "session");
    localStorage.setItem(`${SESSION_STORAGE_KEY}-user`, "user");
    localStorage.setItem(`${SESSION_STORAGE_KEY}.other`, "not ours");
    localStorage.setItem("warmly.fake.auth", "not ours either");

    forgetStoredSession(localStorage);

    expect(Object.keys(localStorage).sort()).toEqual([
      "warmly.auth.other",
      "warmly.fake.auth",
    ]);
  });
});

describe("configuration", () => {
  const KEY = ["sb", "publishable", "synthetic"].join("_");

  it("needs both the project URL and the publishable key", () => {
    expect(
      readSupabaseAuthConfig({
        VITE_SUPABASE_URL: "https://project.example",
        VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
      }),
    ).toEqual({ url: "https://project.example", publishableKey: KEY });
  });

  it.each([
    {},
    { VITE_SUPABASE_URL: "https://project.example" },
    { VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
    { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
    {
      VITE_SUPABASE_URL: "https://project.example",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
    },
    { VITE_SUPABASE_URL: 7, VITE_SUPABASE_PUBLISHABLE_KEY: true },
  ])("is absent for %j", (env) => {
    expect(readSupabaseAuthConfig(env)).toBeUndefined();
  });

  it("builds a client without contacting the network", async () => {
    const real = createSupabaseAuthClient({
      url: "https://project.example",
      publishableKey: KEY,
    });

    // No stored session, so this is answered locally. The test network guard
    // would fail the test if a request were attempted.
    expect(await real.isSignedIn()).toBe(false);
  });
});
