/**
 * Invented collections and cards for development and tests.
 *
 * Until cards can be saved there is nothing real to show, so builds other
 * than production start with these. Every word is made up. This module is
 * never part of a production build.
 */
import { MemoryCardsStore } from "../domain/cards/store";
import type { CardCollection, ConversationCard } from "../domain/cards/types";

/** Marks this as invented data; a test checks it is not in a real build. */
export const SEED_CARDS_MARK = "warmly.fake.seed-cards";

const MADE = "2026-11-01T09:00:00.000Z";

/** IDs of the seeded records, for tests to open them directly. */
export const SEED = {
  sunday: "5eed0000-0000-4000-8000-00000000c001",
  money: "5eed0000-0000-4000-8000-00000000c002",
  empty: "5eed0000-0000-4000-8000-00000000c003",
  thanks: "5eed0000-0000-4000-8000-00000000a001",
  chores: "5eed0000-0000-4000-8000-00000000a002",
  wondering: "5eed0000-0000-4000-8000-00000000a003",
  budget: "5eed0000-0000-4000-8000-00000000a004",
  entry: "5eed0000-0000-4000-8000-00000000e001",
} as const;

const CARDS: readonly ConversationCard[] = [
  {
    id: SEED.thanks,
    collectionId: SEED.sunday,
    type: "appreciation",
    authorship: "ai_generated",
    segments: [
      {
        id: "5eed0000-0000-4000-8000-000000005001",
        category: "appreciation",
        text: "I loved cooking with you on Sunday.",
        evidenceKind: "paraphrase",
        teachingExplanation:
          "Naming one specific moment is easier to hear than general praise.",
        evidence: [
          {
            entryId: SEED.entry,
            responseKey: "good",
            start: 3,
            end: 25,
            sourceHash: "0".repeat(64),
          },
        ],
      },
      {
        id: "5eed0000-0000-4000-8000-000000005002",
        category: "feeling",
        text: "It made me feel close to you.",
        evidenceKind: "inference",
        teachingExplanation:
          "Saying how it felt tells the other person why it mattered.",
        evidence: [],
      },
    ],
    sourceEntryIds: [SEED.entry],
    createdAt: MADE,
    updatedAt: MADE,
  },
  {
    id: SEED.chores,
    collectionId: SEED.sunday,
    type: "need_request",
    authorship: "user_owned",
    segments: [
      {
        id: "5eed0000-0000-4000-8000-000000005003",
        category: "observation",
        text: "The last two weekends I did the shopping on my own.",
      },
      {
        id: "5eed0000-0000-4000-8000-000000005004",
        category: "request",
        text: "Could we plan next weekend's together on Thursday?",
      },
    ],
    sourceEntryIds: [],
    createdAt: MADE,
    updatedAt: MADE,
  },
  {
    id: SEED.wondering,
    collectionId: SEED.sunday,
    type: "curiosity",
    authorship: "user_owned",
    segments: [
      {
        id: "5eed0000-0000-4000-8000-000000005005",
        category: "curiosity",
        text: "What would make weekday evenings easier for you?",
      },
    ],
    sourceEntryIds: [],
    createdAt: MADE,
    updatedAt: MADE,
  },
  {
    id: SEED.budget,
    collectionId: SEED.money,
    type: "other",
    authorship: "user_owned",
    segments: [
      {
        id: "5eed0000-0000-4000-8000-000000005006",
        category: "other",
        text: "I would like us to look at the holiday budget together.",
      },
    ],
    sourceEntryIds: [],
    createdAt: MADE,
    updatedAt: MADE,
  },
];

const COLLECTIONS: readonly CardCollection[] = [
  {
    id: SEED.sunday,
    name: "Sunday talk",
    cardIds: [SEED.thanks, SEED.chores, SEED.wondering],
    createdAt: MADE,
    updatedAt: MADE,
  },
  {
    id: SEED.money,
    name: "Money check-in",
    cardIds: [SEED.budget],
    createdAt: MADE,
    updatedAt: MADE,
  },
  {
    id: SEED.empty,
    name: "Not started yet",
    cardIds: [],
    createdAt: MADE,
    updatedAt: MADE,
  },
];

/**
 * @returns A store holding the invented collections and cards.
 */
export function seededCards(): MemoryCardsStore & { readonly mark: string } {
  return Object.assign(new MemoryCardsStore(COLLECTIONS, CARDS), {
    mark: SEED_CARDS_MARK,
  });
}
