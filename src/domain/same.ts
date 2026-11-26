/**
 * Whether two plain values (what a record is made of: text, numbers,
 * lists and objects) say the same thing. The order of an object's keys
 * does not matter; the order of a list does.
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
  const keys = Object.keys(mine);
  return (
    keys.length === Object.keys(theirs).length &&
    keys.every((key) => key in theirs && sameValue(mine[key], theirs[key]))
  );
}
