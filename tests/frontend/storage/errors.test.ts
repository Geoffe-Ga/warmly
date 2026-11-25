import { describe, expect, it } from "vitest";

import {
  NewerDatabaseError,
  StorageBlockedError,
  StorageError,
  StorageFullError,
  StorageUnavailableError,
  openFailure,
  useFailure,
} from "../../../src/storage/errors";
import {
  browserPersistence,
  type PersistentStorage,
} from "../../../src/storage/persistence";
import {
  CANNOT_OPEN,
  describeOpenFailure,
  describeStorageError,
} from "../../../src/ui/storage-messages";

describe("typed storage errors (AC-28)", () => {
  it.each([
    [new StorageFullError(), "full", "StorageFullError"],
    [new StorageUnavailableError(), "unavailable", "StorageUnavailableError"],
    [new StorageBlockedError(), "blocked", "StorageBlockedError"],
    [new NewerDatabaseError(), "newer", "NewerDatabaseError"],
  ] as const)("%s has its kind and name", (error, kind, name) => {
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe(kind);
    expect(error.name).toBe(name);
  });

  it.each([
    ["VersionError", "newer"],
    ["QuotaExceededError", "full"],
    ["SecurityError", "unavailable"],
    ["UnknownError", "unavailable"],
    ["AbortError", "unavailable"],
  ] as const)("opening: %s is %s", (name, kind) => {
    expect(openFailure(new DOMException("synthetic", name)).kind).toBe(kind);
  });

  it.each([null, undefined, "text", 7, {}, { name: 9 }])(
    "opening: %j is unavailable",
    (value) => {
      expect(openFailure(value)).toBeInstanceOf(StorageUnavailableError);
    },
  );

  it("keeps an error that is already typed", () => {
    const blocked = new StorageBlockedError();

    expect(openFailure(blocked)).toBe(blocked);
    expect(useFailure(blocked)).toBe(blocked);
  });

  it.each([
    ["QuotaExceededError", "full"],
    ["InvalidStateError", "unavailable"],
    ["UnknownError", "unavailable"],
  ] as const)("using: %s is %s", (name, kind) => {
    expect(useFailure(new DOMException("synthetic", name))?.kind).toBe(kind);
  });

  it.each([
    new DOMException("synthetic", "AbortError"),
    new DOMException("synthetic", "ConstraintError"),
    new Error("synthetic"),
    null,
    undefined,
  ])("using: %s is left for the caller", (value) => {
    expect(useFailure(value)).toBeUndefined();
  });
});

describe("what the person is told when storage fails (AC-28, UI-008)", () => {
  const ERRORS = [
    new StorageFullError(),
    new StorageUnavailableError(),
    new StorageBlockedError(),
    new NewerDatabaseError(),
  ];

  it.each(ERRORS)(
    "saving, %s: what happened, that the text is kept, and what to do",
    (error) => {
      const message = describeStorageError(error, "save") ?? "";

      expect(message).toMatch(/^Warmly couldn't save this, because /);
      expect(message).toContain(
        "What you typed is still on this page, so keep it open.",
      );
      expect(message).not.toMatch(/error|exception|IndexedDB|quota/i);
      // It ends with something to do.
      expect(message).toMatch(
        /(save again|site data for it|latest version)\.$/,
      );
    },
  );

  it.each(ERRORS)(
    "opening, %s: what happened, that nothing was lost, and what to do",
    (error) => {
      const message = describeStorageError(error, "open") ?? "";

      expect(message).toContain("Nothing has been changed or deleted.");
      expect(message).toMatch(
        /reload this page( to get the latest version)?\.$/i,
      );
      expect(message).not.toMatch(/error|exception|IndexedDB|quota/i);
      expect(describeOpenFailure(error)).toBe(message);
    },
  );

  it("gives each failure its own words", () => {
    for (const task of ["open", "save"] as const) {
      expect(
        new Set(ERRORS.map((error) => describeStorageError(error, task))).size,
      ).toBe(ERRORS.length);
    }
  });

  it("has nothing specific to say about other failures, and never shows their text", () => {
    const secret = new Error("synthetic private detail");

    expect(describeStorageError(secret, "save")).toBeUndefined();
    expect(describeStorageError(undefined, "open")).toBeUndefined();
    expect(describeOpenFailure(secret)).toBe(CANNOT_OPEN);
    expect(CANNOT_OPEN).toContain("Nothing has been changed or deleted.");
  });
});

describe("asking the browser to keep the data (AC-28)", () => {
  function storage(answers: {
    persist?: boolean | Error;
    persisted?: boolean | Error;
  }): PersistentStorage & { asked: string[] } {
    const asked: string[] = [];
    const method = (name: "persist" | "persisted") =>
      answers[name] === undefined
        ? {}
        : {
            [name]: () => {
              asked.push(name);
              const answer = answers[name];
              return answer instanceof Error
                ? Promise.reject(answer)
                : Promise.resolve(answer === true);
            },
          };
    return { ...method("persist"), ...method("persisted"), asked };
  }

  it("reports what the browser decided when asked", async () => {
    expect(await browserPersistence(storage({ persist: true })).request()).toBe(
      "persistent",
    );
    expect(
      await browserPersistence(storage({ persist: false })).request(),
    ).toBe("best-effort");
  });

  it("reports the current state without asking for anything", async () => {
    const browser = storage({ persist: true, persisted: false });

    expect(await browserPersistence(browser).state()).toBe("best-effort");
    expect(browser.asked).toEqual(["persisted"]);
    expect(await browserPersistence(storage({ persisted: true })).state()).toBe(
      "persistent",
    );
  });

  it("is unsupported where the browser has no way to ask or to tell", async () => {
    expect(await browserPersistence(undefined).request()).toBe("unsupported");
    expect(await browserPersistence(undefined).state()).toBe("unsupported");
    expect(await browserPersistence({}).request()).toBe("unsupported");
    expect(await browserPersistence(storage({ persist: true })).state()).toBe(
      "unsupported",
    );
  });

  it("never rejects: a browser that fails to answer is unsupported", async () => {
    const failing = storage({
      persist: new Error("synthetic"),
      persisted: new Error("synthetic"),
    });

    expect(await browserPersistence(failing).request()).toBe("unsupported");
    expect(await browserPersistence(failing).state()).toBe("unsupported");
  });

  it("calls the browser's methods on the browser's own object", async () => {
    const browser = {
      granted: true,
      persist(this: { granted: boolean }) {
        return Promise.resolve(this.granted);
      },
    };

    expect(await browserPersistence(browser).request()).toBe("persistent");
  });
});
