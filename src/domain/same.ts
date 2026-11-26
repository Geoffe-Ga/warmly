/**
 * Whether two plain values (what a record is made of: text, numbers,
 * lists and objects) say the same thing. The order of an object's keys
 * does not matter; the order of a list does. A key that holds `undefined`
 * counts as not being there, because that is what it becomes when a
 * record is stored and read back.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns Whether they are the same all the way down.
 */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const mine = left as Record<string, unknown>;
  const theirs = right as Record<string, unknown>;
  const keys = present(mine);
  return (
    keys.length === present(theirs).length &&
    keys.every((key) => sameValue(mine[key], theirs[key]))
  );
}

/** The keys of an object that hold something. */
function present(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}
