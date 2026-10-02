/** Instagram accepts messages for 24 hours after the person's last message. */
export const WINDOW_MINUTES = 24 * 60;

/** Minutes from enrollment to each step, each delay counted from the previous step. */
export function stepOffsets(steps: readonly { delayMinutes: number }[]): number[] {
  let total = 0;
  return steps.map((s) => (total += Math.max(0, s.delayMinutes)));
}
