/**
 * What to call a website visitor who hasn't told us their name.
 *
 * The inbox used to print `sessionId.slice(0, 8)` straight into the row's name
 * position, so a client's conversation list read "4c3007d8" where a person's
 * name goes. Worse, the two views disagreed: the list showed that fragment
 * while the detail header fell through its own chain to "Unknown" — the same
 * conversation, two different names, depending on whether you had clicked it.
 *
 * The fragment is kept because it is the only thing separating one anonymous
 * visitor from another, but it is labelled so it reads as an identifier rather
 * than a name. This matches how the leads table has always shown the same
 * thing ("Session 3c7bfb43").
 *
 * Note the fragment does not uniquely identify anyone — eight characters of a
 * v4 UUID, and for a hand-written session id like "model-test-A" the part that
 * distinguishes it can fall outside the slice entirely. It is a hint for
 * telling two rows apart, not a key.
 */
export function websiteVisitorLabel(
  sessionId: string | null | undefined
): string {
  const fragment = (sessionId || "").slice(0, 8).trim();
  return fragment ? `Visitor · ${fragment}` : "Visitor";
}
