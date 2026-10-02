import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { WINDOW_MINUTES, stepOffsets } from "../lib/sequences/window";
import { sequenceInputSchema } from "../lib/sequences/api";

describe("sequence timing", () => {
  it("counts each delay from the previous step, so the builder warns about the step that crosses 24 hours, not only a single long delay", () => {
    const offsets = stepOffsets([{ delayMinutes: 600 }, { delayMinutes: 600 }, { delayMinutes: 600 }]);
    expect(offsets).toEqual([600, 1200, 1800]);
    expect(offsets.map((m) => m >= WINDOW_MINUTES)).toEqual([false, false, true]);
  });

  it("treats a negative delay as none rather than moving later steps earlier", () => {
    expect(stepOffsets([{ delayMinutes: 60 }, { delayMinutes: -30 }])).toEqual([60, 60]);
  });
});

describe("saving a sequence", () => {
  const base = { name: "پیگیری", instagramAccountId: "a", steps: [{ delayMinutes: 60, response: { type: "text", text: "سلام" } }] };

  it("stops on reply by default, so a new sequence never talks over someone who answered", () => {
    expect(sequenceInputSchema.parse(base)).toMatchObject({ stopOnReply: true, isActive: true });
  });

  it("refuses delays over 7 days and more than 10 steps", () => {
    expect(sequenceInputSchema.safeParse({ ...base, steps: [{ ...base.steps[0], delayMinutes: 7 * 1440 + 1 }] }).success).toBe(false);
    expect(sequenceInputSchema.safeParse({ ...base, steps: Array(11).fill(base.steps[0]) }).success).toBe(false);
  });
});
