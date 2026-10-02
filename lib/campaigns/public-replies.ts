// Instagram treats the same public reply posted under comment after comment as
// spam and hides or limits it, so a campaign that replies publicly needs
// several different wordings to rotate between.
export const MIN_PUBLIC_REPLY_VARIANTS = 3;

/** Trimmed, non-empty, without repeats (a repeat is not a second wording). */
export function cleanPublicReplies(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const text = raw.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function publicRepliesProblem(enabled: boolean, list: readonly string[]): string | null {
  if (!enabled) return null;
  return cleanPublicReplies(list).length < MIN_PUBLIC_REPLY_VARIANTS
    ? "Public replies need at least 3 different wordings, or Instagram may hide them as spam."
    : null;
}

/**
 * A random wording, never the one posted last time when there is a choice:
 * picking uniformly repeats the previous reply a third of the time with three
 * wordings, which puts identical replies next to each other under the post.
 */
export function pickPublicReply(pool: readonly string[], last: string | null, random = Math.random): string {
  const choices = pool.length > 1 && last !== null ? pool.filter((text) => text !== last) : pool;
  const from = choices.length > 0 ? choices : pool;
  return from[Math.floor(random() * from.length)];
}
