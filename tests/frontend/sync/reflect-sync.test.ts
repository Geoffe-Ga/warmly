/**
 * Reflect sessions across two devices: one encrypted record each, synced
 * like any private record, and settled by the person when two devices
 * change the same one (PRD RF-006, RF-008, SYNC-001, SYNC-004, SYNC-005;
 * AC-05, AC-08, AC-16).
 */
import { describe, expect, it } from "vitest";

import { RecordReflectSessions } from "../../../src/domain/reflect/sessions";
import { firstQuestion } from "../../../src/domain/reflect/types";
import { OUTBOX, RECORDS, type StoredRecord } from "../../../src/storage/db";
import {
  chooseVersion,
  keepAsNew,
  listCardConflicts,
} from "../../../src/sync/card-conflicts";
import { listConflicts } from "../../../src/sync/conflicts";
import { MemoryServer } from "../../../src/sync/testing/memory-server";
import { readRows } from "../storage/idb-snapshot";
import { OWNER, device, type Device } from "./devices";

const ANSWER = {
  markdown: "CANARY synthetic answer. [c1]",
  citations: [
    {
      claimId: "c1",
      evidence: [
        {
          entryId: "00000000-0000-4000-8000-0000000000e1",
          responseKey: "good" as const,
          start: 0,
          end: 4,
          sourceHash: "a".repeat(64),
        },
      ],
    },
  ],
  sources: [],
  coverage: {
    includedEntryIds: ["00000000-0000-4000-8000-0000000000e1"],
    omittedEntryCount: 0,
    truncated: false,
  },
};

function sessionsOf(one: Device): RecordReflectSessions {
  return new RecordReflectSessions(one.store);
}

function exchange(question: string) {
  return { question, answer: ANSWER };
}

async function shared(): Promise<{
  server: MemoryServer;
  a: Device;
  b: Device;
  id: string;
}> {
  const server = new MemoryServer();
  const [a, b] = [await device(server), await device(server)];
  const session = await sessionsOf(a).start(exchange("CANARY first question?"));
  await a.sync();
  await b.sync();
  return { server, a, b, id: session.id };
}

describe("a Reflect session syncs between a person's devices (SYNC-001, AC-05)", () => {
  it("appears whole on the other device, and can be resumed there", async () => {
    const { a, b, id } = await shared();

    const onB = await sessionsOf(b).get(id);
    expect(onB).toEqual(await sessionsOf(a).get(id));
    expect(onB?.messages).toHaveLength(2);

    await sessionsOf(b).add(id, exchange("And then?"));
    await b.sync();
    await a.sync();

    expect((await sessionsOf(a).get(id))?.messages).toHaveLength(4);
  });

  it("is one record, under its own type number, and only ciphertext is stored or sent", async () => {
    const { server, a } = await shared();

    const rows = await readRows<StoredRecord>(a.name, RECORDS);
    expect(rows.map((row) => row.type)).toEqual([4]);
    expect(
      JSON.stringify([rows, await readRows(a.name, OUTBOX)]),
    ).not.toContain("CANARY");
    const held = server
      .pull(OWNER, "0")
      .changes.map((change) =>
        new TextDecoder().decode(change.payload ?? new Uint8Array()),
      )
      .join("");
    expect(held).not.toContain("CANARY");
  });

  it("finishing on one device finishes it on the other", async () => {
    const { a, b, id } = await shared();

    await sessionsOf(a).finish(id);
    await a.sync();
    await b.sync();

    expect((await sessionsOf(b).get(id))?.status).toBe("finished");
  });

  it("deleting on one device deletes it on the other, for good", async () => {
    const { server, a, b, id } = await shared();

    expect(await sessionsOf(a).remove(id)).toBe(true);
    await a.sync();
    await b.sync();

    expect(await sessionsOf(b).list()).toEqual([]);
    const late = await device(server);
    await late.sync();
    expect(await sessionsOf(late).list()).toEqual([]);
  });
});

describe("a Reflect session changed on two devices (SYNC-004, SYNC-005, AC-16)", () => {
  async function clash() {
    const made = await shared();
    await sessionsOf(made.a).add(made.id, exchange("Asked on A?"));
    await sessionsOf(made.b).add(made.id, exchange("Asked on B?"));
    await made.a.sync();
    await made.b.sync();
    return made;
  }

  it("keeps both versions until the person chooses, and is not listed as a journal conflict", async () => {
    const { b, id } = await clash();

    const [conflict] = await listCardConflicts(b.store);

    expect(conflict).toMatchObject({
      record: "reflect-session",
      kind: "edited",
      id,
    });
    expect(
      (await sessionsOf(b).get(id))?.messages.some(
        (each) => each.role === "question" && each.text === "Asked on B?",
      ),
    ).toBe(true);
    expect(await listConflicts(b.store)).toEqual([]);
    expect(b.engine.state().status).toBe("attention");
  });

  it("keeping either version makes both devices agree", async () => {
    for (const keep of ["mine", "theirs"] as const) {
      const { a, b, id } = await clash();
      const [conflict] = await listCardConflicts(b.store);
      if (conflict === undefined) {
        throw new Error("a conflict is expected");
      }

      await chooseVersion(b.store, conflict, keep);
      await b.sync();
      await a.sync();

      const kept = await sessionsOf(a).get(id);
      expect(kept).toEqual(await sessionsOf(b).get(id));
      expect(
        kept?.messages.some(
          (each) =>
            each.role === "question" &&
            each.text === (keep === "mine" ? "Asked on B?" : "Asked on A?"),
        ),
      ).toBe(true);
      expect(await listCardConflicts(b.store)).toEqual([]);
    }
  });

  it("a session deleted elsewhere can be kept as a new one, with every question and answer", async () => {
    const { a, b, id } = await shared();
    await sessionsOf(a).remove(id);
    await sessionsOf(b).add(id, exchange("Asked on B?"));
    await a.sync();
    await b.sync();
    const [conflict] = await listCardConflicts(b.store);
    expect(conflict).toMatchObject({
      record: "reflect-session",
      kind: "deleted-elsewhere",
    });
    if (conflict === undefined) {
      throw new Error("a conflict is expected");
    }

    await keepAsNew(b.store, conflict);
    await b.sync();
    await a.sync();

    const [kept] = await sessionsOf(a).list();
    expect(kept?.id).not.toBe(id);
    expect(kept?.messages).toHaveLength(4);
    expect(kept === undefined ? "" : firstQuestion(kept)).toBe(
      "CANARY first question?",
    );
    expect(await sessionsOf(b).get(id)).toBeUndefined();
    expect(await sessionsOf(b).list()).toHaveLength(1);
  });
});
