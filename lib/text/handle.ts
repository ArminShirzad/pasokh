/**
 * "@username" isolated as left-to-right text. In a right-to-left page the
 * bidi algorithm otherwise moves the leading @ to the end ("pasokh.test@").
 * Uses Unicode isolates (LRI…PDI) rather than markup, so it works inside
 * <option>, titles and template strings too.
 */
export function handle(username: string | null | undefined): string {
  return `⁦@${username ?? ""}⁩`;
}
