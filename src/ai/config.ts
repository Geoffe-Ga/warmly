/**
 * The app's own limits on AI requests (PRD AI-016).
 *
 * A provider says what its model accepts; these say what Warmly is willing
 * to send and wait for, whatever the provider would allow. The smaller of
 * the two applies. They bound what one press of a button can cost.
 */

/** The most tokens Warmly sends in one request, whatever a provider allows. */
export const APP_MAX_INPUT_TOKENS = 60_000;

/** The most tokens Warmly asks for in one answer. */
export const APP_MAX_OUTPUT_TOKENS = 4_000;

/**
 * Tokens set aside in every request for the instructions the app sends
 * with it (how to answer, what not to do, the form of the answer).
 */
export const POLICY_RESERVE_TOKENS = 1_500;

/**
 * The share of the budget left unused, because a token estimate made on
 * the device is only an estimate (decision D-18).
 */
export const ESTIMATE_MARGIN = 0.15;

/** How long Warmly waits for an answer before it stops, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * A real AI provider, as the app calls it from the browser (ADR-0007).
 *
 * Each value was read from the provider's own documentation on the date
 * in {@link PROVIDERS_CHECKED}; the report beside the ADR says where.
 * Changing one is a change to that decision.
 */
export interface ProviderSettings {
  /** The provider's name as shown to the person. */
  readonly name: string;
  /**
   * The one origin requests go to. It is what the Content Security
   * Policy's `connect-src` must allow, and nothing else is.
   */
  readonly origin: string;
  /** Where a request is sent. */
  readonly endpoint: string;
  /** The model asked for, by the name the provider documents. */
  readonly model: string;
  /** The most tokens the model accepts in one request. */
  readonly modelMaxInputTokens: number;
  /** The most tokens the model can give in one answer. */
  readonly modelMaxOutputTokens: number;
  /** Headers every request carries, besides the key and content type. */
  readonly fixedHeaders: Readonly<Record<string, string>>;
  /** Body fields every request carries, whatever is asked. */
  readonly fixedBody: Readonly<Record<string, boolean>>;
  /** The provider's own terms, for the person to read. */
  readonly links: {
    readonly terms: string;
    readonly usagePolicy: string;
    readonly dataHandling: string;
  };
}

/** The real providers. The stand-in is not one of them. */
export type RealProviderId = "openai" | "anthropic";

/** The day the settings below were read from the providers' pages. */
export const PROVIDERS_CHECKED = "2026-11-27";

/** How each real provider is called (ADR-0007). */
export const PROVIDERS: Readonly<Record<RealProviderId, ProviderSettings>> = {
  openai: {
    name: "OpenAI",
    origin: "https://api.openai.com",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-6.2-sol",
    modelMaxInputTokens: 922_000,
    modelMaxOutputTokens: 128_000,
    fixedHeaders: {},
    // Without this the provider stores every answer for at least 30 days.
    fixedBody: { store: false },
    links: {
      terms: "https://openai.com/policies/",
      usagePolicy: "https://openai.com/policies/usage-policies/",
      dataHandling: "https://developers.openai.com/api/docs/guides/your-data",
    },
  },
  anthropic: {
    name: "Anthropic",
    origin: "https://api.anthropic.com",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-opus-5-5",
    modelMaxInputTokens: 1_000_000,
    modelMaxOutputTokens: 128_000,
    fixedHeaders: {
      "anthropic-version": "2026-10-21",
      // The provider's own switch for a request that comes from a browser.
      // Without it the browser is refused the answer.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    fixedBody: {},
    links: {
      terms: "https://www.anthropic.com/legal/commercial-terms",
      usagePolicy: "https://www.anthropic.com/legal/aup",
      dataHandling:
        "https://platform.claude.com/docs/en/manage-claude/api-and-data-retention",
    },
  },
};

/**
 * What the person is told about a provider before their key is used
 * (ADR-0007). Fixed words. Each sentence is something the provider's own
 * documentation says, or something true of any key in a browser: never
 * add one that is neither, and never call this arrangement secure.
 */
export const PROVIDER_DISCLOSURE: Readonly<
  Record<RealProviderId, readonly string[]>
> = {
  openai: [
    "Your words go from this device straight to OpenAI, with your own OpenAI API key. Warmly's servers never see them.",
    "OpenAI says it does not use what is sent through its API to train its models, unless you opt in.",
    "OpenAI may keep what you send and what it answers for up to 30 days to check for abuse, and for longer if the law requires it.",
    "Every request is charged to your OpenAI account. Use a key made only for Warmly, limited to creating responses, in a project with a hard spend limit and an expiry date.",
    "While Warmly is unlocked, anything that can run in this page could read your key. A browser cannot keep it fully safe.",
  ],
  anthropic: [
    "Your words go from this device straight to Anthropic, with your own Anthropic API key. Warmly's servers never see them.",
    "Anthropic says it does not train its models on what is sent through its API.",
    "Anthropic says it does not keep what is sent by default. If its safety systems flag a request, it may keep it for up to 2 years.",
    "Every request is charged to your Anthropic account. Use a key made only for Warmly, in a workspace of its own with a spend limit.",
    "While Warmly is unlocked, anything that can run in this page could read your key. A browser cannot keep it fully safe.",
  ],
};
