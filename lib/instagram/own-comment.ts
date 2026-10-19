/** Instagram can report the owner under different app-scoped and native IDs.
 * Provider usernames are unique handles, not display names, so compare both.
 */
export function isOwnComment(
  account: { instagramId: string; username?: string | null },
  author: { id?: string; username?: string | null },
): boolean {
  if (author.id && author.id === account.instagramId) return true;
  const handle = (value?: string | null) => value?.trim().replace(/^@/, "").toLowerCase();
  const owner = handle(account.username);
  return Boolean(owner && owner === handle(author.username));
}
