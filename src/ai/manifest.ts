/**
 * The source manifest: what one AI request actually sent (PRD AI-012;
 * decision D-16, ADR-0008).
 *
 * Each entry in a request is given a short name for that request only:
 * `E1`, `E2` and so on. The provider is sent the names and the text, never
 * the entry's real ID or its content hash. An answer cites a name and quotes
 * the text; the manifest is how the app turns that back into a real entry,
 * and how it knows that the entry was truly part of this request.
 *
 * A manifest lives in memory for the length of one call. It is never stored.
 */
import type {
  AiPrompt,
  AiRequest,
  AliasedSource,
  CardsPrompt,
  CardsRequest,
  ReflectPrompt,
  ReflectRequest,
  ResponseKey,
  SegmentAlternativesPrompt,
  SegmentAlternativesRequest,
  SourceEntry,
} from "./provider";

/** One entry as sent: its name in this request, and what the name stands for. */
export interface ManifestSource {
  /** The entry's name in this request, for example `E1`. */
  readonly alias: string;
  /** The real entry this name stands for. Never sent to a provider. */
  readonly entryId: string;
  /** The entry's content hash when it was sent. Never sent to a provider. */
  readonly sourceHash: string;
  /** The text sent under this name. */
  readonly responses: Readonly<Record<ResponseKey, string>>;
}

/** Everything one request sent, in the order it was sent. */
export interface Manifest {
  readonly sources: readonly ManifestSource[];
}

/** The same entry was given twice in one request. Nothing was sent. */
export class DuplicateSourceError extends Error {
  constructor() {
    super("An entry appears twice in one AI request");
    this.name = "DuplicateSourceError";
  }
}

/**
 * Name the entries of one request.
 *
 * @param entries - The entries the person chose to send, in order.
 * @returns The manifest. It cannot be changed afterwards.
 * @throws DuplicateSourceError if an entry appears twice.
 */
export function buildManifest(entries: readonly SourceEntry[]): Manifest {
  const seen = new Set<string>();
  const sources = entries.map((entry, index) => {
    if (seen.has(entry.id)) {
      throw new DuplicateSourceError();
    }
    seen.add(entry.id);
    return Object.freeze({
      alias: `E${String(index + 1)}`,
      entryId: entry.id,
      sourceHash: entry.contentHash,
      responses: Object.freeze({ ...entry.responses }),
    });
  });
  return Object.freeze({ sources: Object.freeze(sources) });
}

/**
 * Find what a name stands for in this request.
 *
 * @param manifest - The request's manifest.
 * @param alias - The name an answer cited.
 * @returns The source, or `undefined` if this request sent nothing under
 *   that name.
 */
export function lookup(
  manifest: Manifest,
  alias: string,
): ManifestSource | undefined {
  return manifest.sources.find((source) => source.alias === alias);
}

/** The part of a manifest a provider may see: names and text only. */
function aliased(manifest: Manifest): readonly AliasedSource[] {
  return manifest.sources.map(({ alias, responses }) => ({
    alias,
    responses,
  }));
}

/**
 * Turn a request into what a provider is given: the person's words and the
 * entries under their names for this request, with no ID and no hash.
 *
 * @param request - The request the person agreed to send.
 * @param manifest - The manifest built from that request's entries.
 * @returns The prompt for the provider.
 */
export function promptFor(
  request: ReflectRequest,
  manifest: Manifest,
): ReflectPrompt;
export function promptFor(
  request: CardsRequest,
  manifest: Manifest,
): CardsPrompt;
export function promptFor(
  request: SegmentAlternativesRequest,
  manifest: Manifest,
): SegmentAlternativesPrompt;
export function promptFor(request: AiRequest, manifest: Manifest): AiPrompt;
export function promptFor(request: AiRequest, manifest: Manifest): AiPrompt {
  const sources = aliased(manifest);
  switch (request.kind) {
    case "reflect":
      return {
        kind: "reflect",
        question: request.question,
        sources,
        history: (request.history ?? []).map((turn) => ({
          question: turn.question,
          answer: turn.answer,
        })),
        partial: request.coverage?.truncated === true,
      };
    case "cards":
      return { kind: "cards", topic: request.topic, sources };
    case "segment-alternatives":
      return { kind: "segment-alternatives", text: request.text, sources };
  }
}
