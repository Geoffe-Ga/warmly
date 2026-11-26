/**
 * Putting an entry into the "changed in two places" state in the `e2e`
 * build, for the specs that need one.
 *
 * That build's server lives inside one page, so a second device cannot
 * take part. Its side is put in place the way sync leaves it: the other
 * version, still encrypted, in the local `parked` store beside an entry
 * with an unsent change.
 */
import type { Page } from "../fixtures/test";

/**
 * Keep the entry's stored version aside as "the other device's", as sync
 * does when a change from the server meets an unsent local change.
 *
 * @param page - The page.
 * @param deletedThere - Whether the other device deleted the entry.
 */
export async function parkStoredVersion(
  page: Page,
  deletedThere = false,
): Promise<void> {
  await page.evaluate(async (tombstone) => {
    const settled = <T>(request: IDBRequest<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error("a database request failed"));
        };
      });
    const name = (await indexedDB.databases())
      .map((database) => database.name ?? "")
      .find((each) => each.includes("-records-"));
    const database = await settled(indexedDB.open(name ?? ""));
    const transaction = database.transaction(
      ["records", "parked"],
      "readwrite",
    );
    const [row] = (await settled(
      transaction.objectStore("records").getAll(),
    )) as {
      type: number;
      id: string;
      envelope: Uint8Array;
      schemaVersion: number;
      baseRevision: number;
    }[];
    if (row === undefined) {
      throw new Error("an entry is expected");
    }
    await settled(
      transaction.objectStore("parked").put({
        type: row.type,
        id: row.id,
        // A deletion carries no ciphertext.
        envelope: tombstone ? null : row.envelope,
        schemaVersion: row.schemaVersion,
        revision: row.baseRevision + 1,
        tombstone,
      }),
    );
    database.close();
  }, deletedThere);
}
